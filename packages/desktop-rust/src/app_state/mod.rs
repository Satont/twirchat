pub mod mock_data;

use crate::chat::{AliasBook, SevenTvCatalog, SevenTvEmote, enrich_message_with_seven_tv};
use crate::hotkeys::{HotkeyAction, HotkeyManager};
use crate::protocol::messages::{ChannelStatus, ChannelStatusRequest, LiveStatusPlatform};
use crate::protocol::types::{
    Account, AppSettings, AppTheme, Badge, ChatAuthor, ChatMessageType, ChatReply, ChatTheme,
    FontFamilyChoice, LayoutNode, ModerationPresetKind, NormalizedChatMessage, OverlayAnimation,
    OverlayConfig, OverlayPosition, PanelContent, Platform, PlatformStatus, PlatformStatusInfo,
    PlatformStatusMode, ReplyAuthor, SplitDirection, WatchedChannel, WatchedChannelsLayout,
};
use crate::runtime::config::RuntimeConfig;
use crate::runtime::update::UpdateStatusSnapshot;
use crate::services::{
    BackendWsEvent, DesktopToBackendMessageKind, LifecycleEvent, ServiceEvent, UpdateStateEvent,
    WatchedChannelsEvent,
};
use crate::settings::SettingsManager;
use crate::storage::Storage;
use crate::storage::settings::default_app_settings;
use crate::storage::watched_layout::{MAX_PANELS, create_default_tab_layout};
use crate::ui::platforms::ToastKind;
use gpui::{App, Entity, Keystroke};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const SENT_MESSAGE_HISTORY_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWatchedChannelAdd {
    pub platform: Platform,
    pub channel_slug: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWatchedChannelMessage {
    pub channel_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
    pub client_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingBackendSentHistory {
    text: String,
    remaining: usize,
    sent: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutgoingChatMessageStatus {
    Pending,
    Sent,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWatchedChannelRemove {
    pub channel_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainSection {
    Chat,
    Events,
    Platforms,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaneDropDirection {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeStatus {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserCardTarget {
    pub platform: Platform,
    pub platform_user_id: String,
    pub channel_id: String,
    pub channel_slug: String,
    pub display_name: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub current_alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerationDragPreview {
    pub target: String,
    pub action: crate::protocol::types::ModerationAction,
    pub duration_seconds: Option<u32>,
    pub restore_follow_on_drop: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UserCardLoadState<T> {
    Idle,
    Loading { generation: u64 },
    Loaded { generation: u64, value: T },
    Error { generation: u64, error: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserCardHistoryPage {
    pub messages: Vec<NormalizedChatMessage>,
    pub has_more: bool,
    pub next_cursor: Option<crate::protocol::rpc::UserChatHistoryCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserCardHistoryRequestKind {
    Initial,
    Older,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserCardHistoryRequest {
    pub generation: u64,
    pub request_id: u64,
    pub kind: UserCardHistoryRequestKind,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserCardModalState {
    pub open: bool,
    pub target: Option<UserCardTarget>,
    pub history: UserCardLoadState<Vec<NormalizedChatMessage>>,
    pub metadata: UserCardLoadState<crate::protocol::messages::UserCardMetadataResponse>,
    pub has_more: bool,
    pub next_cursor: Option<crate::protocol::rpc::UserChatHistoryCursor>,
    pub loading_older: bool,
    pub generation: u64,
    history_request_id: u64,
    active_history_request_id: Option<u64>,
}

impl UserCardModalState {
    fn closed() -> Self {
        Self::closed_with_generation(0)
    }

    fn closed_with_generation(generation: u64) -> Self {
        Self {
            open: false,
            target: None,
            history: UserCardLoadState::Idle,
            metadata: UserCardLoadState::Idle,
            has_more: false,
            next_cursor: None,
            loading_older: false,
            generation,
            history_request_id: 0,
            active_history_request_id: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    active_section: MainSection,
    active_channel_tab_id: String,
    hovered_channel_tab_id: Option<String>,
    sidebar_collapsed: bool,
    unread_events: usize,
    runtime_status: RuntimeStatus,
    service_events_seen: usize,
    runtime_errors: Vec<String>,
    update_state: UpdateStatusSnapshot,
    pub settings: SettingsManager,
    pub platforms_panel: crate::ui::platforms::PlatformsPanel,
    pub messages: Vec<NormalizedChatMessage>,
    aliases: AliasBook,
    seven_tv_catalog: SevenTvCatalog,
    watched_seven_tv_channel_ids: BTreeMap<String, String>,
    pub watched_channels: Vec<WatchedChannel>,
    watched_tab_channel_ids: Vec<String>,
    watched_tab_custom_names: BTreeMap<String, String>,
    renaming_watched_tab_id: Option<String>,
    home_channel_statuses: BTreeMap<String, ChannelStatus>,
    pub watched_channel_statuses: BTreeMap<String, PlatformStatusInfo>,
    pub watched_channel_messages: BTreeMap<String, Vec<NormalizedChatMessage>>,
    home_reply_target: Option<NormalizedChatMessage>,
    watched_reply_targets: BTreeMap<String, NormalizedChatMessage>,
    hovered_message_actions_row: Option<String>,
    outgoing_message_statuses: BTreeMap<String, OutgoingChatMessageStatus>,
    pub watched_layouts: BTreeMap<String, WatchedChannelsLayout>,
    pub events: Vec<crate::protocol::types::NormalizedEvent>,
    hotkey_manager: HotkeyManager,
    pub chat_appearance_popover_open: Option<String>,
    pub moderation_popover_open: Option<String>,
    pub moderation_popover_duration_seconds: u32,
    pub moderation_drag_preview: Option<ModerationDragPreview>,
    pub chat_add_menu_open: bool,
    pub chat_options_menu_open: bool,
    pub tab_add_menu_open: bool,
    pub watched_tab_context_menu_id: Option<String>,
    pub user_card: UserCardModalState,
    panel_assignment_target: Option<String>,
    pub add_channel_platform: Platform,
    pub composer_disabled_channel_ids: BTreeSet<String>,
    sent_message_history: Vec<String>,
    pending_watched_channel_adds: Vec<PendingWatchedChannelAdd>,
    pending_watched_channel_messages: Vec<PendingWatchedChannelMessage>,
    pending_watched_channel_removals: Vec<PendingWatchedChannelRemove>,
    pending_backend_messages: Vec<crate::protocol::messages::DesktopToBackendMessage>,
    pending_backend_sent_history: VecDeque<PendingBackendSentHistory>,
    next_outgoing_message_sequence: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_section: MainSection::Chat,
            active_channel_tab_id: String::from("home"),
            hovered_channel_tab_id: None,
            sidebar_collapsed: false,
            unread_events: 3,
            runtime_status: RuntimeStatus::Starting,
            service_events_seen: 0,
            runtime_errors: Vec::new(),
            update_state: UpdateStatusSnapshot {
                show: false,
                status: None,
                message: String::new(),
                progress: None,
                hash: None,
                skipped_hash: None,
                auto_check_updates: true,
                auto_dismiss_after_ms: None,
            },
            settings: SettingsManager::new(default_app_settings()),
            platforms_panel: crate::ui::platforms::PlatformsPanel::new(),
            messages: vec![],
            aliases: AliasBook::default(),
            seven_tv_catalog: SevenTvCatalog::new(),
            watched_seven_tv_channel_ids: BTreeMap::new(),
            watched_channels: vec![],
            watched_tab_channel_ids: Vec::new(),
            watched_tab_custom_names: BTreeMap::new(),
            renaming_watched_tab_id: None,
            home_channel_statuses: BTreeMap::new(),
            watched_channel_statuses: BTreeMap::new(),
            watched_channel_messages: BTreeMap::new(),
            home_reply_target: None,
            watched_reply_targets: BTreeMap::new(),
            hovered_message_actions_row: None,
            outgoing_message_statuses: BTreeMap::new(),
            watched_layouts: BTreeMap::new(),
            events: vec![],
            hotkey_manager: HotkeyManager::new(),
            chat_appearance_popover_open: None,
            moderation_popover_open: None,
            moderation_popover_duration_seconds: 600,
            moderation_drag_preview: None,
            chat_add_menu_open: false,
            chat_options_menu_open: false,
            tab_add_menu_open: false,
            watched_tab_context_menu_id: None,
            user_card: UserCardModalState::closed(),
            panel_assignment_target: None,
            add_channel_platform: Platform::Twitch,
            composer_disabled_channel_ids: BTreeSet::new(),
            sent_message_history: Vec::new(),
            pending_watched_channel_adds: Vec::new(),
            pending_watched_channel_messages: Vec::new(),
            pending_watched_channel_removals: Vec::new(),
            pending_backend_messages: Vec::new(),
            pending_backend_sent_history: VecDeque::new(),
            next_outgoing_message_sequence: 0,
        }
    }
}

impl AppState {
    pub fn new() -> Self {
        let config = RuntimeConfig::default();
        Storage::open_or_recover(config.db_path())
            .map(|storage| Self::from_storage(&storage))
            .unwrap_or_else(|_| Self::default())
    }

    pub fn from_storage(storage: &Storage) -> Self {
        let mut state = Self::default();
        state.load_storage_snapshot(storage);
        state
    }

    fn load_storage_snapshot(&mut self, storage: &Storage) {
        if let Ok(mut messages) = storage.messages().get_recent(Some(50)) {
            hydrate_badge_images_from_snapshot(&mut messages);
            self.messages = messages;
        }
        if let Ok(aliases) = storage.user_aliases().find_all() {
            self.aliases = AliasBook::from_aliases(aliases);
        }
        if let Ok(settings) = storage.settings().get_app_settings() {
            self.settings = SettingsManager::new(settings);
            self.update_state.auto_check_updates = self
                .settings
                .settings()
                .auto_check_updates
                .unwrap_or(self.update_state.auto_check_updates);
        }
        if let Ok(custom_names) = storage.settings().get_watched_tab_custom_names() {
            self.watched_tab_custom_names = custom_names;
        }
        if let Ok(channels) = storage.watched_channels().find_all() {
            self.watched_channels = channels;
            if let Ok(Some(tab_ids)) = storage.settings().get_tab_channel_ids() {
                self.set_visible_tab_order(tab_ids);
            } else {
                self.watched_tab_channel_ids = self
                    .watched_channels
                    .iter()
                    .filter(|channel| !self.is_home_account_channel(channel))
                    .map(|channel| channel.id.clone())
                    .collect();
            }
        }
        if let Ok(accounts) = storage.accounts().find_all() {
            for account in &accounts {
                self.platforms_panel.statuses.insert(
                    account.platform,
                    PlatformStatusInfo {
                        platform: account.platform,
                        status: PlatformStatus::Connected,
                        error: None,
                        mode: PlatformStatusMode::Authenticated,
                        channel_login: Some(account.username.clone()),
                    },
                );
            }
            self.platforms_panel.accounts = accounts;
        }
        if let Ok(joined_channels) = storage.channels().find_all() {
            self.platforms_panel.joined_channels = joined_channels;
        }
        for channel in &self.watched_channels {
            if let Ok(mut messages) = storage.watched_history().get(&channel.id)
                && !messages.is_empty()
            {
                hydrate_badge_images_from_snapshot(&mut messages);
                if self.is_home_account_channel(channel) {
                    self.messages.extend(messages.iter().cloned());
                }
                self.watched_channel_messages
                    .insert(channel.id.clone(), messages);
            }
            if let Ok(layout) = storage.watched_layout().get(&channel.id) {
                self.watched_layouts.insert(channel.id.clone(), layout);
            }
        }
        if let Err(error) = self.prune_unreferenced_watched_channels(storage) {
            eprintln!("[storage] failed to prune unreferenced watched channels: {error}");
        }

        let non_home_watched_ids = self
            .watched_channels
            .iter()
            .filter(|channel| !self.is_home_account_channel(channel))
            .filter_map(|channel| self.watched_channel_messages.get(&channel.id))
            .flat_map(|messages| messages.iter().map(|message| message.id.clone()))
            .collect::<BTreeSet<_>>();

        self.messages
            .retain(|message| !non_home_watched_ids.contains(&message.id));

        let mut seen_ids = BTreeSet::new();
        self.messages
            .retain(|message| seen_ids.insert(message.id.clone()));
        hydrate_badge_images_from_snapshot(&mut self.messages);
        self.messages
            .sort_by_key(|message| message.timestamp.clone());
    }

    fn prune_unreferenced_watched_channels(
        &mut self,
        storage: &Storage,
    ) -> crate::storage::StorageResult<()> {
        let mut referenced_ids = self
            .watched_tab_channel_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();

        for tab_id in &self.watched_tab_channel_ids {
            let Some(layout) = self.watched_layouts.get(tab_id) else {
                continue;
            };
            let mut layout_ids = Vec::new();
            collect_watched_channel_ids(&layout.root, &mut layout_ids);
            referenced_ids.extend(layout_ids);
        }

        let removed_ids = self
            .watched_channels
            .iter()
            .filter(|channel| !self.is_home_account_channel(channel))
            .filter(|channel| !referenced_ids.contains(&channel.id))
            .map(|channel| channel.id.clone())
            .collect::<Vec<_>>();
        if removed_ids.is_empty() {
            return Ok(());
        }

        let removed = removed_ids.iter().cloned().collect::<BTreeSet<_>>();
        for channel_id in &removed_ids {
            Self::remove_watched_channel_storage(storage, channel_id)?;
        }
        self.watched_channels
            .retain(|channel| !removed.contains(&channel.id));
        self.watched_tab_channel_ids
            .retain(|channel_id| !removed.contains(channel_id));
        self.watched_tab_custom_names
            .retain(|channel_id, _| !removed.contains(channel_id));
        self.watched_channel_statuses
            .retain(|channel_id, _| !removed.contains(channel_id));
        self.watched_channel_messages
            .retain(|channel_id, _| !removed.contains(channel_id));
        self.watched_reply_targets
            .retain(|channel_id, _| !removed.contains(channel_id));
        self.watched_layouts
            .retain(|channel_id, _| !removed.contains(channel_id));
        self.composer_disabled_channel_ids
            .retain(|channel_id| !removed.contains(channel_id));
        Ok(())
    }

    pub fn active_section(&self) -> MainSection {
        self.active_section
    }

    pub fn active_channel_tab_id(&self) -> &str {
        &self.active_channel_tab_id
    }

    pub fn hovered_channel_tab_id(&self) -> Option<&str> {
        self.hovered_channel_tab_id.as_deref()
    }

    pub fn sidebar_collapsed(&self) -> bool {
        self.sidebar_collapsed
    }

    pub fn unread_events(&self) -> usize {
        self.unread_events
    }

    pub fn update_state(&self) -> &UpdateStatusSnapshot {
        &self.update_state
    }

    pub fn settings(&self) -> &AppSettings {
        self.settings.settings()
    }

    pub fn aliases(&self) -> &AliasBook {
        &self.aliases
    }

    pub fn seven_tv_catalog(&self) -> &SevenTvCatalog {
        &self.seven_tv_catalog
    }

    pub fn seven_tv_channel_id_for_watched_channel(&self, channel_id: &str) -> Option<&str> {
        self.watched_seven_tv_channel_ids
            .get(channel_id)
            .map(String::as_str)
    }

    pub fn home_emote_source_channels(&self) -> Vec<(Platform, Vec<String>)> {
        self.platforms_panel
            .statuses
            .values()
            .filter_map(|status| {
                let channel_login = status.channel_login.as_ref()?;
                matches!(
                    status.status,
                    PlatformStatus::Connected | PlatformStatus::Connecting
                )
                .then(|| {
                    let mut channel_ids = vec![channel_login.clone()];
                    if let Some(channel) = self
                        .watched_channels
                        .iter()
                        .filter(|channel| {
                            channel.platform == status.platform
                                && channel.channel_slug.eq_ignore_ascii_case(channel_login)
                        })
                        .max_by_key(|channel| {
                            self.watched_seven_tv_channel_ids.contains_key(&channel.id)
                        })
                    {
                        if let Some(seven_tv_channel_id) =
                            self.seven_tv_channel_id_for_watched_channel(&channel.id)
                        {
                            channel_ids.push(seven_tv_channel_id.to_string());
                        }
                        channel_ids.push(channel.id.clone());
                    }
                    channel_ids.extend(
                        self.messages
                            .iter()
                            .rev()
                            .filter(|message| message.platform == status.platform)
                            .map(|message| message.channel_id.clone()),
                    );
                    dedupe_channel_ids(&mut channel_ids);
                    (status.platform, channel_ids)
                })
            })
            .collect()
    }

    pub fn watched_emote_source_channel(
        &self,
        channel_id: &str,
    ) -> Option<(Platform, Vec<String>)> {
        let channel = self
            .watched_channels
            .iter()
            .find(|channel| channel.id == channel_id)?;
        let mut channel_ids = Vec::new();
        if let Some(seven_tv_channel_id) = self.seven_tv_channel_id_for_watched_channel(channel_id)
        {
            channel_ids.push(seven_tv_channel_id.to_string());
        }
        channel_ids.extend([channel.channel_slug.clone(), channel.id.clone()]);
        channel_ids.extend(
            self.watched_channel_messages
                .get(channel_id)
                .into_iter()
                .flat_map(|messages| messages.iter().rev())
                .filter(|message| message.platform == channel.platform)
                .map(|message| message.channel_id.clone()),
        );
        channel_ids.extend(
            self.messages
                .iter()
                .rev()
                .filter(|message| {
                    message.platform == channel.platform
                        && (message.channel_id == channel.id
                            || message
                                .channel_id
                                .eq_ignore_ascii_case(&channel.channel_slug))
                })
                .map(|message| message.channel_id.clone()),
        );
        dedupe_channel_ids(&mut channel_ids);
        Some((channel.platform, channel_ids))
    }

    pub fn alias_for_user(&self, platform: Platform, platform_user_id: &str) -> Option<&str> {
        self.aliases.get(platform, platform_user_id)
    }

    pub fn alias_for_message(&self, message: &NormalizedChatMessage) -> Option<&str> {
        self.alias_for_user(message.platform, &message.author.id)
    }

    pub fn runtime_status(&self) -> RuntimeStatus {
        self.runtime_status
    }

    pub fn sent_message_history(&self) -> &[String] {
        &self.sent_message_history
    }

    pub fn service_events_seen(&self) -> usize {
        self.service_events_seen
    }

    pub fn runtime_errors(&self) -> &[String] {
        &self.runtime_errors
    }

    pub fn connected_platform_count(&self) -> usize {
        self.platforms_panel
            .statuses
            .values()
            .filter(|status| status.status == PlatformStatus::Connected)
            .count()
    }

    pub fn watched_layout(&self, tab_id: &str) -> Option<&WatchedChannelsLayout> {
        self.watched_layouts.get(tab_id)
    }

    pub fn renaming_watched_tab_id(&self) -> Option<&str> {
        self.renaming_watched_tab_id.as_deref()
    }

    pub fn watched_tab_context_menu_id(&self) -> Option<&str> {
        self.watched_tab_context_menu_id.as_deref()
    }

    pub fn watched_tab_title(&self, tab_id: &str) -> Option<String> {
        if let Some(name) = self.watched_tab_custom_names.get(tab_id) {
            return Some(name.clone());
        }

        let channel = self
            .watched_channels
            .iter()
            .find(|channel| channel.id == tab_id)?;
        let mut titles = Vec::new();
        if let Some(layout) = self.watched_layouts.get(tab_id) {
            collect_watched_channel_ids(&layout.root, &mut titles);
        }

        let mut seen = BTreeSet::new();
        let titles = titles
            .into_iter()
            .filter(|id| seen.insert(id.clone()))
            .filter_map(|id| {
                self.watched_channels
                    .iter()
                    .find(|channel| channel.id == id)
                    .map(|channel| channel.display_name.clone())
            })
            .collect::<Vec<_>>();

        if titles.is_empty() {
            Some(channel.display_name.clone())
        } else {
            Some(titles.join(" + "))
        }
    }

    pub fn outgoing_message_status(&self, message_id: &str) -> Option<OutgoingChatMessageStatus> {
        self.outgoing_message_statuses.get(message_id).copied()
    }

    pub fn home_reply_target(&self) -> Option<&NormalizedChatMessage> {
        self.home_reply_target.as_ref()
    }

    pub fn watched_reply_target(&self, channel_id: &str) -> Option<&NormalizedChatMessage> {
        self.watched_reply_targets.get(channel_id)
    }

    pub fn set_home_reply_target(&mut self, message: NormalizedChatMessage) {
        self.home_reply_target = Some(message);
    }

    pub fn home_reply_can_send(&self, message: &NormalizedChatMessage) -> bool {
        self.home_channel_targets()
            .iter()
            .filter(|target| target.watched_channel_id.is_some())
            .any(|target| home_reply_matches_target(message, target))
    }

    pub fn cancel_home_reply_target(&mut self) {
        self.home_reply_target = None;
    }

    pub fn set_watched_reply_target(
        &mut self,
        channel_id: impl Into<String>,
        message: NormalizedChatMessage,
    ) {
        self.watched_reply_targets
            .insert(channel_id.into(), message);
    }

    pub fn cancel_watched_reply_target(&mut self, channel_id: &str) {
        self.watched_reply_targets.remove(channel_id);
    }

    pub fn message_actions_visible_for(&self, row_id: &str) -> bool {
        self.hovered_message_actions_row.as_deref() == Some(row_id)
    }

    pub fn set_message_actions_hovered(&mut self, row_id: String, hovered: bool) {
        if hovered {
            self.hovered_message_actions_row = Some(row_id);
        } else if self.hovered_message_actions_row.as_deref() == Some(row_id.as_str()) {
            self.hovered_message_actions_row = None;
        }
    }

    pub fn visible_watched_channels(&self) -> Vec<&WatchedChannel> {
        self.watched_tab_channel_ids
            .iter()
            .filter_map(|id| {
                self.watched_channels
                    .iter()
                    .find(|channel| channel.id == *id && !self.is_home_account_channel(channel))
            })
            .collect()
    }

    pub fn start_watched_tab_rename(&mut self, tab_id: &str) -> bool {
        if !self.watched_tab_channel_ids.iter().any(|id| id == tab_id) {
            return false;
        }
        self.renaming_watched_tab_id = Some(tab_id.to_string());
        self.watched_tab_context_menu_id = None;
        true
    }

    pub fn cancel_watched_tab_rename(&mut self) {
        self.renaming_watched_tab_id = None;
    }

    pub fn set_channel_tab_hovered(&mut self, tab_id: &str, hovered: bool) {
        if hovered {
            self.hovered_channel_tab_id = Some(tab_id.to_string());
        } else if self.hovered_channel_tab_id.as_deref() == Some(tab_id) {
            self.hovered_channel_tab_id = None;
        }
    }

    pub fn open_watched_tab_context_menu(&mut self, tab_id: &str) -> bool {
        if !self.watched_tab_channel_ids.iter().any(|id| id == tab_id) {
            return false;
        }
        self.watched_tab_context_menu_id = Some(tab_id.to_string());
        true
    }

    pub fn close_watched_tab_context_menu(&mut self) {
        self.watched_tab_context_menu_id = None;
    }

    pub fn rename_watched_tab(
        &mut self,
        storage: &Storage,
        tab_id: &str,
        name: &str,
    ) -> crate::storage::StorageResult<bool> {
        if !self.watched_tab_channel_ids.iter().any(|id| id == tab_id) {
            return Ok(false);
        }

        let trimmed = name.trim();
        if trimmed.is_empty() {
            self.watched_tab_custom_names.remove(tab_id);
            storage
                .settings()
                .set_watched_tab_custom_name(tab_id, None)?;
        } else {
            self.watched_tab_custom_names
                .insert(tab_id.to_string(), trimmed.to_string());
            storage
                .settings()
                .set_watched_tab_custom_name(tab_id, Some(trimmed))?;
        }
        self.renaming_watched_tab_id = None;
        Ok(true)
    }

    fn set_visible_tab_order(&mut self, tab_ids: Vec<String>) {
        let positions = tab_ids
            .iter()
            .enumerate()
            .map(|(index, id)| (id.as_str(), index))
            .collect::<BTreeMap<_, _>>();

        self.watched_channels.sort_by_key(|channel| {
            positions
                .get(channel.id.as_str())
                .copied()
                .unwrap_or(usize::MAX)
        });
        self.watched_tab_channel_ids = tab_ids
            .into_iter()
            .filter(|id| {
                self.watched_channels
                    .iter()
                    .any(|channel| channel.id == *id && !self.is_home_account_channel(channel))
            })
            .collect();
    }

    fn persist_visible_tab_order(&self, storage: &Storage) -> crate::storage::StorageResult<()> {
        storage
            .settings()
            .set_tab_channel_ids(&self.watched_tab_channel_ids)
    }

    pub fn home_channel_status_requests(&self) -> Vec<ChannelStatusRequest> {
        let mut requests = Vec::new();
        let mut seen = BTreeSet::new();

        for account in &self.platforms_panel.accounts {
            let Some(platform) = live_status_platform(account.platform) else {
                continue;
            };
            push_home_channel_status_request(
                &mut requests,
                &mut seen,
                platform,
                &account.username,
                (!account.platform_user_id.is_empty()).then(|| account.platform_user_id.clone()),
            );
        }

        for channel in &self.watched_channels {
            let Some(platform) = live_status_platform(channel.platform) else {
                continue;
            };
            push_home_channel_status_request(
                &mut requests,
                &mut seen,
                platform,
                &channel.channel_slug,
                None,
            );
        }

        requests
    }

    pub fn apply_home_channel_statuses(&mut self, statuses: Vec<ChannelStatus>) {
        for status in statuses {
            self.home_channel_statuses.insert(
                home_channel_status_key(status.platform, &status.channel_login),
                status,
            );
        }
    }

    pub fn home_channel_status(
        &self,
        platform: Platform,
        channel_login: &str,
    ) -> Option<&ChannelStatus> {
        live_status_platform(platform).and_then(|platform| {
            self.home_channel_statuses
                .get(&home_channel_status_key(platform, channel_login))
        })
    }

    pub fn add_chat_pane_for_active_tab(
        &mut self,
        storage: &Storage,
    ) -> crate::storage::StorageResult<bool> {
        let tab_id = self.active_channel_tab_id.clone();
        if tab_id == "home" {
            return Ok(false);
        }

        let mut layout = self
            .watched_layouts
            .get(&tab_id)
            .cloned()
            .unwrap_or_else(|| create_default_tab_layout(&tab_id));

        if !append_watched_pane(&mut layout.root) {
            return Ok(false);
        }

        storage.watched_layout().set(&tab_id, &layout)?;
        self.watched_layouts.insert(tab_id, layout);
        self.chat_add_menu_open = false;
        Ok(true)
    }

    pub fn add_watched_channel_from_account(
        &mut self,
        storage: &Storage,
        account_id: &str,
    ) -> crate::storage::StorageResult<bool> {
        let Some(account) = self
            .platforms_panel
            .accounts
            .iter()
            .find(|account| account.id == account_id)
            .cloned()
        else {
            return Ok(false);
        };

        let channel = storage.watched_channels().upsert(
            account.platform,
            &account.username,
            &account.display_name,
        )?;

        if !self
            .watched_channels
            .iter()
            .any(|existing| existing.id == channel.id)
        {
            self.watched_channels.push(channel.clone());
        }

        self.watched_layouts
            .entry(channel.id.clone())
            .or_insert_with(|| create_default_tab_layout(&channel.id));
        self.chat_add_menu_open = false;
        self.queue_watched_channel_add(
            channel.platform,
            channel.channel_slug.clone(),
            Some(channel.display_name.clone()),
        );
        Ok(true)
    }

    pub fn persist_settings(&self, storage: &Storage) -> crate::storage::StorageResult<()> {
        storage.settings().set_app_settings(self.settings())
    }

    pub fn connect_platform_account_placeholder(&mut self, platform: Platform) {
        if platform == Platform::Kick {
            return;
        }
        self.platforms_panel.auth_loading.insert(platform, true);
        self.platforms_panel.statuses.insert(
            platform,
            PlatformStatusInfo {
                platform,
                status: PlatformStatus::Connecting,
                error: Some(String::from(
                    "Native auth flow is not wired yet in desktop-rust",
                )),
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
        self.platforms_panel.add_toast(
            platform,
            ToastKind::Error,
            String::from("Native auth flow is not wired yet in desktop-rust"),
        );
    }

    pub fn disconnect_platform_account(&mut self, platform: Platform) {
        self.platforms_panel
            .accounts
            .retain(|account| account.platform != platform);
        self.platforms_panel.joined_channels.remove(&platform);
        self.platforms_panel.auth_loading.remove(&platform);
        self.platforms_panel.statuses.insert(
            platform,
            PlatformStatusInfo {
                platform,
                status: PlatformStatus::Disconnected,
                error: None,
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
        self.platforms_panel.add_toast(
            platform,
            ToastKind::Success,
            format!("Disconnected {} account", format_platform_label(platform)),
        );
    }

    pub fn join_channel_from_account(
        &mut self,
        storage: &Storage,
        platform: Platform,
    ) -> crate::storage::StorageResult<bool> {
        let Some(account) = self
            .platforms_panel
            .accounts
            .iter()
            .find(|account| account.platform == platform)
            .cloned()
        else {
            self.platforms_panel.add_toast(
                platform,
                ToastKind::Error,
                format!(
                    "Connect a {} account first",
                    format_platform_label(platform)
                ),
            );
            return Ok(false);
        };

        let changed = self.add_watched_channel_from_account(storage, &account.id)?;
        self.platforms_panel
            .join_channel(platform, account.username.clone());
        self.platforms_panel.add_toast(
            platform,
            ToastKind::Success,
            format!("Watching {}", account.display_name),
        );
        Ok(changed)
    }

    pub fn connect_kick_account(&mut self, storage: &Storage) -> Result<bool, String> {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Kick, true);
        match crate::auth::kick_connect::connect_kick_account(storage) {
            Ok(account) => {
                let channel = storage
                    .watched_channels()
                    .upsert(Platform::Kick, &account.username, &account.display_name)
                    .map_err(|error| error.to_string())?;
                self.apply_connected_kick_account(account, channel);
                Ok(true)
            }
            Err(error) => {
                self.platforms_panel
                    .auth_loading
                    .insert(Platform::Kick, false);
                self.platforms_panel.statuses.insert(
                    Platform::Kick,
                    PlatformStatusInfo {
                        platform: Platform::Kick,
                        status: PlatformStatus::Error,
                        error: Some(error.clone()),
                        mode: PlatformStatusMode::Anonymous,
                        channel_login: None,
                    },
                );
                self.platforms_panel
                    .add_toast(Platform::Kick, ToastKind::Error, error.clone());
                Err(error)
            }
        }
    }

    pub fn connect_twitch_account(&mut self, storage: &Storage) -> Result<bool, String> {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Twitch, true);
        match crate::auth::twitch_connect::connect_twitch_account(storage) {
            Ok(account) => {
                let channel = storage
                    .watched_channels()
                    .upsert(Platform::Twitch, &account.username, &account.display_name)
                    .map_err(|error| error.to_string())?;
                self.apply_connected_twitch_account(account, channel);
                Ok(true)
            }
            Err(error) => {
                self.platforms_panel
                    .auth_loading
                    .insert(Platform::Twitch, false);
                self.platforms_panel.statuses.insert(
                    Platform::Twitch,
                    PlatformStatusInfo {
                        platform: Platform::Twitch,
                        status: PlatformStatus::Error,
                        error: Some(error.clone()),
                        mode: PlatformStatusMode::Anonymous,
                        channel_login: None,
                    },
                );
                self.platforms_panel
                    .add_toast(Platform::Twitch, ToastKind::Error, error.clone());
                Err(error)
            }
        }
    }

    pub fn start_kick_connect(&mut self) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Kick, true);
        self.platforms_panel.statuses.insert(
            Platform::Kick,
            PlatformStatusInfo {
                platform: Platform::Kick,
                status: PlatformStatus::Connecting,
                error: None,
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
    }

    pub fn start_twitch_connect(&mut self) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Twitch, true);
        self.platforms_panel.statuses.insert(
            Platform::Twitch,
            PlatformStatusInfo {
                platform: Platform::Twitch,
                status: PlatformStatus::Connecting,
                error: None,
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
    }

    pub fn apply_connected_kick_account(&mut self, account: Account, channel: WatchedChannel) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Kick, false);
        self.platforms_panel
            .accounts
            .retain(|existing| existing.platform != Platform::Kick);
        self.platforms_panel.accounts.push(account.clone());
        self.platforms_panel.statuses.insert(
            Platform::Kick,
            PlatformStatusInfo {
                platform: Platform::Kick,
                status: PlatformStatus::Connected,
                error: None,
                mode: PlatformStatusMode::Authenticated,
                channel_login: Some(account.username.clone()),
            },
        );
        self.platforms_panel.add_toast(
            Platform::Kick,
            ToastKind::Success,
            format!("Connected Kick account @{}", account.username),
        );

        if !self
            .watched_channels
            .iter()
            .any(|existing| existing.id == channel.id)
        {
            self.watched_channels.push(channel.clone());
        }
        self.watched_layouts
            .entry(channel.id.clone())
            .or_insert_with(|| create_default_tab_layout(&channel.id));
        self.platforms_panel
            .join_channel(Platform::Kick, account.username.clone());
        self.queue_watched_channel_add(
            Platform::Kick,
            channel.channel_slug,
            Some(channel.display_name),
        );
    }

    pub fn apply_connected_twitch_account(&mut self, account: Account, channel: WatchedChannel) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Twitch, false);
        self.platforms_panel
            .accounts
            .retain(|existing| existing.platform != Platform::Twitch);
        self.platforms_panel.accounts.push(account.clone());
        self.platforms_panel.statuses.insert(
            Platform::Twitch,
            PlatformStatusInfo {
                platform: Platform::Twitch,
                status: PlatformStatus::Connected,
                error: None,
                mode: PlatformStatusMode::Authenticated,
                channel_login: Some(account.username.clone()),
            },
        );
        self.platforms_panel.add_toast(
            Platform::Twitch,
            ToastKind::Success,
            format!("Connected Twitch account @{}", account.username),
        );

        if !self
            .watched_channels
            .iter()
            .any(|existing| existing.id == channel.id)
        {
            self.watched_channels.push(channel.clone());
        }
        self.watched_layouts
            .entry(channel.id.clone())
            .or_insert_with(|| create_default_tab_layout(&channel.id));
        self.platforms_panel
            .join_channel(Platform::Twitch, account.username.clone());
        self.queue_watched_channel_add(
            Platform::Twitch,
            channel.channel_slug,
            Some(channel.display_name),
        );
    }

    pub fn fail_kick_connect(&mut self, error: String) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Kick, false);
        self.platforms_panel.statuses.insert(
            Platform::Kick,
            PlatformStatusInfo {
                platform: Platform::Kick,
                status: PlatformStatus::Error,
                error: Some(error.clone()),
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
        self.platforms_panel
            .add_toast(Platform::Kick, ToastKind::Error, error.clone());
        self.record_runtime_failure(error);
    }

    pub fn fail_twitch_connect(&mut self, error: String) {
        self.platforms_panel
            .auth_loading
            .insert(Platform::Twitch, false);
        self.platforms_panel.statuses.insert(
            Platform::Twitch,
            PlatformStatusInfo {
                platform: Platform::Twitch,
                status: PlatformStatus::Error,
                error: Some(error.clone()),
                mode: PlatformStatusMode::Anonymous,
                channel_login: None,
            },
        );
        self.platforms_panel
            .add_toast(Platform::Twitch, ToastKind::Error, error.clone());
        self.record_runtime_failure(error);
    }

    pub fn apply_service_event(&mut self, event: ServiceEvent) {
        self.service_events_seen = self.service_events_seen.saturating_add(1);
        match event {
            ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarted) => {
                self.runtime_status = RuntimeStatus::Running;
            }
            ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStopped { .. }) => {
                self.runtime_status = RuntimeStatus::Stopped;
            }
            ServiceEvent::BackendWs(BackendWsEvent::MessageDecoded { message }) => {
                self.apply_backend_message(message);
            }
            ServiceEvent::BackendWs(BackendWsEvent::MessageSent { kind }) => {
                self.apply_backend_send_result(kind, true);
            }
            ServiceEvent::BackendWs(BackendWsEvent::AuthRejected { message, .. }) => {
                self.runtime_errors.push(message);
            }
            ServiceEvent::BackendWs(BackendWsEvent::MalformedPayload { error }) => {
                self.runtime_errors.push(error);
            }
            ServiceEvent::BackendWs(BackendWsEvent::SendFailed { kind, reason }) => {
                self.apply_backend_send_result(kind, false);
                self.runtime_errors.push(reason);
            }
            ServiceEvent::WatchedChannels(event) => self.apply_watched_channels_event(event),
            ServiceEvent::UpdateState(UpdateStateEvent::StateChanged { snapshot }) => {
                self.set_update_state(snapshot);
            }
            _ => {}
        }
    }

    fn apply_watched_channels_event(&mut self, event: WatchedChannelsEvent) {
        match event {
            WatchedChannelsEvent::MessageBuffered {
                channel_id,
                message,
            } => {
                let lookup_channel_id = message.channel_id.clone();
                let message = enrich_message_with_seven_tv(
                    *message,
                    &lookup_channel_id,
                    &self.seven_tv_catalog,
                );
                eprintln!(
                    "[watched/live] app_state accepted {:?} message id={} channel={}",
                    message.platform, message.id, message.channel_id
                );
                if self.reconcile_outgoing_echo(&channel_id, &message) {
                    return;
                }
                if self.is_home_account_channel_id(&channel_id) {
                    self.messages.push(message.clone());
                }
                let channel_messages = self.watched_channel_messages.entry(channel_id).or_default();
                channel_messages.push(message);
                if channel_messages.len()
                    > crate::services::watched_channels::DEFAULT_WATCHED_CHANNEL_BUFFER_SIZE
                {
                    let excess = channel_messages.len()
                        - crate::services::watched_channels::DEFAULT_WATCHED_CHANNEL_BUFFER_SIZE;
                    channel_messages.drain(0..excess);
                }
            }
            WatchedChannelsEvent::StatusChanged { channel_id, status } => {
                self.watched_channel_statuses.insert(channel_id, status);
            }
            WatchedChannelsEvent::AdapterError {
                channel_id,
                platform,
                message,
            } => {
                eprintln!(
                    "[watched/live] app_state accepted adapter error channel={} platform={:?}: {}",
                    channel_id, platform, message
                );
                self.runtime_errors.push(message);
            }
            WatchedChannelsEvent::BackendMessagePlanned {
                message,
                watched_channel_id,
                ..
            } => {
                if let (
                    Some(watched_channel_id),
                    crate::protocol::messages::DesktopToBackendMessage::SeventvSubscribe {
                        channel_id,
                        ..
                    },
                ) = (&watched_channel_id, &message)
                {
                    self.watched_seven_tv_channel_ids
                        .insert(watched_channel_id.clone(), channel_id.clone());
                }
                self.pending_backend_messages.push(message);
            }
            WatchedChannelsEvent::MessageSendSucceeded {
                client_message_id, ..
            } => {
                self.mark_outgoing_message_sent(&client_message_id);
            }
            WatchedChannelsEvent::MessageSendFailed {
                client_message_id,
                error,
                ..
            } => {
                self.mark_outgoing_message_error(&client_message_id, error);
            }
            WatchedChannelsEvent::RemoveRequested { channel_id } => {
                self.watched_seven_tv_channel_ids.remove(&channel_id);
            }
            WatchedChannelsEvent::LoadRequested
            | WatchedChannelsEvent::AddRequested { .. }
            | WatchedChannelsEvent::ReconnectRequested { .. }
            | WatchedChannelsEvent::SendRequested { .. }
            | WatchedChannelsEvent::PollRequested => {}
        }
    }

    fn apply_backend_message(
        &mut self,
        message: crate::protocol::messages::BackendToDesktopMessage,
    ) {
        match message {
            crate::protocol::messages::BackendToDesktopMessage::ChatMessage { data } => {
                if let Ok(message) =
                    serde_json::from_value::<crate::protocol::types::NormalizedChatMessage>(data)
                {
                    let channel_id = message.channel_id.clone();
                    let message =
                        enrich_message_with_seven_tv(message, &channel_id, &self.seven_tv_catalog);
                    eprintln!(
                        "[backend/live] app_state accepted {:?} message id={} channel={}",
                        message.platform, message.id, message.channel_id
                    );
                    backfill_badge_images(&mut self.messages, &message);
                    self.messages.push(message);
                }
            }
            crate::protocol::messages::BackendToDesktopMessage::SeventvEmoteSet {
                platform,
                channel_id,
                emotes,
            } => {
                eprintln!(
                    "[backend/7tv] received emote set platform={platform:?} channel={channel_id} count={}",
                    emotes.len()
                );
                self.seven_tv_catalog.replace_for_channel(
                    platform,
                    &channel_id,
                    emotes.into_iter().map(map_backend_seven_tv_emote),
                );
                self.rehydrate_channel_seven_tv_emotes(platform, &channel_id);
            }
            crate::protocol::messages::BackendToDesktopMessage::SeventvEmoteAdded {
                platform,
                channel_id,
                emote,
            } => {
                eprintln!(
                    "[backend/7tv] emote added platform={platform:?} channel={channel_id} alias={} id={}",
                    emote.alias, emote.id
                );
                self.seven_tv_catalog.insert(
                    platform,
                    channel_id.clone(),
                    map_backend_seven_tv_emote(emote),
                );
                self.rehydrate_channel_seven_tv_emotes(platform, &channel_id);
            }
            crate::protocol::messages::BackendToDesktopMessage::SeventvEmoteRemoved {
                platform,
                channel_id,
                emote_id,
            } => {
                eprintln!(
                    "[backend/7tv] emote removed platform={platform:?} channel={channel_id} id={emote_id}"
                );
                self.seven_tv_catalog
                    .remove_by_id(platform, &channel_id, &emote_id);
                self.rehydrate_channel_seven_tv_emotes(platform, &channel_id);
            }
            crate::protocol::messages::BackendToDesktopMessage::SeventvEmoteUpdated {
                platform,
                channel_id,
                emote_id,
                alias,
            } => {
                eprintln!(
                    "[backend/7tv] emote updated platform={platform:?} channel={channel_id} id={emote_id} alias={alias}"
                );
                self.seven_tv_catalog
                    .update_alias(platform, &channel_id, &emote_id, &alias);
                self.rehydrate_channel_seven_tv_emotes(platform, &channel_id);
            }
            crate::protocol::messages::BackendToDesktopMessage::SeventvSystemMessage {
                platform,
                channel_id,
                message,
            } => {
                let (text, preview_emotes) = seven_tv_system_message_data(&message);
                eprintln!(
                    "[backend/7tv] system message platform={platform:?} channel={channel_id}: {text}"
                );
                self.push_seven_tv_system_message(platform, &channel_id, text, preview_emotes);
            }
            crate::protocol::messages::BackendToDesktopMessage::ChatEvent { data } => {
                if let Ok(event) =
                    serde_json::from_value::<crate::protocol::types::NormalizedEvent>(data)
                {
                    eprintln!(
                        "[backend/live] app_state accepted event id={} platform={:?}",
                        event.id, event.platform
                    );
                    self.events.push(event);
                    if !matches!(self.active_section, MainSection::Events) {
                        self.unread_events = self.unread_events.saturating_add(1);
                    }
                }
            }
            crate::protocol::messages::BackendToDesktopMessage::PlatformStatus {
                platform,
                status,
                error,
            } => {
                let status = match status {
                    crate::protocol::messages::BackendPlatformStatus::Connected => {
                        PlatformStatus::Connected
                    }
                    crate::protocol::messages::BackendPlatformStatus::Disconnected => {
                        PlatformStatus::Disconnected
                    }
                    crate::protocol::messages::BackendPlatformStatus::Error => {
                        PlatformStatus::Error
                    }
                };
                self.platforms_panel.statuses.insert(
                    platform,
                    PlatformStatusInfo {
                        platform,
                        status,
                        error,
                        mode: PlatformStatusMode::Anonymous,
                        channel_login: None,
                    },
                );
            }
            _ => {}
        }
    }

    fn rehydrate_channel_seven_tv_emotes(&mut self, platform: Platform, channel_id: &str) {
        for message in &mut self.messages {
            if message.message_type == ChatMessageType::System
                || message.platform != platform
                || !message_matches_seven_tv_channel(
                    &self.watched_channels,
                    message.platform,
                    &message.channel_id,
                    channel_id,
                )
            {
                continue;
            }

            let mut base = message.clone();
            base.emotes.retain(|emote| !is_seven_tv_emote(emote));
            let enriched = enrich_message_with_seven_tv(base, channel_id, &self.seven_tv_catalog);
            *message = enriched;
        }

        for messages in self.watched_channel_messages.values_mut() {
            for message in messages {
                if message.message_type == ChatMessageType::System
                    || message.platform != platform
                    || message.channel_id != channel_id
                {
                    continue;
                }
                let mut base = message.clone();
                base.emotes.retain(|emote| !is_seven_tv_emote(emote));
                *message = enrich_message_with_seven_tv(base, channel_id, &self.seven_tv_catalog);
            }
        }
    }

    fn display_channel_id_for_seven_tv(
        &self,
        platform: Platform,
        seven_tv_channel_id: &str,
    ) -> String {
        self.watched_channels
            .iter()
            .find(|channel| {
                channel.platform == platform && channel.channel_slug == seven_tv_channel_id
            })
            .map(|channel| channel.id.clone())
            .unwrap_or_else(|| seven_tv_channel_id.to_string())
    }

    fn push_seven_tv_system_message(
        &mut self,
        platform: Platform,
        seven_tv_channel_id: &str,
        text: String,
        preview_emotes: Vec<crate::protocol::types::Emote>,
    ) {
        let timestamp = crate::storage::now_millis().to_string();
        let message = NormalizedChatMessage {
            id: format!("seventv-system-{platform:?}-{seven_tv_channel_id}-{timestamp}"),
            platform,
            channel_id: self.display_channel_id_for_seven_tv(platform, seven_tv_channel_id),
            author: ChatAuthor {
                id: "seventv".to_string(),
                username: Some("7tv".to_string()),
                display_name: "7TV".to_string(),
                color: Some("#4ade80".to_string()),
                avatar_url: None,
                badges: Vec::<Badge>::new(),
            },
            text,
            emotes: preview_emotes,
            timestamp,
            message_type: ChatMessageType::System,
            reply: None,
        };

        if self
            .watched_channels
            .iter()
            .any(|channel| channel.id == message.channel_id)
        {
            self.watched_channel_messages
                .entry(message.channel_id.clone())
                .or_default()
                .push(message);
        } else {
            self.messages.push(message);
        }
    }

    pub fn select_section(&mut self, section: MainSection) {
        self.active_section = section;
        if matches!(section, MainSection::Events) {
            self.unread_events = 0;
        }
    }

    pub fn select_channel_tab(&mut self, tab_id: impl Into<String>) {
        self.active_channel_tab_id = tab_id.into();
        self.watched_tab_context_menu_id = None;
    }

    pub fn cycle_channel_tab(&mut self, direction: i32) -> bool {
        let mut tab_ids = vec![String::from("home")];
        tab_ids.extend(
            self.visible_watched_channels()
                .into_iter()
                .map(|channel| channel.id.clone()),
        );

        if tab_ids.len() <= 1 {
            return false;
        }

        let current_index = tab_ids
            .iter()
            .position(|id| id == &self.active_channel_tab_id)
            .unwrap_or(0) as i32;
        let next_index = (current_index + direction).rem_euclid(tab_ids.len() as i32) as usize;

        self.active_section = MainSection::Chat;
        self.active_channel_tab_id = tab_ids[next_index].clone();
        true
    }

    pub fn toggle_sidebar(&mut self) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
    }

    pub fn set_update_state(&mut self, state: UpdateStatusSnapshot) {
        self.update_state = state;
    }

    pub fn set_theme(&mut self, theme: AppTheme) {
        self.settings.set_theme(theme);
    }

    pub fn set_chat_theme(&mut self, chat_theme: ChatTheme) {
        self.settings.set_chat_theme(chat_theme);
    }

    pub fn set_font_family(&mut self, font: FontFamilyChoice) {
        self.settings.set_font_family(font);
    }

    pub fn set_system_font_family(&mut self, font_family: impl Into<String>) {
        self.settings.set_system_font_family(font_family);
    }

    pub fn set_font_size(&mut self, font_size: f64) {
        self.settings.set_font_size(font_size);
    }

    pub fn set_show_platform_color_stripe(&mut self, show: bool) {
        self.settings.set_show_platform_color_stripe(show);
    }

    pub fn set_show_platform_icon(&mut self, show: bool) {
        self.settings.set_show_platform_icon(show);
    }

    pub fn set_show_timestamp(&mut self, show: bool) {
        self.settings.set_show_timestamp(show);
    }

    pub fn set_show_avatars(&mut self, show: bool) {
        self.settings.set_show_avatars(show);
    }

    pub fn set_show_badges(&mut self, show: bool) {
        self.settings.set_show_badges(show);
    }

    pub fn set_show_moderation_buttons(&mut self, show: bool) {
        self.settings.set_show_ban_button(show);
        self.settings.set_show_timeout_button(show);
    }

    pub fn set_moderation_presets(&mut self, presets: Vec<ModerationPresetKind>) {
        self.settings.set_moderation_presets(presets);
    }

    pub fn open_moderation_popover(&mut self, target: String, duration_seconds: u32) {
        self.moderation_popover_open = Some(target);
        self.moderation_popover_duration_seconds = duration_seconds;
    }

    pub fn close_moderation_popover(&mut self) {
        self.moderation_popover_open = None;
    }

    pub fn set_moderation_popover_duration(&mut self, duration_seconds: u32) {
        self.moderation_popover_duration_seconds = duration_seconds;
    }

    pub fn set_moderation_drag_preview(
        &mut self,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
        restore_follow_on_drop: bool,
    ) {
        self.moderation_drag_preview = Some(ModerationDragPreview {
            target,
            action,
            duration_seconds,
            restore_follow_on_drop,
        });
    }

    pub fn update_moderation_drag_action(
        &mut self,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
    ) {
        if let Some(preview) = self.moderation_drag_preview.as_mut()
            && preview.target == target
        {
            preview.action = action;
            preview.duration_seconds = duration_seconds;
        }
    }

    pub fn clear_moderation_drag_preview(&mut self) {
        self.moderation_drag_preview = None;
    }

    pub fn set_auto_check_updates(&mut self, enabled: bool) {
        self.settings.set_auto_check_updates(enabled);
        self.update_state.auto_check_updates = enabled;
    }

    pub fn recording_hotkey(&self) -> Option<HotkeyAction> {
        self.hotkey_manager.recording_action()
    }

    pub fn is_recording_hotkey(&self, action: HotkeyAction) -> bool {
        self.hotkey_manager.is_recording(action)
    }

    pub fn start_hotkey_recording(&mut self, action: HotkeyAction) {
        self.hotkey_manager.start_recording(action);
    }

    pub fn cancel_hotkey_recording(&mut self) {
        self.hotkey_manager.cancel_recording();
    }

    pub fn record_hotkey(&mut self, keystroke: &Keystroke) -> bool {
        let Some((action, hotkey)) = self.hotkey_manager.record_keystroke(keystroke) else {
            return false;
        };

        self.settings.set_hotkey(action, hotkey);
        true
    }

    pub fn set_self_ping(&mut self, enabled: bool, color: String) {
        self.settings.set_self_ping(enabled, color);
    }

    pub fn update_overlay_config(&mut self, config: OverlayConfig) {
        self.settings.update_overlay_config(config);
    }

    pub fn set_overlay_background(&mut self, background: impl Into<String>) {
        self.settings.set_overlay_background(background);
    }

    pub fn set_overlay_text_color(&mut self, text_color: impl Into<String>) {
        self.settings.set_overlay_text_color(text_color);
    }

    pub fn set_overlay_font_size(&mut self, font_size: f64) {
        self.settings.set_overlay_font_size(font_size);
    }

    pub fn set_overlay_font_family(&mut self, font_family: impl Into<String>) {
        self.settings.set_overlay_font_family(font_family);
    }

    pub fn set_overlay_max_messages(&mut self, max_messages: u32) {
        self.settings.set_overlay_max_messages(max_messages);
    }

    pub fn set_overlay_message_timeout(&mut self, message_timeout: u64) {
        self.settings.set_overlay_message_timeout(message_timeout);
    }

    pub fn set_overlay_show_platform_icon(&mut self, show: bool) {
        self.settings.set_overlay_show_platform_icon(show);
    }

    pub fn set_overlay_show_avatar(&mut self, show: bool) {
        self.settings.set_overlay_show_avatar(show);
    }

    pub fn set_overlay_show_badges(&mut self, show: bool) {
        self.settings.set_overlay_show_badges(show);
    }

    pub fn set_overlay_animation(&mut self, animation: OverlayAnimation) {
        self.settings.set_overlay_animation(animation);
    }

    pub fn set_overlay_position(&mut self, position: OverlayPosition) {
        self.settings.set_overlay_position(position);
    }

    pub fn set_overlay_port(&mut self, port: u16) {
        self.settings.set_overlay_port(port);
    }

    pub fn record_runtime_failure(&mut self, error: impl Into<String>) {
        self.runtime_status = RuntimeStatus::Failed;
        self.runtime_errors.push(error.into());
    }

    pub fn toggle_chat_appearance_popover(&mut self, target: &str) {
        if self.chat_appearance_popover_open.as_deref() == Some(target) {
            self.chat_appearance_popover_open = None;
        } else {
            self.chat_appearance_popover_open = Some(target.to_string());
        }
    }

    pub fn toggle_chat_add_menu(&mut self) {
        self.chat_add_menu_open = !self.chat_add_menu_open;
    }

    pub fn toggle_chat_options_menu(&mut self) {
        self.chat_options_menu_open = !self.chat_options_menu_open;
    }

    pub fn toggle_tab_add_menu(&mut self) {
        self.tab_add_menu_open = !self.tab_add_menu_open;
    }

    pub fn open_add_channel_modal(&mut self) {
        self.tab_add_menu_open = true;
        self.panel_assignment_target = None;
        self.add_channel_platform = Platform::Twitch;
    }

    pub fn open_add_channel_modal_for_panel(&mut self, panel_id: impl Into<String>) {
        self.tab_add_menu_open = true;
        self.panel_assignment_target = Some(panel_id.into());
        self.add_channel_platform = Platform::Twitch;
    }

    pub fn close_add_channel_modal(&mut self) {
        self.tab_add_menu_open = false;
        self.panel_assignment_target = None;
    }

    pub fn select_add_channel_platform(&mut self, platform: Platform) {
        if platform == Platform::Youtube && !self.is_youtube_authenticated() {
            return;
        }
        self.add_channel_platform = platform;
    }

    pub fn is_youtube_authenticated(&self) -> bool {
        self.platforms_panel
            .accounts
            .iter()
            .any(|account| account.platform == Platform::Youtube)
    }

    pub fn add_watched_channel_from_slug(
        &mut self,
        storage: &Storage,
        platform: Platform,
        channel_slug: &str,
    ) -> crate::storage::StorageResult<bool> {
        let Some(_channel) = self.upsert_watched_channel(storage, platform, channel_slug)? else {
            return Ok(false);
        };
        self.close_add_channel_modal();
        Ok(true)
    }

    pub fn add_watched_channel_tab_from_slug(
        &mut self,
        storage: &Storage,
        platform: Platform,
        channel_slug: &str,
    ) -> crate::storage::StorageResult<bool> {
        let Some(channel) = self.upsert_watched_channel(storage, platform, channel_slug)? else {
            return Ok(false);
        };

        if !self
            .watched_tab_channel_ids
            .iter()
            .any(|id| id == &channel.id)
        {
            self.watched_tab_channel_ids.push(channel.id.clone());
        }
        self.select_channel_tab(channel.id.clone());
        self.persist_visible_tab_order(storage)?;
        self.close_add_channel_modal();
        Ok(true)
    }

    pub fn submit_add_channel_modal(
        &mut self,
        storage: &Storage,
        platform: Platform,
        channel_slug: &str,
    ) -> crate::storage::StorageResult<bool> {
        if let Some(panel_id) = self.panel_assignment_target.clone() {
            self.assign_watched_channel_to_active_panel(storage, &panel_id, platform, channel_slug)
        } else {
            self.add_watched_channel_tab_from_slug(storage, platform, channel_slug)
        }
    }

    pub fn remove_watched_channel(&mut self, channel_id: &str) -> bool {
        let Some(removed_channel) = self
            .watched_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .cloned()
        else {
            return false;
        };

        self.watched_channels
            .retain(|channel| channel.id != channel_id);
        self.watched_tab_channel_ids.retain(|id| id != channel_id);
        self.watched_tab_custom_names.remove(channel_id);
        if self.hovered_channel_tab_id.as_deref() == Some(channel_id) {
            self.hovered_channel_tab_id = None;
        }
        if self.renaming_watched_tab_id.as_deref() == Some(channel_id) {
            self.renaming_watched_tab_id = None;
        }
        if self.watched_tab_context_menu_id.as_deref() == Some(channel_id) {
            self.watched_tab_context_menu_id = None;
        }
        self.watched_channel_statuses.remove(channel_id);
        self.watched_channel_messages.remove(channel_id);
        self.watched_reply_targets.remove(channel_id);
        self.watched_layouts.remove(channel_id);
        self.composer_disabled_channel_ids.remove(channel_id);
        self.chat_add_menu_open = false;

        if self.active_channel_tab_id == channel_id {
            self.active_channel_tab_id = String::from("home");
        }

        self.pending_watched_channel_messages
            .retain(|message| message.channel_id != channel_id);
        self.pending_watched_channel_adds.retain(|pending| {
            pending.platform != removed_channel.platform
                || !pending
                    .channel_slug
                    .eq_ignore_ascii_case(&removed_channel.channel_slug)
        });
        self.pending_watched_channel_removals
            .retain(|remove| remove.channel_id != channel_id);
        self.queue_watched_channel_remove(removed_channel.id);
        true
    }

    fn remove_watched_channel_storage(
        storage: &Storage,
        channel_id: &str,
    ) -> crate::storage::StorageResult<()> {
        storage.watched_channels().remove(channel_id)?;
        storage.watched_history().remove(channel_id)?;
        storage.watched_layout().remove(channel_id)?;
        storage
            .settings()
            .set_watched_tab_custom_name(channel_id, None)?;
        Ok(())
    }

    pub fn remove_watched_channel_for_tab(
        &mut self,
        storage: &Storage,
        channel_id: &str,
    ) -> crate::storage::StorageResult<bool> {
        if !self
            .watched_tab_channel_ids
            .iter()
            .any(|id| id == channel_id)
        {
            return Ok(false);
        }

        self.watched_tab_channel_ids.retain(|id| id != channel_id);
        self.watched_tab_custom_names.remove(channel_id);
        if self.renaming_watched_tab_id.as_deref() == Some(channel_id) {
            self.renaming_watched_tab_id = None;
        }
        self.watched_layouts.remove(channel_id);
        if self.active_channel_tab_id == channel_id {
            self.active_channel_tab_id = String::from("home");
        }

        storage.watched_layout().remove(channel_id)?;
        storage
            .settings()
            .set_watched_tab_custom_name(channel_id, None)?;
        if !self.is_watched_channel_referenced(channel_id) {
            self.remove_watched_channel(channel_id);
            Self::remove_watched_channel_storage(storage, channel_id)?;
        }
        self.persist_visible_tab_order(storage)?;
        Ok(true)
    }

    pub fn reorder_watched_channel_tab(
        &mut self,
        storage: &Storage,
        from_id: &str,
        to_id: &str,
    ) -> crate::storage::StorageResult<bool> {
        if from_id == to_id {
            return Ok(false);
        }

        let mut ids = self
            .visible_watched_channels()
            .into_iter()
            .map(|channel| channel.id.clone())
            .collect::<Vec<_>>();
        let Some(from_index) = ids.iter().position(|id| id == from_id) else {
            return Ok(false);
        };
        let Some(mut to_index) = ids.iter().position(|id| id == to_id) else {
            return Ok(false);
        };

        let moved = ids.remove(from_index);
        if from_index < to_index {
            to_index -= 1;
        }
        ids.insert(to_index, moved);

        self.set_visible_tab_order(ids.clone());
        storage.settings().set_tab_channel_ids(&ids)?;
        Ok(true)
    }

    pub fn toggle_composer_channel(&mut self, channel_id: &str) {
        if !self
            .composer_disabled_channel_ids
            .insert(channel_id.to_string())
        {
            self.composer_disabled_channel_ids.remove(channel_id);
        }
    }

    pub fn queue_composer_send(&mut self, text: &str) -> bool {
        let text = text.trim();
        if text.is_empty() {
            return false;
        }

        if let Some(command) = text.strip_prefix('/') {
            let mut parts = command.splitn(2, char::is_whitespace);
            let Some(keyword) = parts.next() else {
                return false;
            };
            if keyword.eq_ignore_ascii_case("user") {
                let query = parts.next().map(str::trim).unwrap_or("");
                if query.is_empty() {
                    return false;
                }

                if let Some(target) = self.resolve_user_card_target(query) {
                    self.open_user_card(target);
                    return true;
                }
                self.record_runtime_failure(format!("No recent chat user matched /user {query}"));
                return true;
            }
        }

        let mut queued = false;
        let mut backend_send_count = 0;
        let active_reply_target = self.home_reply_target.clone();
        for target in self.home_channel_targets() {
            if self.composer_disabled_channel_ids.contains(&target.id) {
                continue;
            }
            if let Some(reply) = active_reply_target.as_ref()
                && !home_reply_matches_target(reply, &target)
            {
                continue;
            }
            if let Some(watched_channel_id) = &target.watched_channel_id {
                let reply_target = active_reply_target
                    .as_ref()
                    .filter(|reply| home_reply_matches_target(reply, &target))
                    .cloned();
                let reply_to_message_id = reply_target.as_ref().map(|reply| reply.id.clone());
                let client_message_id = self.insert_optimistic_watched_message(
                    watched_channel_id,
                    text,
                    reply_target.as_ref(),
                );
                self.pending_watched_channel_messages
                    .push(PendingWatchedChannelMessage {
                        channel_id: watched_channel_id.clone(),
                        text: text.to_string(),
                        reply_to_message_id,
                        client_message_id: Some(client_message_id),
                    });
            } else {
                self.pending_backend_messages.push(
                    crate::protocol::messages::DesktopToBackendMessage::SendMessage {
                        platform: target.platform,
                        channel: target.channel_login,
                        message: text.to_string(),
                    },
                );
                backend_send_count += 1;
            }
            queued = true;
        }
        if queued {
            self.record_sent_message_history(text);
            if backend_send_count > 0 {
                self.pending_backend_sent_history
                    .push_back(PendingBackendSentHistory {
                        text: text.to_string(),
                        remaining: backend_send_count,
                        sent: 0,
                    });
            }
            self.home_reply_target = None;
        }
        queued
    }

    pub fn queue_watched_channel_send(&mut self, channel_id: &str, text: &str) -> bool {
        let text = text.trim();
        if text.is_empty()
            || !self
                .watched_channels
                .iter()
                .any(|channel| channel.id == channel_id)
        {
            return false;
        }

        let reply_target = self.watched_reply_targets.remove(channel_id);
        let reply_to_message_id = reply_target.as_ref().map(|reply| reply.id.clone());
        let client_message_id =
            self.insert_optimistic_watched_message(channel_id, text, reply_target.as_ref());
        self.pending_watched_channel_messages
            .push(PendingWatchedChannelMessage {
                channel_id: channel_id.to_string(),
                text: text.to_string(),
                reply_to_message_id,
                client_message_id: Some(client_message_id),
            });
        self.record_sent_message_history(text);
        true
    }

    fn record_sent_message_history(&mut self, text: &str) {
        self.sent_message_history.push(text.to_string());
        if self.sent_message_history.len() > SENT_MESSAGE_HISTORY_LIMIT {
            let excess = self.sent_message_history.len() - SENT_MESSAGE_HISTORY_LIMIT;
            self.sent_message_history.drain(0..excess);
        }
    }

    fn apply_backend_send_result(&mut self, kind: DesktopToBackendMessageKind, sent: bool) {
        if kind != DesktopToBackendMessageKind::SendMessage {
            return;
        }

        let mut failed_text = None;
        if let Some(pending) = self.pending_backend_sent_history.front_mut() {
            pending.remaining = pending.remaining.saturating_sub(1);
            if sent {
                pending.sent = pending.sent.saturating_add(1);
            }

            if pending.remaining == 0 && pending.sent == 0 {
                failed_text = Some(pending.text.clone());
            }
        }

        let completed = self
            .pending_backend_sent_history
            .front()
            .is_some_and(|pending| pending.remaining == 0);
        if completed {
            self.pending_backend_sent_history.pop_front();
        }
        if let Some(text) = failed_text {
            self.remove_sent_message_history(&text);
        }
    }

    pub fn open_user_card(&mut self, target: UserCardTarget) -> u64 {
        self.user_card.generation = self.user_card.generation.saturating_add(1);
        self.user_card.open = true;
        self.user_card.target = Some(target);
        self.user_card.history = UserCardLoadState::Idle;
        self.user_card.metadata = UserCardLoadState::Idle;
        self.user_card.has_more = false;
        self.user_card.next_cursor = None;
        self.user_card.loading_older = false;
        self.user_card.active_history_request_id = None;
        self.user_card.generation
    }

    pub fn close_user_card(&mut self) -> u64 {
        let generation = self.user_card.generation.saturating_add(1);
        self.user_card = UserCardModalState::closed_with_generation(generation);
        self.user_card.generation
    }

    pub fn start_user_card_history_load(&mut self) -> Option<UserCardHistoryRequest> {
        if !self.user_card.open || self.user_card.target.is_none() {
            return None;
        }

        let generation = self.user_card.generation;
        let request_id = self.next_user_card_history_request_id();
        self.user_card.history = UserCardLoadState::Loading { generation };
        self.user_card.loading_older = false;
        self.user_card.active_history_request_id = Some(request_id);
        Some(UserCardHistoryRequest {
            generation,
            request_id,
            kind: UserCardHistoryRequestKind::Initial,
        })
    }

    pub fn start_user_card_older_history_load(&mut self) -> Option<UserCardHistoryRequest> {
        if !self.user_card.open
            || self.user_card.target.is_none()
            || !self.user_card.has_more
            || self.user_card.next_cursor.is_none()
            || self.user_card.loading_older
        {
            return None;
        }

        let generation = self.user_card.generation;
        let request_id = self.next_user_card_history_request_id();
        self.user_card.loading_older = true;
        self.user_card.active_history_request_id = Some(request_id);
        Some(UserCardHistoryRequest {
            generation,
            request_id,
            kind: UserCardHistoryRequestKind::Older,
        })
    }

    pub fn apply_user_card_history_result(
        &mut self,
        request: UserCardHistoryRequest,
        result: Result<UserCardHistoryPage, String>,
    ) -> bool {
        if !self.user_card.open
            || self.user_card.generation != request.generation
            || self.user_card.active_history_request_id != Some(request.request_id)
        {
            return false;
        }

        match result {
            Ok(page) => {
                let mut messages = page.messages;
                if request.kind == UserCardHistoryRequestKind::Older
                    && let UserCardLoadState::Loaded { value, .. } = &self.user_card.history
                {
                    messages.extend(value.iter().cloned());
                }
                self.user_card.history = UserCardLoadState::Loaded {
                    generation: request.generation,
                    value: messages,
                };
                self.user_card.has_more = page.has_more;
                self.user_card.next_cursor = page.next_cursor;
            }
            Err(error) => {
                self.user_card.history = UserCardLoadState::Error {
                    generation: request.generation,
                    error,
                };
            }
        }
        self.user_card.loading_older = false;
        self.user_card.active_history_request_id = None;

        true
    }

    fn next_user_card_history_request_id(&mut self) -> u64 {
        self.user_card.history_request_id = self.user_card.history_request_id.saturating_add(1);
        self.user_card.history_request_id
    }

    pub fn start_user_card_metadata_load(&mut self) -> Option<u64> {
        if !self.user_card.open || self.user_card.target.is_none() {
            return None;
        }

        let generation = self.user_card.generation;
        self.user_card.metadata = UserCardLoadState::Loading { generation };
        Some(generation)
    }

    pub fn apply_user_card_metadata_result(
        &mut self,
        generation: u64,
        result: Result<crate::protocol::messages::UserCardMetadataResponse, String>,
    ) -> bool {
        if !self.user_card.open || self.user_card.generation != generation {
            return false;
        }

        match result {
            Ok(metadata) => {
                self.user_card.metadata = UserCardLoadState::Loaded {
                    generation,
                    value: metadata,
                };
            }
            Err(error) => {
                self.user_card.metadata = UserCardLoadState::Error { generation, error };
            }
        }

        true
    }

    pub fn resolve_user_card_target(&self, query: &str) -> Option<UserCardTarget> {
        let id_query = query.trim().trim_start_matches('@');
        if id_query.is_empty() {
            return None;
        }

        let messages = self.active_user_card_messages();
        self.resolve_user_card_target_in_messages(messages, id_query)
            .or_else(|| {
                if self.active_channel_tab_id == "home" {
                    None
                } else {
                    self.resolve_user_card_target_in_messages(&self.messages, id_query)
                }
            })
    }

    pub fn set_user_alias(
        &mut self,
        storage: &Storage,
        platform: Platform,
        platform_user_id: &str,
        alias: &str,
    ) -> crate::storage::StorageResult<bool> {
        let alias = alias.trim();
        if platform_user_id.is_empty() {
            return Ok(false);
        }

        if alias.is_empty() {
            return self.remove_user_alias(storage, platform, platform_user_id);
        }

        storage
            .user_aliases()
            .upsert(platform, platform_user_id, alias)?;
        self.aliases
            .set(platform, platform_user_id.to_string(), alias.to_string());
        self.update_open_user_card_alias(platform, platform_user_id);
        Ok(true)
    }

    pub fn remove_user_alias(
        &mut self,
        storage: &Storage,
        platform: Platform,
        platform_user_id: &str,
    ) -> crate::storage::StorageResult<bool> {
        if platform_user_id.is_empty() {
            return Ok(false);
        }

        storage.user_aliases().remove(platform, platform_user_id)?;
        self.aliases.remove(platform, platform_user_id);
        self.update_open_user_card_alias(platform, platform_user_id);
        Ok(true)
    }

    pub fn remove_chat_pane_for_active_tab(
        &mut self,
        storage: &Storage,
        panel_id: &str,
    ) -> crate::storage::StorageResult<bool> {
        let tab_id = self.active_channel_tab_id.clone();
        if tab_id == "home" {
            return Ok(false);
        }

        let mut layout = self
            .watched_layouts
            .get(&tab_id)
            .cloned()
            .unwrap_or_else(|| create_default_tab_layout(&tab_id));
        let removed_channel_id = panel_watched_channel_id(&layout.root, panel_id);
        if !remove_panel_from_layout(&mut layout.root, panel_id) {
            return Ok(false);
        }

        storage.watched_layout().set(&tab_id, &layout)?;
        self.watched_layouts.insert(tab_id, layout);
        if let Some(channel_id) = removed_channel_id
            && !self.is_watched_channel_referenced(&channel_id)
        {
            self.remove_watched_channel(&channel_id);
            Self::remove_watched_channel_storage(storage, &channel_id)?;
            self.persist_visible_tab_order(storage)?;
        }
        Ok(true)
    }

    fn is_watched_channel_referenced(&self, channel_id: &str) -> bool {
        self.watched_tab_channel_ids
            .iter()
            .any(|id| id == channel_id)
            || self
                .watched_tab_channel_ids
                .iter()
                .filter_map(|tab_id| self.watched_layouts.get(tab_id))
                .any(|layout| layout_contains_watched_channel(&layout.root, channel_id))
    }

    pub fn move_chat_pane_for_active_tab(
        &mut self,
        storage: &Storage,
        source_id: &str,
        target_id: &str,
        direction: PaneDropDirection,
    ) -> crate::storage::StorageResult<bool> {
        let tab_id = self.active_channel_tab_id.clone();
        if tab_id == "home" || source_id == target_id {
            return Ok(false);
        }

        let mut layout = self
            .watched_layouts
            .get(&tab_id)
            .cloned()
            .unwrap_or_else(|| create_default_tab_layout(&tab_id));
        if panel_is_main(&layout.root, source_id).unwrap_or(true) {
            return Ok(false);
        }

        let Some(source_panel) = take_panel_from_layout(&mut layout.root, source_id) else {
            return Ok(false);
        };
        collapse_single_child_splits(&mut layout.root);

        if !insert_panel_near_target(&mut layout.root, source_panel, target_id, direction) {
            return Ok(false);
        }

        storage.watched_layout().set(&tab_id, &layout)?;
        self.watched_layouts.insert(tab_id, layout);
        Ok(true)
    }

    pub fn close_tab_add_menu(&mut self) {
        self.close_add_channel_modal();
    }

    fn upsert_watched_channel(
        &mut self,
        storage: &Storage,
        platform: Platform,
        channel_slug: &str,
    ) -> crate::storage::StorageResult<Option<WatchedChannel>> {
        let slug = channel_slug.trim().to_lowercase();
        if slug.is_empty() {
            return Ok(None);
        }

        let channel = storage.watched_channels().upsert(platform, &slug, &slug)?;
        if !self
            .watched_channels
            .iter()
            .any(|existing| existing.id == channel.id)
        {
            self.watched_channels.push(channel.clone());
        }
        self.watched_layouts
            .entry(channel.id.clone())
            .or_insert_with(|| create_default_tab_layout(&channel.id));
        self.queue_watched_channel_add(
            channel.platform,
            channel.channel_slug.clone(),
            Some(channel.display_name.clone()),
        );
        Ok(Some(channel))
    }

    fn assign_watched_channel_to_active_panel(
        &mut self,
        storage: &Storage,
        panel_id: &str,
        platform: Platform,
        channel_slug: &str,
    ) -> crate::storage::StorageResult<bool> {
        let tab_id = self.active_channel_tab_id.clone();
        if tab_id == "home" {
            return Ok(false);
        }

        let Some(channel) = self.upsert_watched_channel(storage, platform, channel_slug)? else {
            return Ok(false);
        };

        let mut layout = self
            .watched_layouts
            .get(&tab_id)
            .cloned()
            .unwrap_or_else(|| create_default_tab_layout(&tab_id));
        if !assign_channel_to_panel(&mut layout.root, panel_id, &channel.id) {
            return Ok(false);
        }

        storage.watched_layout().set(&tab_id, &layout)?;
        self.watched_layouts.insert(tab_id, layout);
        self.close_add_channel_modal();
        Ok(true)
    }

    pub fn take_pending_watched_channel_adds(&mut self) -> Vec<PendingWatchedChannelAdd> {
        std::mem::take(&mut self.pending_watched_channel_adds)
    }

    pub fn take_pending_watched_channel_messages(&mut self) -> Vec<PendingWatchedChannelMessage> {
        std::mem::take(&mut self.pending_watched_channel_messages)
    }

    pub fn take_pending_watched_channel_removals(&mut self) -> Vec<PendingWatchedChannelRemove> {
        std::mem::take(&mut self.pending_watched_channel_removals)
    }

    pub fn take_pending_backend_messages(
        &mut self,
    ) -> Vec<crate::protocol::messages::DesktopToBackendMessage> {
        std::mem::take(&mut self.pending_backend_messages)
    }

    pub fn mark_watched_send_dispatch_failed(
        &mut self,
        client_message_id: Option<&str>,
        error: String,
    ) {
        if let Some(client_message_id) = client_message_id {
            self.mark_outgoing_message_error(client_message_id, error);
        } else {
            self.runtime_errors.push(error);
        }
    }

    fn queue_watched_channel_add(
        &mut self,
        platform: Platform,
        channel_slug: String,
        display_name: Option<String>,
    ) {
        if self.pending_watched_channel_adds.iter().any(|pending| {
            pending.platform == platform && pending.channel_slug.eq_ignore_ascii_case(&channel_slug)
        }) {
            return;
        }

        eprintln!(
            "[watched/live] queued watched-channel add platform={:?} slug={}",
            platform, channel_slug
        );
        self.pending_watched_channel_adds
            .push(PendingWatchedChannelAdd {
                platform,
                channel_slug,
                display_name,
            });
    }

    fn queue_watched_channel_remove(&mut self, channel_id: String) {
        if self
            .pending_watched_channel_removals
            .iter()
            .any(|pending| pending.channel_id == channel_id)
        {
            return;
        }

        self.pending_watched_channel_removals
            .push(PendingWatchedChannelRemove { channel_id });
    }

    fn insert_optimistic_watched_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_target: Option<&NormalizedChatMessage>,
    ) -> String {
        self.next_outgoing_message_sequence = self.next_outgoing_message_sequence.saturating_add(1);
        let client_message_id = format!(
            "local:{}:{}",
            crate::storage::now_millis(),
            self.next_outgoing_message_sequence
        );

        let channel = self
            .watched_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .cloned();

        let self_account = channel.as_ref().and_then(|channel| {
            self.platforms_panel
                .accounts
                .iter()
                .find(|account| {
                    account.platform == channel.platform
                        && account.username.eq_ignore_ascii_case(&channel.channel_slug)
                })
                .or_else(|| {
                    self.platforms_panel
                        .accounts
                        .iter()
                        .find(|account| account.platform == channel.platform)
                })
        });

        let fallback_display_name = channel
            .as_ref()
            .map(|channel| channel.display_name.clone())
            .unwrap_or_else(|| "You".to_string());

        let platform = channel
            .as_ref()
            .map(|channel| channel.platform)
            .unwrap_or(Platform::Twitch);

        let mut optimistic_message = NormalizedChatMessage {
            id: client_message_id.clone(),
            platform,
            channel_id: channel_id.to_string(),
            author: ChatAuthor {
                id: self_account
                    .map(|account| account.platform_user_id.clone())
                    .filter(|id| !id.is_empty())
                    .unwrap_or_else(|| format!("local-self-{platform:?}").to_lowercase()),
                username: self_account.map(|account| account.username.clone()),
                display_name: self_account
                    .map(|account| account.display_name.clone())
                    .unwrap_or(fallback_display_name),
                color: None,
                avatar_url: self_account.and_then(|account| account.avatar_url.clone()),
                badges: Vec::new(),
            },
            text: text.to_string(),
            emotes: Vec::new(),
            timestamp: crate::storage::now_millis().to_string(),
            message_type: ChatMessageType::Message,
            reply: reply_target.map(chat_reply_from_message),
        };

        if let Some(account) = self_account
            && let Some(history) = self.watched_channel_messages.get(channel_id)
            && let Some(cached_self) = history.iter().rev().find(|message| {
                message.platform == account.platform
                    && message
                        .author
                        .id
                        .eq_ignore_ascii_case(&account.platform_user_id)
            })
        {
            optimistic_message.author.badges = cached_self.author.badges.clone();
            if optimistic_message.author.avatar_url.is_none() {
                optimistic_message.author.avatar_url = cached_self.author.avatar_url.clone();
            }
            if optimistic_message.author.color.is_none() {
                optimistic_message.author.color = cached_self.author.color.clone();
            }
        }

        if let Some(history) = self.watched_channel_messages.get_mut(channel_id) {
            history.push(optimistic_message.clone());
        } else {
            self.watched_channel_messages
                .insert(channel_id.to_string(), vec![optimistic_message.clone()]);
        }

        if self.is_home_account_channel_id(channel_id) {
            self.messages.push(optimistic_message);
        }

        self.outgoing_message_statuses.insert(
            client_message_id.clone(),
            OutgoingChatMessageStatus::Pending,
        );
        client_message_id
    }

    fn reconcile_outgoing_echo(
        &mut self,
        channel_id: &str,
        message: &NormalizedChatMessage,
    ) -> bool {
        let Some(channel) = self
            .watched_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .cloned()
        else {
            return false;
        };

        let self_account = self
            .platforms_panel
            .accounts
            .iter()
            .find(|account| {
                account.platform == channel.platform
                    && account.username.eq_ignore_ascii_case(&channel.channel_slug)
            })
            .or_else(|| {
                self.platforms_panel
                    .accounts
                    .iter()
                    .find(|account| account.platform == channel.platform)
            });

        let optimistic_id = self
            .watched_channel_messages
            .get(channel_id)
            .and_then(|messages| {
                messages.iter().find_map(|candidate| {
                    if candidate.channel_id != channel_id
                        || candidate.platform != message.platform
                        || candidate.text != message.text
                        || !candidate.id.starts_with("local:")
                    {
                        return None;
                    }

                    let status = self.outgoing_message_statuses.get(&candidate.id)?;
                    if !matches!(
                        status,
                        OutgoingChatMessageStatus::Pending | OutgoingChatMessageStatus::Sent
                    ) {
                        return None;
                    }

                    if let Some(account) = self_account
                        && !message
                            .author
                            .id
                            .eq_ignore_ascii_case(&account.platform_user_id)
                    {
                        return None;
                    }

                    Some(candidate.id.clone())
                })
            });

        let Some(optimistic_id) = optimistic_id else {
            return false;
        };

        if let Some(history) = self.watched_channel_messages.get_mut(channel_id)
            && let Some(position) = history.iter().position(|entry| entry.id == optimistic_id)
        {
            if history.iter().any(|entry| entry.id == message.id) {
                history.remove(position);
            } else {
                history[position] = message.clone();
            }
        }

        if self.is_home_account_channel_id(channel_id) {
            if let Some(position) = self
                .messages
                .iter()
                .position(|entry| entry.id == optimistic_id)
            {
                if self.messages.iter().any(|entry| entry.id == message.id) {
                    self.messages.remove(position);
                } else {
                    self.messages[position] = message.clone();
                }
            } else if !self.messages.iter().any(|entry| entry.id == message.id) {
                self.messages.push(message.clone());
            }
        }

        self.outgoing_message_statuses.remove(&optimistic_id);
        true
    }

    fn mark_outgoing_message_sent(&mut self, client_message_id: &str) {
        if let Some(status) = self.outgoing_message_statuses.get_mut(client_message_id) {
            *status = OutgoingChatMessageStatus::Sent;
        }
    }

    fn mark_outgoing_message_error(&mut self, client_message_id: &str, error: String) {
        if let Some(status) = self.outgoing_message_statuses.get_mut(client_message_id) {
            *status = OutgoingChatMessageStatus::Error;
        }
        if let Some(text) = self
            .watched_channel_messages
            .values()
            .flat_map(|messages| messages.iter())
            .find(|message| message.id == client_message_id)
            .map(|message| message.text.clone())
        {
            self.remove_sent_message_history(&text);
        }
        self.runtime_errors.push(error);
    }

    fn remove_sent_message_history(&mut self, text: &str) {
        if let Some(index) = self
            .sent_message_history
            .iter()
            .rposition(|entry| entry == text)
        {
            self.sent_message_history.remove(index);
        }
    }

    fn is_home_account_channel(&self, channel: &WatchedChannel) -> bool {
        self.platforms_panel.accounts.iter().any(|account| {
            account.platform == channel.platform
                && account.username.eq_ignore_ascii_case(&channel.channel_slug)
        })
    }

    fn is_home_account_channel_id(&self, channel_id: &str) -> bool {
        self.watched_channels
            .iter()
            .find(|channel| channel.id == channel_id)
            .is_some_and(|channel| self.is_home_account_channel(channel))
    }

    fn active_user_card_messages(&self) -> &[NormalizedChatMessage] {
        if self.active_channel_tab_id == "home" {
            &self.messages
        } else {
            self.watched_channel_messages
                .get(&self.active_channel_tab_id)
                .map(Vec::as_slice)
                .unwrap_or(&self.messages)
        }
    }

    fn resolve_user_card_target_in_messages(
        &self,
        messages: &[NormalizedChatMessage],
        query: &str,
    ) -> Option<UserCardTarget> {
        let normalized_query = normalize_user_lookup(query);
        if normalized_query.is_empty() {
            return None;
        }

        self.resolve_user_card_message_by(
            messages,
            |message| message.author.id == query,
            |message| {
                normalize_user_lookup(message.author.username.as_deref().unwrap_or(""))
                    == normalized_query
            },
            |message| normalize_user_lookup(&message.author.display_name) == normalized_query,
        )
        .map(|message| self.user_card_target_for_message(message))
    }

    fn resolve_user_card_message_by<'a, IdMatch, UsernameMatch, DisplayMatch>(
        &self,
        messages: &'a [NormalizedChatMessage],
        id_match: IdMatch,
        username_match: UsernameMatch,
        display_match: DisplayMatch,
    ) -> Option<&'a NormalizedChatMessage>
    where
        IdMatch: Fn(&NormalizedChatMessage) -> bool,
        UsernameMatch: Fn(&NormalizedChatMessage) -> bool,
        DisplayMatch: Fn(&NormalizedChatMessage) -> bool,
    {
        messages
            .iter()
            .rev()
            .find(|message| id_match(message))
            .or_else(|| {
                messages
                    .iter()
                    .rev()
                    .find(|message| username_match(message))
            })
            .or_else(|| messages.iter().rev().find(|message| display_match(message)))
    }

    pub fn user_card_target_for_message(&self, message: &NormalizedChatMessage) -> UserCardTarget {
        UserCardTarget {
            platform: message.platform,
            platform_user_id: message.author.id.clone(),
            channel_id: message.channel_id.clone(),
            channel_slug: self.user_card_channel_slug(message),
            display_name: message.author.display_name.clone(),
            username: message.author.username.clone(),
            avatar_url: message.author.avatar_url.clone(),
            current_alias: self.alias_for_message(message).map(str::to_string),
        }
    }

    pub fn user_card_channel_slug(&self, message: &NormalizedChatMessage) -> String {
        self.watched_channels
            .iter()
            .find(|channel| channel.id == message.channel_id)
            .map(|channel| channel.channel_slug.clone())
            .or_else(|| {
                self.platforms_panel
                    .statuses
                    .values()
                    .find(|status| {
                        status.platform == message.platform
                            && status.channel_login.as_deref().is_some_and(|login| {
                                login.eq_ignore_ascii_case(&message.channel_id)
                            })
                    })
                    .and_then(|status| status.channel_login.clone())
            })
            .or_else(|| {
                self.platforms_panel
                    .accounts
                    .iter()
                    .find(|account| {
                        account.platform == message.platform
                            && account.username.eq_ignore_ascii_case(&message.channel_id)
                    })
                    .map(|account| account.username.clone())
            })
            .unwrap_or_else(|| message.channel_id.clone())
    }

    fn update_open_user_card_alias(&mut self, platform: Platform, platform_user_id: &str) {
        let current_alias = self
            .alias_for_user(platform, platform_user_id)
            .map(str::to_string);
        let Some(target) = self.user_card.target.as_mut() else {
            return;
        };
        if target.platform == platform && target.platform_user_id == platform_user_id {
            target.current_alias = current_alias;
        }
    }

    fn home_channel_targets(&self) -> Vec<HomeChannelTarget> {
        let mut targets = Vec::new();
        let mut seen = BTreeSet::new();

        for status in self.platforms_panel.statuses.values() {
            let Some(channel_login) = status.channel_login.as_ref() else {
                continue;
            };
            if !matches!(
                status.status,
                PlatformStatus::Connected | PlatformStatus::Connecting
            ) {
                continue;
            }

            let id = home_channel_target_id(status.platform, channel_login);
            if !seen.insert(id.clone()) {
                continue;
            }

            targets.push(HomeChannelTarget {
                id,
                platform: status.platform,
                channel_login: channel_login.clone(),
                watched_channel_id: self
                    .watched_channels
                    .iter()
                    .find(|channel| {
                        channel.platform == status.platform
                            && channel.channel_slug.eq_ignore_ascii_case(channel_login)
                    })
                    .map(|channel| channel.id.clone()),
            });
        }

        targets
    }

    pub fn dismiss_update_toast(&mut self) {
        self.update_state.show = false;
    }

    #[cfg(test)]
    pub(crate) fn set_unread_events_for_test(&mut self, unread_events: usize) {
        self.unread_events = unread_events;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HomeChannelTarget {
    id: String,
    platform: Platform,
    channel_login: String,
    watched_channel_id: Option<String>,
}

fn chat_reply_from_message(message: &NormalizedChatMessage) -> ChatReply {
    ChatReply {
        parent_message_id: message.id.clone(),
        parent_message_text: message.text.clone(),
        parent_author: ReplyAuthor {
            id: message.author.id.clone(),
            username: message.author.username.clone().unwrap_or_default(),
            display_name: message.author.display_name.clone(),
        },
    }
}

fn home_reply_matches_target(reply: &NormalizedChatMessage, target: &HomeChannelTarget) -> bool {
    reply.platform == target.platform
}

fn home_channel_target_id(platform: Platform, channel_login: &str) -> String {
    format!("{platform:?}:{}", channel_login.to_lowercase())
}

fn backfill_badge_images(messages: &mut [NormalizedChatMessage], source: &NormalizedChatMessage) {
    for source_badge in source
        .author
        .badges
        .iter()
        .filter(|badge| badge.image_url.is_some())
    {
        for message in messages.iter_mut().filter(|message| {
            message.platform == source.platform && message.channel_id == source.channel_id
        }) {
            for badge in &mut message.author.badges {
                if badge.id == source_badge.id && badge.image_url.is_none() {
                    badge.image_url = source_badge.image_url.clone();
                }
            }
        }
    }
}

fn hydrate_badge_images_from_snapshot(messages: &mut [NormalizedChatMessage]) {
    let sources = messages
        .iter()
        .filter(|message| {
            message
                .author
                .badges
                .iter()
                .any(|badge| badge.image_url.is_some())
        })
        .cloned()
        .collect::<Vec<_>>();

    for source in &sources {
        backfill_badge_images(messages, source);
    }
}

fn map_backend_seven_tv_emote(emote: crate::protocol::messages::SevenTvEmote) -> SevenTvEmote {
    SevenTvEmote {
        id: emote.id,
        name: emote.alias,
        image_url: emote.image_url,
        animated: emote.animated,
        zero_width: emote.zero_width,
        aspect_ratio: emote.aspect_ratio,
    }
}

fn seven_tv_system_message_data(
    message: &crate::protocol::messages::SevenTvSystemMessage,
) -> (String, Vec<crate::protocol::types::Emote>) {
    let preview_emotes = match message {
        crate::protocol::messages::SevenTvSystemMessage::Added { emote, .. }
        | crate::protocol::messages::SevenTvSystemMessage::Removed { emote, .. }
        | crate::protocol::messages::SevenTvSystemMessage::Updated { emote, .. } => {
            vec![crate::protocol::types::Emote {
                id: emote.id.clone(),
                name: emote.alias.clone(),
                image_url: emote.image_url.clone(),
                positions: Vec::new(),
                aspect_ratio: Some(emote.aspect_ratio),
            }]
        }
        _ => Vec::new(),
    };

    let text = match message {
        crate::protocol::messages::SevenTvSystemMessage::Added { emote, .. } => {
            format!("Emote {} added to the channel", emote.alias)
        }
        crate::protocol::messages::SevenTvSystemMessage::Removed { emote, .. } => {
            format!("Emote {} removed from the channel", emote.alias)
        }
        crate::protocol::messages::SevenTvSystemMessage::Updated {
            emote, old_alias, ..
        } => old_alias.as_ref().map_or_else(
            || format!("Emote {} updated in the channel", emote.alias),
            |old_alias| {
                format!(
                    "Emote {} updated in the channel (was {old_alias})",
                    emote.alias
                )
            },
        ),
        crate::protocol::messages::SevenTvSystemMessage::SetChanged { set_name } => {
            format!("7TV emote set changed: {set_name}")
        }
        crate::protocol::messages::SevenTvSystemMessage::SetRenamed { old_name, new_name } => {
            format!("7TV emote set renamed: {old_name} → {new_name}")
        }
        crate::protocol::messages::SevenTvSystemMessage::SetDeleted { set_name } => {
            format!("7TV emote set deleted: {set_name}")
        }
    };

    (text, preview_emotes)
}

fn message_matches_seven_tv_channel(
    watched_channels: &[WatchedChannel],
    platform: Platform,
    message_channel_id: &str,
    seven_tv_channel_id: &str,
) -> bool {
    message_channel_id == seven_tv_channel_id
        || watched_channels.iter().any(|channel| {
            channel.platform == platform
                && channel.channel_slug == seven_tv_channel_id
                && channel.id == message_channel_id
        })
}

fn is_seven_tv_emote(emote: &crate::protocol::types::Emote) -> bool {
    emote.image_url.contains("7tv") || emote.image_url.contains("/proxy/7tv/")
}

fn dedupe_channel_ids(channel_ids: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    channel_ids.retain(|channel_id| seen.insert(channel_id.to_lowercase()));
}

pub trait AppStateActions {
    fn select_section(&self, app: &mut App, section: MainSection);
    fn select_channel_tab(&self, app: &mut App, tab_id: &str);
    fn toggle_sidebar(&self, app: &mut App);
    fn set_update_state(&self, app: &mut App, state: UpdateStatusSnapshot);
    fn dismiss_update_toast(&self, app: &mut App);
    fn set_theme(&self, app: &mut App, theme: AppTheme);
    fn set_chat_theme(&self, app: &mut App, chat_theme: ChatTheme);
    fn set_font_family(&self, app: &mut App, font: FontFamilyChoice);
    fn set_system_font_family(&self, app: &mut App, font_family: String);
    fn set_font_size(&self, app: &mut App, font_size: f64);
    fn set_show_platform_color_stripe(&self, app: &mut App, show: bool);
    fn set_show_platform_icon(&self, app: &mut App, show: bool);
    fn set_show_timestamp(&self, app: &mut App, show: bool);
    fn set_show_avatars(&self, app: &mut App, show: bool);
    fn set_show_badges(&self, app: &mut App, show: bool);
    fn set_show_moderation_buttons(&self, app: &mut App, show: bool);
    fn set_moderation_presets(&self, app: &mut App, presets: Vec<ModerationPresetKind>);
    fn open_moderation_popover(&self, app: &mut App, target: String, duration_seconds: u32);
    fn close_moderation_popover(&self, app: &mut App);
    fn set_moderation_popover_duration(&self, app: &mut App, duration_seconds: u32);
    fn set_moderation_drag_preview(
        &self,
        app: &mut App,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
        restore_follow_on_drop: bool,
    );
    fn update_moderation_drag_action(
        &self,
        app: &mut App,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
    );
    fn clear_moderation_drag_preview(&self, app: &mut App);
    fn set_auto_check_updates(&self, app: &mut App, enabled: bool);
    fn set_self_ping(&self, app: &mut App, enabled: bool, color: String);
    fn update_overlay_config(&self, app: &mut App, config: OverlayConfig);
    fn set_overlay_background(&self, app: &mut App, background: String);
    fn set_overlay_text_color(&self, app: &mut App, text_color: String);
    fn set_overlay_font_size(&self, app: &mut App, font_size: f64);
    fn set_overlay_font_family(&self, app: &mut App, font_family: String);
    fn set_overlay_max_messages(&self, app: &mut App, max_messages: u32);
    fn set_overlay_message_timeout(&self, app: &mut App, message_timeout: u64);
    fn set_overlay_show_platform_icon(&self, app: &mut App, show: bool);
    fn set_overlay_show_avatar(&self, app: &mut App, show: bool);
    fn set_overlay_show_badges(&self, app: &mut App, show: bool);
    fn set_overlay_animation(&self, app: &mut App, animation: OverlayAnimation);
    fn set_overlay_position(&self, app: &mut App, position: OverlayPosition);
    fn set_overlay_port(&self, app: &mut App, port: u16);
    fn toggle_chat_appearance_popover(&self, app: &mut App, target: &str);
    fn toggle_chat_add_menu(&self, app: &mut App);
    fn toggle_chat_options_menu(&self, app: &mut App);
    fn open_add_channel_modal(&self, app: &mut App);
    fn open_add_channel_modal_for_panel(&self, app: &mut App, panel_id: &str);
    fn close_add_channel_modal(&self, app: &mut App);
    fn select_add_channel_platform(&self, app: &mut App, platform: Platform);
    fn add_watched_channel_from_slug(&self, app: &mut App, platform: Platform, channel_slug: &str);
    fn add_watched_channel_tab_from_slug(
        &self,
        app: &mut App,
        platform: Platform,
        channel_slug: &str,
    );
    fn submit_add_channel_modal(&self, app: &mut App, platform: Platform, channel_slug: &str);
    fn remove_watched_channel(&self, app: &mut App, channel_id: &str);
    fn remove_watched_channel_for_tab(&self, app: &mut App, channel_id: &str);
    fn reorder_watched_channel_tab(&self, app: &mut App, from_id: &str, to_id: &str);
    fn start_watched_tab_rename(&self, app: &mut App, tab_id: &str);
    fn cancel_watched_tab_rename(&self, app: &mut App);
    fn rename_watched_tab(&self, app: &mut App, tab_id: &str, name: &str);
    fn set_channel_tab_hovered(&self, app: &mut App, tab_id: &str, hovered: bool);
    fn open_watched_tab_context_menu(&self, app: &mut App, tab_id: &str);
    fn close_watched_tab_context_menu(&self, app: &mut App);
    fn queue_composer_send(&self, app: &mut App, text: &str) -> bool;
    fn queue_watched_channel_send(&self, app: &mut App, channel_id: &str, text: &str) -> bool;
    fn open_user_card(&self, app: &mut App, target: UserCardTarget);
    fn close_user_card(&self, app: &mut App);
    fn start_user_card_history_load(&self, app: &mut App) -> Option<UserCardHistoryRequest>;
    fn apply_user_card_history_result(
        &self,
        app: &mut App,
        request: UserCardHistoryRequest,
        result: Result<UserCardHistoryPage, String>,
    ) -> bool;
    fn start_user_card_metadata_load(&self, app: &mut App) -> Option<u64>;
    fn apply_user_card_metadata_result(
        &self,
        app: &mut App,
        generation: u64,
        result: Result<crate::protocol::messages::UserCardMetadataResponse, String>,
    ) -> bool;
    fn set_user_alias(
        &self,
        app: &mut App,
        platform: Platform,
        platform_user_id: &str,
        alias: &str,
    );
    fn remove_user_alias(&self, app: &mut App, platform: Platform, platform_user_id: &str);
    fn toggle_composer_channel(&self, app: &mut App, channel_id: &str);
    fn add_chat_pane_for_active_tab(&self, app: &mut App);
    fn remove_chat_pane_for_active_tab(&self, app: &mut App, panel_id: &str);
    fn move_chat_pane_for_active_tab(
        &self,
        app: &mut App,
        source_id: &str,
        target_id: &str,
        direction: PaneDropDirection,
    );
    fn add_watched_channel_from_account(&self, app: &mut App, account_id: &str);
    fn connect_kick_account(&self, app: &mut App);
    fn connect_twitch_account(&self, app: &mut App);
    fn connect_platform_account_placeholder(&self, app: &mut App, platform: Platform);
    fn disconnect_platform_account(&self, app: &mut App, platform: Platform);
    fn join_channel_from_account(&self, app: &mut App, platform: Platform);
    fn persist_settings(&self, app: &mut App);
}

impl AppStateActions for Entity<AppState> {
    fn select_section(&self, app: &mut App, section: MainSection) {
        self.update(app, |state, cx| {
            state.select_section(section);
            cx.notify();
        });
    }

    fn select_channel_tab(&self, app: &mut App, tab_id: &str) {
        self.update(app, |state, cx| {
            state.select_channel_tab(tab_id);
            cx.notify();
        });
    }

    fn toggle_sidebar(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.toggle_sidebar();
            cx.notify();
        });
    }

    fn set_update_state(&self, app: &mut App, update_state: UpdateStatusSnapshot) {
        self.update(app, |state, cx| {
            state.set_update_state(update_state);
            cx.notify();
        });
    }

    fn dismiss_update_toast(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.dismiss_update_toast();
            cx.notify();
        });
    }

    fn set_theme(&self, app: &mut App, theme: AppTheme) {
        self.update(app, |state, cx| {
            state.set_theme(theme);
            cx.notify();
        });
    }

    fn set_chat_theme(&self, app: &mut App, chat_theme: ChatTheme) {
        self.update(app, |state, cx| {
            state.set_chat_theme(chat_theme);
            cx.notify();
        });
    }

    fn set_font_family(&self, app: &mut App, font: FontFamilyChoice) {
        self.update(app, |state, cx| {
            state.set_font_family(font);
            cx.notify();
        });
    }

    fn set_system_font_family(&self, app: &mut App, font_family: String) {
        self.update(app, |state, cx| {
            state.set_system_font_family(font_family);
            cx.notify();
        });
    }

    fn set_font_size(&self, app: &mut App, font_size: f64) {
        self.update(app, |state, cx| {
            state.set_font_size(font_size);
            cx.notify();
        });
    }

    fn set_show_platform_color_stripe(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_platform_color_stripe(show);
            cx.notify();
        });
    }

    fn set_show_platform_icon(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_platform_icon(show);
            cx.notify();
        });
    }

    fn set_show_timestamp(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_timestamp(show);
            cx.notify();
        });
    }

    fn set_show_avatars(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_avatars(show);
            cx.notify();
        });
    }

    fn set_show_badges(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_badges(show);
            cx.notify();
        });
    }

    fn set_show_moderation_buttons(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_show_moderation_buttons(show);
            cx.notify();
        });
    }

    fn set_moderation_presets(&self, app: &mut App, presets: Vec<ModerationPresetKind>) {
        self.update(app, |state, cx| {
            state.set_moderation_presets(presets);
            cx.notify();
        });
    }

    fn open_moderation_popover(&self, app: &mut App, target: String, duration_seconds: u32) {
        self.update(app, |state, cx| {
            state.open_moderation_popover(target, duration_seconds);
            cx.notify();
        });
    }

    fn close_moderation_popover(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.close_moderation_popover();
            cx.notify();
        });
    }

    fn set_moderation_popover_duration(&self, app: &mut App, duration_seconds: u32) {
        self.update(app, |state, cx| {
            state.set_moderation_popover_duration(duration_seconds);
            cx.notify();
        });
    }

    fn set_moderation_drag_preview(
        &self,
        app: &mut App,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
        restore_follow_on_drop: bool,
    ) {
        self.update(app, |state, cx| {
            state.set_moderation_drag_preview(
                target,
                action,
                duration_seconds,
                restore_follow_on_drop,
            );
            cx.notify();
        });
    }

    fn update_moderation_drag_action(
        &self,
        app: &mut App,
        target: String,
        action: crate::protocol::types::ModerationAction,
        duration_seconds: Option<u32>,
    ) {
        self.update(app, |state, cx| {
            state.update_moderation_drag_action(target, action, duration_seconds);
            cx.notify();
        });
    }

    fn clear_moderation_drag_preview(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.clear_moderation_drag_preview();
            cx.notify();
        });
    }

    fn set_auto_check_updates(&self, app: &mut App, enabled: bool) {
        self.update(app, |state, cx| {
            state.set_auto_check_updates(enabled);
            cx.notify();
        });
    }

    fn set_self_ping(&self, app: &mut App, enabled: bool, color: String) {
        self.update(app, |state, cx| {
            state.set_self_ping(enabled, color);
            cx.notify();
        });
    }

    fn update_overlay_config(&self, app: &mut App, config: OverlayConfig) {
        self.update(app, |state, cx| {
            state.update_overlay_config(config);
            cx.notify();
        });
    }

    fn set_overlay_background(&self, app: &mut App, background: String) {
        self.update(app, |state, cx| {
            state.set_overlay_background(background);
            cx.notify();
        });
    }

    fn set_overlay_text_color(&self, app: &mut App, text_color: String) {
        self.update(app, |state, cx| {
            state.set_overlay_text_color(text_color);
            cx.notify();
        });
    }

    fn set_overlay_font_size(&self, app: &mut App, font_size: f64) {
        self.update(app, |state, cx| {
            state.set_overlay_font_size(font_size);
            cx.notify();
        });
    }

    fn set_overlay_font_family(&self, app: &mut App, font_family: String) {
        self.update(app, |state, cx| {
            state.set_overlay_font_family(font_family);
            cx.notify();
        });
    }

    fn set_overlay_max_messages(&self, app: &mut App, max_messages: u32) {
        self.update(app, |state, cx| {
            state.set_overlay_max_messages(max_messages);
            cx.notify();
        });
    }

    fn set_overlay_message_timeout(&self, app: &mut App, message_timeout: u64) {
        self.update(app, |state, cx| {
            state.set_overlay_message_timeout(message_timeout);
            cx.notify();
        });
    }

    fn set_overlay_show_platform_icon(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_overlay_show_platform_icon(show);
            cx.notify();
        });
    }

    fn set_overlay_show_avatar(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_overlay_show_avatar(show);
            cx.notify();
        });
    }

    fn set_overlay_show_badges(&self, app: &mut App, show: bool) {
        self.update(app, |state, cx| {
            state.set_overlay_show_badges(show);
            cx.notify();
        });
    }

    fn set_overlay_animation(&self, app: &mut App, animation: OverlayAnimation) {
        self.update(app, |state, cx| {
            state.set_overlay_animation(animation);
            cx.notify();
        });
    }

    fn set_overlay_position(&self, app: &mut App, position: OverlayPosition) {
        self.update(app, |state, cx| {
            state.set_overlay_position(position);
            cx.notify();
        });
    }

    fn set_overlay_port(&self, app: &mut App, port: u16) {
        self.update(app, |state, cx| {
            state.set_overlay_port(port);
            cx.notify();
        });
    }

    fn toggle_chat_appearance_popover(&self, app: &mut App, target: &str) {
        self.update(app, |state, cx| {
            state.toggle_chat_appearance_popover(target);
            cx.notify();
        });
    }

    fn toggle_chat_add_menu(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.toggle_chat_add_menu();
            cx.notify();
        });
    }

    fn toggle_chat_options_menu(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.toggle_chat_options_menu();
            cx.notify();
        });
    }

    fn open_add_channel_modal(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.open_add_channel_modal();
            cx.notify();
        });
    }

    fn open_add_channel_modal_for_panel(&self, app: &mut App, panel_id: &str) {
        self.update(app, |state, cx| {
            state.open_add_channel_modal_for_panel(panel_id);
            cx.notify();
        });
    }

    fn close_add_channel_modal(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.close_add_channel_modal();
            cx.notify();
        });
    }

    fn select_add_channel_platform(&self, app: &mut App, platform: Platform) {
        self.update(app, |state, cx| {
            state.select_add_channel_platform(platform);
            cx.notify();
        });
    }

    fn add_watched_channel_from_slug(&self, app: &mut App, platform: Platform, channel_slug: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) =
                        state.add_watched_channel_from_slug(&storage, platform, channel_slug)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn add_watched_channel_tab_from_slug(
        &self,
        app: &mut App,
        platform: Platform,
        channel_slug: &str,
    ) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) =
                        state.add_watched_channel_tab_from_slug(&storage, platform, channel_slug)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn submit_add_channel_modal(&self, app: &mut App, platform: Platform, channel_slug: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) =
                        state.submit_add_channel_modal(&storage, platform, channel_slug)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn remove_watched_channel(&self, app: &mut App, channel_id: &str) {
        self.update(app, |state, cx| {
            state.remove_watched_channel(channel_id);
            cx.notify();
        });
    }

    fn remove_watched_channel_for_tab(&self, app: &mut App, channel_id: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.remove_watched_channel_for_tab(&storage, channel_id) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn reorder_watched_channel_tab(&self, app: &mut App, from_id: &str, to_id: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.reorder_watched_channel_tab(&storage, from_id, to_id)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn start_watched_tab_rename(&self, app: &mut App, tab_id: &str) {
        self.update(app, |state, cx| {
            state.start_watched_tab_rename(tab_id);
            cx.notify();
        });
    }

    fn cancel_watched_tab_rename(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.cancel_watched_tab_rename();
            cx.notify();
        });
    }

    fn rename_watched_tab(&self, app: &mut App, tab_id: &str, name: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.rename_watched_tab(&storage, tab_id, name) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn set_channel_tab_hovered(&self, app: &mut App, tab_id: &str, hovered: bool) {
        self.update(app, |state, cx| {
            state.set_channel_tab_hovered(tab_id, hovered);
            cx.notify();
        });
    }

    fn open_watched_tab_context_menu(&self, app: &mut App, tab_id: &str) {
        self.update(app, |state, cx| {
            state.open_watched_tab_context_menu(tab_id);
            cx.notify();
        });
    }

    fn close_watched_tab_context_menu(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.close_watched_tab_context_menu();
            cx.notify();
        });
    }

    fn queue_composer_send(&self, app: &mut App, text: &str) -> bool {
        self.update(app, |state, cx| {
            let queued = state.queue_composer_send(text);
            cx.notify();
            queued
        })
    }

    fn queue_watched_channel_send(&self, app: &mut App, channel_id: &str, text: &str) -> bool {
        self.update(app, |state, cx| {
            let queued = state.queue_watched_channel_send(channel_id, text);
            cx.notify();
            queued
        })
    }

    fn open_user_card(&self, app: &mut App, target: UserCardTarget) {
        self.update(app, |state, cx| {
            state.open_user_card(target);
            cx.notify();
        });
    }

    fn close_user_card(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.close_user_card();
            cx.notify();
        });
    }

    fn start_user_card_history_load(&self, app: &mut App) -> Option<UserCardHistoryRequest> {
        self.update(app, |state, cx| {
            let request = state.start_user_card_history_load();
            cx.notify();
            request
        })
    }

    fn apply_user_card_history_result(
        &self,
        app: &mut App,
        request: UserCardHistoryRequest,
        result: Result<UserCardHistoryPage, String>,
    ) -> bool {
        self.update(app, |state, cx| {
            let applied = state.apply_user_card_history_result(request, result);
            cx.notify();
            applied
        })
    }

    fn start_user_card_metadata_load(&self, app: &mut App) -> Option<u64> {
        self.update(app, |state, cx| {
            let generation = state.start_user_card_metadata_load();
            cx.notify();
            generation
        })
    }

    fn apply_user_card_metadata_result(
        &self,
        app: &mut App,
        generation: u64,
        result: Result<crate::protocol::messages::UserCardMetadataResponse, String>,
    ) -> bool {
        self.update(app, |state, cx| {
            let applied = state.apply_user_card_metadata_result(generation, result);
            cx.notify();
            applied
        })
    }

    fn set_user_alias(
        &self,
        app: &mut App,
        platform: Platform,
        platform_user_id: &str,
        alias: &str,
    ) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) =
                        state.set_user_alias(&storage, platform, platform_user_id, alias)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn remove_user_alias(&self, app: &mut App, platform: Platform, platform_user_id: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) =
                        state.remove_user_alias(&storage, platform, platform_user_id)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn toggle_composer_channel(&self, app: &mut App, channel_id: &str) {
        self.update(app, |state, cx| {
            state.toggle_composer_channel(channel_id);
            cx.notify();
        });
    }

    fn add_chat_pane_for_active_tab(&self, app: &mut App) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.add_chat_pane_for_active_tab(&storage) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn remove_chat_pane_for_active_tab(&self, app: &mut App, panel_id: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.remove_chat_pane_for_active_tab(&storage, panel_id) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn move_chat_pane_for_active_tab(
        &self,
        app: &mut App,
        source_id: &str,
        target_id: &str,
        direction: PaneDropDirection,
    ) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state
                        .move_chat_pane_for_active_tab(&storage, source_id, target_id, direction)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn add_watched_channel_from_account(&self, app: &mut App, account_id: &str) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.add_watched_channel_from_account(&storage, account_id)
                    {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn connect_kick_account(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.start_kick_connect();
            cx.notify();
        });

        let state_entity = self.clone();
        app.spawn(async move |cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let config = RuntimeConfig::default();
                    let storage = Storage::open_or_recover(config.db_path())
                        .map_err(|error| error.to_string())?;
                    let account = crate::auth::kick_connect::connect_kick_account(&storage)?;
                    let channel = storage
                        .watched_channels()
                        .upsert(Platform::Kick, &account.username, &account.display_name)
                        .map_err(|error| error.to_string())?;
                    Ok::<_, String>((account, channel))
                })
                .await;

            cx.update(|app| {
                state_entity.update(app, |state, cx| {
                    match result {
                        Ok((account, channel)) => {
                            state.apply_connected_kick_account(account, channel)
                        }
                        Err(error) => state.fail_kick_connect(error),
                    }
                    cx.notify();
                });
            });
        })
        .detach();
    }

    fn connect_twitch_account(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.start_twitch_connect();
            cx.notify();
        });

        let state_entity = self.clone();
        app.spawn(async move |cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let config = RuntimeConfig::default();
                    let storage = Storage::open_or_recover(config.db_path())
                        .map_err(|error| error.to_string())?;
                    let account = crate::auth::twitch_connect::connect_twitch_account(&storage)?;
                    let channel = storage
                        .watched_channels()
                        .upsert(Platform::Twitch, &account.username, &account.display_name)
                        .map_err(|error| error.to_string())?;
                    Ok::<_, String>((account, channel))
                })
                .await;

            cx.update(|app| {
                state_entity.update(app, |state, cx| {
                    match result {
                        Ok((account, channel)) => {
                            state.apply_connected_twitch_account(account, channel)
                        }
                        Err(error) => state.fail_twitch_connect(error),
                    }
                    cx.notify();
                });
            });
        })
        .detach();
    }

    fn connect_platform_account_placeholder(&self, app: &mut App, platform: Platform) {
        self.update(app, |state, cx| {
            state.connect_platform_account_placeholder(platform);
            cx.notify();
        });
    }

    fn disconnect_platform_account(&self, app: &mut App, platform: Platform) {
        self.update(app, |state, cx| {
            state.disconnect_platform_account(platform);
            cx.notify();
        });
    }

    fn join_channel_from_account(&self, app: &mut App, platform: Platform) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.join_channel_from_account(&storage, platform) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }

    fn persist_settings(&self, app: &mut App) {
        self.update(app, |state, cx| {
            let config = RuntimeConfig::default();
            match Storage::open_or_recover(config.db_path()) {
                Ok(storage) => {
                    if let Err(error) = state.persist_settings(&storage) {
                        state.record_runtime_failure(error.to_string());
                    }
                }
                Err(error) => state.record_runtime_failure(error.to_string()),
            }
            cx.notify();
        });
    }
}

fn append_watched_pane(root: &mut LayoutNode) -> bool {
    if count_layout_panels(root) >= MAX_PANELS {
        return false;
    }

    let new_panel = LayoutNode::Panel {
        id: uuid::Uuid::new_v4().to_string(),
        content: PanelContent::Empty,
        flex: 100.0,
    };

    match root {
        LayoutNode::Split { children, .. } => {
            children.push(new_panel);
        }
        LayoutNode::Panel { .. } => {
            let original = root.clone();
            *root = LayoutNode::Split {
                id: uuid::Uuid::new_v4().to_string(),
                direction: SplitDirection::Horizontal,
                children: vec![original, new_panel],
                flex: 100.0,
                min_size: None,
            };
        }
    }
    true
}

fn count_layout_panels(node: &LayoutNode) -> usize {
    match node {
        LayoutNode::Panel { .. } => 1,
        LayoutNode::Split { children, .. } => children.iter().map(count_layout_panels).sum(),
    }
}

fn collect_watched_channel_ids(node: &LayoutNode, ids: &mut Vec<String>) {
    match node {
        LayoutNode::Panel {
            content: PanelContent::Watched { channel_id },
            ..
        } => ids.push(channel_id.clone()),
        LayoutNode::Panel { .. } => {}
        LayoutNode::Split { children, .. } => {
            for child in children {
                collect_watched_channel_ids(child, ids);
            }
        }
    }
}

fn panel_watched_channel_id(node: &LayoutNode, panel_id: &str) -> Option<String> {
    match node {
        LayoutNode::Panel {
            id,
            content: PanelContent::Watched { channel_id },
            ..
        } if id == panel_id => Some(channel_id.clone()),
        LayoutNode::Panel { .. } => None,
        LayoutNode::Split { children, .. } => children
            .iter()
            .find_map(|child| panel_watched_channel_id(child, panel_id)),
    }
}

fn layout_contains_watched_channel(node: &LayoutNode, channel_id: &str) -> bool {
    match node {
        LayoutNode::Panel {
            content: PanelContent::Watched { channel_id: id },
            ..
        } => id == channel_id,
        LayoutNode::Panel { .. } => false,
        LayoutNode::Split { children, .. } => children
            .iter()
            .any(|child| layout_contains_watched_channel(child, channel_id)),
    }
}

fn assign_channel_to_panel(root: &mut LayoutNode, panel_id: &str, channel_id: &str) -> bool {
    match root {
        LayoutNode::Panel { id, content, .. } => {
            if id != panel_id {
                return false;
            }
            *content = PanelContent::Watched {
                channel_id: channel_id.to_string(),
            };
            true
        }
        LayoutNode::Split { children, .. } => children
            .iter_mut()
            .any(|child| assign_channel_to_panel(child, panel_id, channel_id)),
    }
}

fn remove_panel_from_layout(root: &mut LayoutNode, panel_id: &str) -> bool {
    match root {
        LayoutNode::Panel { .. } => false,
        LayoutNode::Split { children, .. } => {
            if let Some(index) = children
                .iter()
                .position(|child| matches!(child, LayoutNode::Panel { id, .. } if id == panel_id))
            {
                children.remove(index);
                if children.len() == 1 {
                    *root = children.remove(0);
                } else if !children.is_empty() {
                    let flex = 100.0 / children.len() as f64;
                    for child in children.iter_mut() {
                        match child {
                            LayoutNode::Panel {
                                flex: child_flex, ..
                            }
                            | LayoutNode::Split {
                                flex: child_flex, ..
                            } => *child_flex = flex,
                        }
                    }
                }
                return true;
            }

            children
                .iter_mut()
                .any(|child| remove_panel_from_layout(child, panel_id))
        }
    }
}

fn panel_is_main(node: &LayoutNode, panel_id: &str) -> Option<bool> {
    match node {
        LayoutNode::Panel { id, content, .. } => {
            (id == panel_id).then_some(matches!(content, PanelContent::Main))
        }
        LayoutNode::Split { children, .. } => children
            .iter()
            .find_map(|child| panel_is_main(child, panel_id)),
    }
}

fn take_panel_from_layout(root: &mut LayoutNode, panel_id: &str) -> Option<LayoutNode> {
    match root {
        LayoutNode::Panel { .. } => None,
        LayoutNode::Split { children, .. } => {
            if let Some(index) = children
                .iter()
                .position(|child| matches!(child, LayoutNode::Panel { id, .. } if id == panel_id))
            {
                return Some(children.remove(index));
            }

            children
                .iter_mut()
                .find_map(|child| take_panel_from_layout(child, panel_id))
        }
    }
}

fn collapse_single_child_splits(node: &mut LayoutNode) {
    if let LayoutNode::Split { children, .. } = node {
        for child in children.iter_mut() {
            collapse_single_child_splits(child);
        }

        if children.len() == 1 {
            *node = children.remove(0);
        } else if !children.is_empty() {
            rebalance_children(children);
        }
    }
}

fn insert_panel_near_target(
    node: &mut LayoutNode,
    source_panel: LayoutNode,
    target_id: &str,
    drop_direction: PaneDropDirection,
) -> bool {
    let split_direction = pane_drop_split_direction(drop_direction);
    let insert_after = matches!(
        drop_direction,
        PaneDropDirection::Right | PaneDropDirection::Bottom
    );

    match node {
        LayoutNode::Panel { id, flex, .. } if id == target_id => {
            let target_flex = *flex;
            let target = node.clone();
            let mut source_panel = source_panel;
            set_layout_flex(&mut source_panel, 50.0);
            let mut target = target;
            set_layout_flex(&mut target, 50.0);
            *node = LayoutNode::Split {
                id: uuid::Uuid::new_v4().to_string(),
                direction: split_direction,
                children: if insert_after {
                    vec![target, source_panel]
                } else {
                    vec![source_panel, target]
                },
                flex: target_flex,
                min_size: None,
            };
            true
        }
        LayoutNode::Panel { .. } => false,
        LayoutNode::Split {
            direction,
            children,
            ..
        } => {
            if let Some(index) = children
                .iter()
                .position(|child| matches!(child, LayoutNode::Panel { id, .. } if id == target_id))
            {
                if *direction == split_direction {
                    let insert_index = if insert_after { index + 1 } else { index };
                    children.insert(insert_index, source_panel);
                    rebalance_children(children);
                } else {
                    let target_flex = layout_flex(&children[index]);
                    let target = children[index].clone();
                    let mut source_panel = source_panel;
                    set_layout_flex(&mut source_panel, 50.0);
                    let mut target = target;
                    set_layout_flex(&mut target, 50.0);
                    children[index] = LayoutNode::Split {
                        id: uuid::Uuid::new_v4().to_string(),
                        direction: split_direction,
                        children: if insert_after {
                            vec![target, source_panel]
                        } else {
                            vec![source_panel, target]
                        },
                        flex: target_flex,
                        min_size: None,
                    };
                }
                true
            } else {
                children.iter_mut().any(|child| {
                    insert_panel_near_target(child, source_panel.clone(), target_id, drop_direction)
                })
            }
        }
    }
}

fn pane_drop_split_direction(direction: PaneDropDirection) -> SplitDirection {
    match direction {
        PaneDropDirection::Left | PaneDropDirection::Right => SplitDirection::Horizontal,
        PaneDropDirection::Top | PaneDropDirection::Bottom => SplitDirection::Vertical,
    }
}

fn rebalance_children(children: &mut [LayoutNode]) {
    let flex = 100.0 / children.len() as f64;
    for child in children {
        set_layout_flex(child, flex);
    }
}

fn layout_flex(node: &LayoutNode) -> f64 {
    match node {
        LayoutNode::Panel { flex, .. } | LayoutNode::Split { flex, .. } => *flex,
    }
}

fn set_layout_flex(node: &mut LayoutNode, flex: f64) {
    match node {
        LayoutNode::Panel {
            flex: node_flex, ..
        }
        | LayoutNode::Split {
            flex: node_flex, ..
        } => *node_flex = flex,
    }
}

fn format_platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "Twitch",
        Platform::Youtube => "YouTube",
        Platform::Kick => "Kick",
    }
}

fn live_status_platform(platform: Platform) -> Option<LiveStatusPlatform> {
    match platform {
        Platform::Twitch => Some(LiveStatusPlatform::Twitch),
        Platform::Kick => Some(LiveStatusPlatform::Kick),
        Platform::Youtube => None,
    }
}

fn home_channel_status_key(platform: LiveStatusPlatform, channel_login: &str) -> String {
    format!(
        "{}:{}",
        live_status_platform_key(platform),
        channel_login.to_lowercase()
    )
}

fn live_status_platform_key(platform: LiveStatusPlatform) -> &'static str {
    match platform {
        LiveStatusPlatform::Twitch => "twitch",
        LiveStatusPlatform::Kick => "kick",
    }
}

fn push_home_channel_status_request(
    requests: &mut Vec<ChannelStatusRequest>,
    seen: &mut BTreeSet<String>,
    platform: LiveStatusPlatform,
    channel_login: &str,
    channel_id: Option<String>,
) {
    let channel_login = channel_login.trim();
    if channel_login.is_empty() {
        return;
    }

    if !seen.insert(home_channel_status_key(platform, channel_login)) {
        return;
    }

    requests.push(ChannelStatusRequest {
        platform,
        channel_login: channel_login.to_string(),
        channel_id,
        user_access_token: None,
    });
}

fn normalize_user_lookup(value: &str) -> String {
    value.trim().trim_start_matches('@').to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{AppState, MainSection, count_layout_panels};
    use crate::hotkeys::HotkeyAction;
    use crate::protocol::types::{
        AppTheme, ChatTheme, FontFamilyChoice, LayoutNode, OverlayAnimation, PanelContent,
        Platform, WatchedChannel,
    };
    use crate::storage::Storage;
    use crate::storage::settings::default_app_settings;
    use crate::storage::watched_layout::create_default_tab_layout;
    use gpui::{Keystroke, Modifiers};

    #[test]
    fn selecting_section_updates_active_section() {
        let mut state = AppState::new();
        state.select_section(MainSection::Settings);

        assert_eq!(state.active_section(), MainSection::Settings);
    }

    #[test]
    fn selecting_events_clears_unread_counter() {
        let mut state = AppState::new();
        state.set_unread_events_for_test(9);
        state.select_section(MainSection::Events);

        assert_eq!(state.unread_events(), 0);
    }

    #[test]
    fn toggle_sidebar_flips_flag() {
        let mut state = AppState::new();
        assert!(!state.sidebar_collapsed());

        state.toggle_sidebar();

        assert!(state.sidebar_collapsed());
    }

    #[test]
    fn recording_hotkey_updates_selected_setting_only() {
        let mut state = AppState::default();
        let previous_next = state.settings().hotkeys.next_tab.clone();

        state.start_hotkey_recording(HotkeyAction::NewTab);
        let changed = state.record_hotkey(&Keystroke {
            key: "n".to_string(),
            modifiers: Modifiers {
                control: true,
                ..Default::default()
            },
            ..Default::default()
        });

        assert!(changed);
        assert_eq!(state.settings().hotkeys.new_tab, "ctrl+n");
        assert_eq!(state.settings().hotkeys.next_tab, previous_next);
        assert_eq!(state.recording_hotkey(), None);
    }

    #[test]
    fn escape_cancels_hotkey_recording_without_mutation() {
        let mut state = AppState::default();
        let original = state.settings().hotkeys.prev_tab.clone();

        state.start_hotkey_recording(HotkeyAction::PrevTab);
        let changed = state.record_hotkey(&Keystroke {
            key: "escape".to_string(),
            ..Default::default()
        });

        assert!(!changed);
        assert_eq!(state.settings().hotkeys.prev_tab, original);
        assert_eq!(state.recording_hotkey(), None);
    }

    #[test]
    fn app_state_loads_persisted_settings_snapshot() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("settings.sqlite");
        let storage =
            Storage::open(&db_path).expect("storage should open for settings snapshot test");
        let mut settings = default_app_settings();
        settings.theme = AppTheme::Light;
        settings.chat_theme = ChatTheme::Compact;
        settings.overlay.max_messages = 7;
        settings.auto_check_updates = Some(false);
        storage
            .settings()
            .set_app_settings(&settings)
            .expect("settings snapshot should persist");

        let state = AppState::from_storage(&storage);

        assert_eq!(state.settings().theme, AppTheme::Light);
        assert_eq!(state.settings().chat_theme, ChatTheme::Compact);
        assert_eq!(state.settings().overlay.max_messages, 7);
        assert!(!state.update_state().auto_check_updates);
    }

    #[test]
    fn app_state_settings_mutations_update_visible_snapshot() {
        let mut state = AppState::default();

        state.set_theme(AppTheme::Light);
        state.set_chat_theme(ChatTheme::Compact);
        state.set_font_size(18.0);
        state.set_show_timestamp(false);
        state.set_auto_check_updates(false);
        state.set_self_ping(false, "rgba(0,0,0,0)".to_string());
        state.set_overlay_animation(OverlayAnimation::Fade);
        state.set_overlay_max_messages(0);

        assert_eq!(state.settings().theme, AppTheme::Light);
        assert_eq!(state.settings().chat_theme, ChatTheme::Compact);
        assert_eq!(state.settings().font_size, 18.0);
        assert!(!state.settings().show_timestamp);
        assert_eq!(state.settings().auto_check_updates, Some(false));
        assert!(!state.update_state().auto_check_updates);
        assert_eq!(
            state
                .settings()
                .self_ping
                .as_ref()
                .map(|config| config.enabled),
            Some(false)
        );
        assert_eq!(state.settings().overlay.animation, OverlayAnimation::Fade);
        assert_eq!(state.settings().overlay.max_messages, 1);
    }

    #[test]
    fn add_chat_pane_for_active_tab_splits_visible_layout_and_persists() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("layout.sqlite");
        let storage = Storage::open(&db_path).expect("storage should open for layout test");
        let channel = WatchedChannel {
            id: "channel-1".to_string(),
            platform: Platform::Twitch,
            channel_slug: "channel_one".to_string(),
            broadcaster_id: None,
            display_name: "Channel One".to_string(),
            created_at: 1,
        };
        let mut state = AppState::default();
        state.watched_channels.push(channel);
        state.select_channel_tab("channel-1");

        let changed = state
            .add_chat_pane_for_active_tab(&storage)
            .expect("layout split should persist");

        assert!(changed);
        let layout = state
            .watched_layout("channel-1")
            .expect("visible layout should be stored in state");
        assert_eq!(count_layout_panels(&layout.root), 2);
        assert!(matches!(layout.root, LayoutNode::Split { .. }));
        assert!(layout_contains_empty_panel(&layout.root));
        let persisted = storage
            .watched_layout()
            .get("channel-1")
            .expect("layout should be persisted");
        assert_eq!(count_layout_panels(&persisted.root), 2);
        assert!(layout_contains_empty_panel(&persisted.root));
    }

    #[test]
    fn add_chat_pane_for_home_tab_is_noop() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("layout.sqlite");
        let storage = Storage::open(&db_path).expect("storage should open for home layout test");
        let mut state = AppState::default();

        let changed = state
            .add_chat_pane_for_active_tab(&storage)
            .expect("home tab should not fail");

        assert!(!changed);
        assert!(state.watched_layouts.is_empty());
    }

    #[test]
    fn add_watched_channel_from_account_persists_and_keeps_home_feed() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("watched.sqlite");
        let storage = Storage::open(&db_path).expect("storage should open for watched add test");

        storage
            .accounts()
            .upsert(crate::storage::accounts::UpsertAccount {
                id: "account-1",
                platform: Platform::Twitch,
                platform_user_id: "user-1",
                username: "satont",
                display_name: "Satont",
                avatar_url: None,
                access_token: "token",
                refresh_token: None,
                expires_at: None,
                scopes: &["chat:read".to_string()],
            })
            .expect("account should persist");

        let mut state = AppState::from_storage(&storage);

        let changed = state
            .add_watched_channel_from_account(&storage, "account-1")
            .expect("adding watched channel from account should persist");

        assert!(changed);
        assert_eq!(state.watched_channels.len(), 1);
        assert_eq!(state.active_channel_tab_id(), "home");
        assert!(
            state
                .watched_layout(&state.watched_channels[0].id)
                .is_some()
        );

        let persisted = storage
            .watched_channels()
            .find_all()
            .expect("watched channels should reload");
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].display_name, "Satont");
    }

    #[test]
    fn add_watched_channel_tab_from_slug_selects_created_tab() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("watched-tab.sqlite");
        let storage = Storage::open(&db_path).expect("storage should open for watched tab test");
        let mut state = AppState::from_storage(&storage);

        let changed = state
            .add_watched_channel_tab_from_slug(&storage, Platform::Twitch, "satont")
            .expect("adding watched tab should persist");

        assert!(changed);
        assert_eq!(state.watched_channels.len(), 1);
        assert_eq!(state.active_channel_tab_id(), state.watched_channels[0].id);
        assert!(
            state
                .watched_layout(&state.watched_channels[0].id)
                .is_some()
        );
    }

    #[test]
    fn remove_watched_channel_falls_back_to_home_and_clears_local_state() {
        let mut state = AppState::default();
        let channel = WatchedChannel {
            id: "channel-1".to_string(),
            platform: Platform::Kick,
            channel_slug: "suhodolskiy".to_string(),
            broadcaster_id: None,
            display_name: "suhodolskiy".to_string(),
            created_at: 1,
        };
        state.watched_channels.push(channel.clone());
        state
            .watched_layouts
            .insert(channel.id.clone(), create_default_tab_layout(&channel.id));
        state
            .watched_channel_messages
            .insert(channel.id.clone(), Vec::new());
        state.select_channel_tab(channel.id.clone());

        let removed = state.remove_watched_channel(&channel.id);

        assert!(removed);
        assert_eq!(state.active_channel_tab_id(), "home");
        assert!(state.watched_channels.is_empty());
        assert!(state.watched_layouts.is_empty());
        assert!(state.watched_channel_messages.is_empty());
    }

    #[test]
    fn persist_settings_saves_current_app_state_snapshot() {
        let temp = tempfile::tempdir().expect("temp dir should be available");
        let db_path = temp.path().join("settings.sqlite");
        let storage = Storage::open(&db_path).expect("storage should open for save test");
        let mut state = AppState::default();
        state.set_theme(AppTheme::Light);
        state.set_chat_theme(ChatTheme::Compact);
        state.set_font_family(FontFamilyChoice::System);
        state.set_system_font_family("JetBrains Mono");
        state.set_font_size(19.0);
        state.set_show_avatars(false);

        state
            .persist_settings(&storage)
            .expect("settings snapshot should persist");

        let persisted = storage
            .settings()
            .get_app_settings()
            .expect("settings should reload");
        assert_eq!(persisted.theme, AppTheme::Light);
        assert_eq!(persisted.chat_theme, ChatTheme::Compact);
        assert_eq!(persisted.font_family, FontFamilyChoice::System);
        assert_eq!(
            persisted.system_font_family.as_deref(),
            Some("JetBrains Mono")
        );
        assert_eq!(persisted.font_size, 19.0);
        assert!(!persisted.show_avatars);
    }

    fn layout_contains_empty_panel(node: &LayoutNode) -> bool {
        match node {
            LayoutNode::Panel { content, .. } => matches!(content, PanelContent::Empty),
            LayoutNode::Split { children, .. } => children.iter().any(layout_contains_empty_panel),
        }
    }
}
