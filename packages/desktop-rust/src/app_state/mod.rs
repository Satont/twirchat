pub mod mock_data;

use crate::chat::{SevenTvCatalog, SevenTvEmote, enrich_message_with_seven_tv};
use crate::hotkeys::{HotkeyAction, HotkeyManager};
use crate::protocol::types::{
    Account, AppSettings, AppTheme, Badge, ChatAuthor, ChatMessageType, ChatTheme,
    FontFamilyChoice, LayoutNode, NormalizedChatMessage, OverlayAnimation, OverlayConfig,
    OverlayPosition, PanelContent, Platform, PlatformStatus, PlatformStatusInfo,
    PlatformStatusMode, SplitDirection, WatchedChannel, WatchedChannelsLayout,
};
use crate::runtime::config::RuntimeConfig;
use crate::runtime::update::UpdateStatusSnapshot;
use crate::services::{BackendWsEvent, LifecycleEvent, ServiceEvent, WatchedChannelsEvent};
use crate::settings::SettingsManager;
use crate::storage::Storage;
use crate::storage::settings::default_app_settings;
use crate::storage::watched_layout::{MAX_PANELS, create_default_tab_layout};
use crate::ui::platforms::ToastKind;
use gpui::{App, Entity, Keystroke};
use std::collections::{BTreeMap, BTreeSet};

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
    sidebar_collapsed: bool,
    unread_events: usize,
    runtime_status: RuntimeStatus,
    service_events_seen: usize,
    runtime_errors: Vec<String>,
    update_state: UpdateStatusSnapshot,
    pub settings: SettingsManager,
    pub platforms_panel: crate::ui::platforms::PlatformsPanel,
    pub messages: Vec<NormalizedChatMessage>,
    seven_tv_catalog: SevenTvCatalog,
    pub watched_channels: Vec<WatchedChannel>,
    pub watched_channel_statuses: BTreeMap<String, PlatformStatusInfo>,
    pub watched_channel_messages: BTreeMap<String, Vec<NormalizedChatMessage>>,
    pub watched_layouts: BTreeMap<String, WatchedChannelsLayout>,
    pub events: Vec<crate::protocol::types::NormalizedEvent>,
    hotkey_manager: HotkeyManager,
    pub chat_appearance_popover_open: Option<String>,
    pub chat_add_menu_open: bool,
    pub chat_options_menu_open: bool,
    pub tab_add_menu_open: bool,
    pub user_card: UserCardModalState,
    panel_assignment_target: Option<String>,
    pub add_channel_platform: Platform,
    pub composer_disabled_channel_ids: BTreeSet<String>,
    pending_watched_channel_adds: Vec<PendingWatchedChannelAdd>,
    pending_watched_channel_messages: Vec<PendingWatchedChannelMessage>,
    pending_watched_channel_removals: Vec<PendingWatchedChannelRemove>,
    pending_backend_messages: Vec<crate::protocol::messages::DesktopToBackendMessage>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_section: MainSection::Chat,
            active_channel_tab_id: String::from("home"),
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
            },
            settings: SettingsManager::new(default_app_settings()),
            platforms_panel: crate::ui::platforms::PlatformsPanel::new(),
            messages: vec![],
            seven_tv_catalog: SevenTvCatalog::new(),
            watched_channels: vec![],
            watched_channel_statuses: BTreeMap::new(),
            watched_channel_messages: BTreeMap::new(),
            watched_layouts: BTreeMap::new(),
            events: vec![],
            hotkey_manager: HotkeyManager::new(),
            chat_appearance_popover_open: None,
            chat_add_menu_open: false,
            chat_options_menu_open: false,
            tab_add_menu_open: false,
            user_card: UserCardModalState::closed(),
            panel_assignment_target: None,
            add_channel_platform: Platform::Twitch,
            composer_disabled_channel_ids: BTreeSet::new(),
            pending_watched_channel_adds: Vec::new(),
            pending_watched_channel_messages: Vec::new(),
            pending_watched_channel_removals: Vec::new(),
            pending_backend_messages: Vec::new(),
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
        if let Ok(messages) = storage.messages().get_recent(Some(50)) {
            self.messages = messages;
        }
        if let Ok(settings) = storage.settings().get_app_settings() {
            self.settings = SettingsManager::new(settings);
            self.update_state.auto_check_updates = self
                .settings
                .settings()
                .auto_check_updates
                .unwrap_or(self.update_state.auto_check_updates);
        }
        if let Ok(channels) = storage.watched_channels().find_all() {
            self.watched_channels = channels;
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
            if let Ok(messages) = storage.watched_history().get(&channel.id)
                && !messages.is_empty()
            {
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
        self.messages
            .sort_by_key(|message| message.timestamp.clone());
    }

    pub fn active_section(&self) -> MainSection {
        self.active_section
    }

    pub fn active_channel_tab_id(&self) -> &str {
        &self.active_channel_tab_id
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

    pub fn runtime_status(&self) -> RuntimeStatus {
        self.runtime_status
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

    pub fn visible_watched_channels(&self) -> Vec<&WatchedChannel> {
        self.watched_channels
            .iter()
            .filter(|channel| !self.is_home_account_channel(channel))
            .collect()
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
            ServiceEvent::BackendWs(BackendWsEvent::AuthRejected { message, .. }) => {
                self.runtime_errors.push(message);
            }
            ServiceEvent::BackendWs(BackendWsEvent::MalformedPayload { error }) => {
                self.runtime_errors.push(error);
            }
            ServiceEvent::BackendWs(BackendWsEvent::SendFailed { reason }) => {
                self.runtime_errors.push(reason);
            }
            ServiceEvent::WatchedChannels(event) => self.apply_watched_channels_event(event),
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
            WatchedChannelsEvent::BackendMessagePlanned { message, .. } => {
                self.pending_backend_messages.push(message);
            }
            WatchedChannelsEvent::LoadRequested
            | WatchedChannelsEvent::AddRequested { .. }
            | WatchedChannelsEvent::RemoveRequested { .. }
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
                let text = seven_tv_system_message_text(&message);
                eprintln!(
                    "[backend/7tv] system message platform={platform:?} channel={channel_id}: {text}"
                );
                self.push_seven_tv_system_message(platform, &channel_id, text);
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
            if message.platform != platform
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
                if message.platform != platform || message.channel_id != channel_id {
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
            emotes: Vec::new(),
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

        self.select_channel_tab(channel.id.clone());
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
        self.watched_channel_statuses.remove(channel_id);
        self.watched_channel_messages.remove(channel_id);
        self.watched_layouts.remove(channel_id);
        self.composer_disabled_channel_ids.remove(channel_id);
        self.chat_add_menu_open = false;

        if self.active_channel_tab_id == channel_id {
            self.active_channel_tab_id = String::from("home");
        }

        self.pending_watched_channel_messages
            .retain(|message| message.channel_id != channel_id);
        self.pending_watched_channel_removals
            .retain(|remove| remove.channel_id != channel_id);
        self.queue_watched_channel_remove(removed_channel.id);
        true
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
        for target in self.home_channel_targets() {
            if self.composer_disabled_channel_ids.contains(&target.id) {
                continue;
            }
            if let Some(watched_channel_id) = &target.watched_channel_id {
                self.pending_watched_channel_messages
                    .push(PendingWatchedChannelMessage {
                        channel_id: watched_channel_id.clone(),
                        text: text.to_string(),
                    });
            } else {
                self.pending_backend_messages.push(
                    crate::protocol::messages::DesktopToBackendMessage::SendMessage {
                        platform: target.platform,
                        channel: target.channel_login,
                        message: text.to_string(),
                    },
                );
            }
            queued = true;
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

        self.pending_watched_channel_messages
            .push(PendingWatchedChannelMessage {
                channel_id: channel_id.to_string(),
                text: text.to_string(),
            });
        true
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
        if !remove_panel_from_layout(&mut layout.root, panel_id) {
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
            current_alias: None,
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

fn seven_tv_system_message_text(
    message: &crate::protocol::messages::SevenTvSystemMessage,
) -> String {
    match message {
        crate::protocol::messages::SevenTvSystemMessage::Added { emote, .. } => {
            format!("7TV emote added: {}", emote.alias)
        }
        crate::protocol::messages::SevenTvSystemMessage::Removed { emote, .. } => {
            format!("7TV emote removed: {}", emote.alias)
        }
        crate::protocol::messages::SevenTvSystemMessage::Updated {
            emote, old_alias, ..
        } => old_alias.as_ref().map_or_else(
            || format!("7TV emote updated: {}", emote.alias),
            |old_alias| format!("7TV emote updated: {old_alias} → {}", emote.alias),
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
    }
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

pub trait AppStateActions {
    fn select_section(&self, app: &mut App, section: MainSection);
    fn select_channel_tab(&self, app: &mut App, tab_id: &str);
    fn toggle_sidebar(&self, app: &mut App);
    fn set_update_state(&self, app: &mut App, state: UpdateStatusSnapshot);
    fn dismiss_update_toast(&self, app: &mut App);
    fn set_theme(&self, app: &mut App, theme: AppTheme);
    fn set_chat_theme(&self, app: &mut App, chat_theme: ChatTheme);
    fn set_font_family(&self, app: &mut App, font: FontFamilyChoice);
    fn set_font_size(&self, app: &mut App, font_size: f64);
    fn set_show_platform_color_stripe(&self, app: &mut App, show: bool);
    fn set_show_platform_icon(&self, app: &mut App, show: bool);
    fn set_show_timestamp(&self, app: &mut App, show: bool);
    fn set_show_avatars(&self, app: &mut App, show: bool);
    fn set_show_badges(&self, app: &mut App, show: bool);
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
    fn toggle_composer_channel(&self, app: &mut App, channel_id: &str);
    fn add_chat_pane_for_active_tab(&self, app: &mut App);
    fn remove_chat_pane_for_active_tab(&self, app: &mut App, panel_id: &str);
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

fn format_platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "Twitch",
        Platform::Youtube => "YouTube",
        Platform::Kick => "Kick",
    }
}

fn normalize_user_lookup(value: &str) -> String {
    value.trim().trim_start_matches('@').to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{AppState, MainSection, count_layout_panels};
    use crate::hotkeys::HotkeyAction;
    use crate::protocol::types::{
        AppTheme, ChatTheme, LayoutNode, OverlayAnimation, PanelContent, Platform, WatchedChannel,
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
