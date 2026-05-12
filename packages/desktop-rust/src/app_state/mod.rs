pub mod mock_data;

use crate::protocol::types::{
    Account, AppSettings, AppTheme, ChatTheme, FontFamilyChoice, LayoutNode, NormalizedChatMessage,
    OverlayAnimation, OverlayConfig, OverlayPosition, PanelContent, Platform, PlatformStatus,
    PlatformStatusInfo, PlatformStatusMode, SplitDirection, WatchedChannel, WatchedChannelsLayout,
};
use crate::runtime::config::RuntimeConfig;
use crate::runtime::update::UpdateStatusSnapshot;
use crate::services::{BackendWsEvent, LifecycleEvent, ServiceEvent, WatchedChannelsEvent};
use crate::settings::SettingsManager;
use crate::storage::Storage;
use crate::storage::settings::default_app_settings;
use crate::storage::watched_layout::{MAX_PANELS, create_default_tab_layout};
use crate::ui::platforms::ToastKind;
use gpui::{App, Entity};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWatchedChannelAdd {
    pub platform: Platform,
    pub channel_slug: String,
    pub display_name: Option<String>,
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
    pub watched_channels: Vec<WatchedChannel>,
    pub watched_channel_statuses: BTreeMap<String, PlatformStatusInfo>,
    pub watched_layouts: BTreeMap<String, WatchedChannelsLayout>,
    pub events: Vec<crate::protocol::types::NormalizedEvent>,
    pub chat_appearance_popover_open: bool,
    pub chat_add_menu_open: bool,
    pub chat_options_menu_open: bool,
    pub tab_add_menu_open: bool,
    pub composer_disabled_channel_ids: BTreeSet<String>,
    pending_watched_channel_adds: Vec<PendingWatchedChannelAdd>,
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
            watched_channels: vec![],
            watched_channel_statuses: BTreeMap::new(),
            watched_layouts: BTreeMap::new(),
            events: vec![],
            chat_appearance_popover_open: false,
            chat_add_menu_open: false,
            chat_options_menu_open: false,
            tab_add_menu_open: false,
            composer_disabled_channel_ids: BTreeSet::new(),
            pending_watched_channel_adds: Vec::new(),
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
            if let Ok(layout) = storage.watched_layout().get(&channel.id) {
                self.watched_layouts.insert(channel.id.clone(), layout);
            }
        }
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

        if !append_watched_pane(&mut layout.root, &tab_id) {
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
            WatchedChannelsEvent::MessageBuffered { message, .. } => {
                eprintln!(
                    "[watched/live] app_state accepted {:?} message id={} channel={}",
                    message.platform, message.id, message.channel_id
                );
                self.messages.push(*message);
            }
            WatchedChannelsEvent::StatusChanged { channel_id, status } => {
                self.platforms_panel
                    .statuses
                    .insert(status.platform, status.clone());
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
            WatchedChannelsEvent::BackendMessagePlanned { .. }
            | WatchedChannelsEvent::LoadRequested
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
                    eprintln!(
                        "[backend/live] app_state accepted {:?} message id={} channel={}",
                        message.platform, message.id, message.channel_id
                    );
                    self.messages.push(message);
                }
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

    pub fn select_section(&mut self, section: MainSection) {
        self.active_section = section;
        if matches!(section, MainSection::Events) {
            self.unread_events = 0;
        }
    }

    pub fn select_channel_tab(&mut self, tab_id: impl Into<String>) {
        self.active_channel_tab_id = tab_id.into();
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

    pub fn toggle_chat_appearance_popover(&mut self) {
        self.chat_appearance_popover_open = !self.chat_appearance_popover_open;
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

    pub fn toggle_composer_channel(&mut self, channel_id: &str) {
        if !self
            .composer_disabled_channel_ids
            .insert(channel_id.to_string())
        {
            self.composer_disabled_channel_ids.remove(channel_id);
        }
    }

    pub fn close_tab_add_menu(&mut self) {
        self.tab_add_menu_open = false;
    }

    pub fn take_pending_watched_channel_adds(&mut self) -> Vec<PendingWatchedChannelAdd> {
        std::mem::take(&mut self.pending_watched_channel_adds)
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

    pub fn dismiss_update_toast(&mut self) {
        self.update_state.show = false;
    }

    #[cfg(test)]
    pub(crate) fn set_unread_events_for_test(&mut self, unread_events: usize) {
        self.unread_events = unread_events;
    }
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
    fn toggle_chat_appearance_popover(&self, app: &mut App);
    fn toggle_chat_add_menu(&self, app: &mut App);
    fn toggle_chat_options_menu(&self, app: &mut App);
    fn toggle_composer_channel(&self, app: &mut App, channel_id: &str);
    fn add_chat_pane_for_active_tab(&self, app: &mut App);
    fn add_watched_channel_from_account(&self, app: &mut App, account_id: &str);
    fn connect_kick_account(&self, app: &mut App);
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

    fn toggle_chat_appearance_popover(&self, app: &mut App) {
        self.update(app, |state, cx| {
            state.toggle_chat_appearance_popover();
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

fn append_watched_pane(root: &mut LayoutNode, channel_id: &str) -> bool {
    if count_layout_panels(root) >= MAX_PANELS {
        return false;
    }

    let new_panel = LayoutNode::Panel {
        id: uuid::Uuid::new_v4().to_string(),
        content: PanelContent::Watched {
            channel_id: channel_id.to_string(),
        },
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

fn format_platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "Twitch",
        Platform::Youtube => "YouTube",
        Platform::Kick => "Kick",
    }
}

#[cfg(test)]
mod tests {
    use super::{AppState, MainSection, count_layout_panels};
    use crate::protocol::types::{
        AppTheme, ChatTheme, LayoutNode, OverlayAnimation, Platform, WatchedChannel,
    };
    use crate::storage::Storage;
    use crate::storage::settings::default_app_settings;

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
        let persisted = storage
            .watched_layout()
            .get("channel-1")
            .expect("layout should be persisted");
        assert_eq!(count_layout_panels(&persisted.root), 2);
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
}
