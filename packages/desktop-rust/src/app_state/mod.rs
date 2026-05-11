pub mod mock_data;

use crate::protocol::types::{
    NormalizedChatMessage, PlatformStatus, PlatformStatusInfo, PlatformStatusMode, WatchedChannel,
    WatchedChannelsLayout,
};
use crate::runtime::config::RuntimeConfig;
use crate::runtime::update::UpdateStatusSnapshot;
use crate::services::{BackendWsEvent, LifecycleEvent, ServiceEvent};
use crate::storage::Storage;
use gpui::{App, Entity};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainSection {
    Chat,
    Events,
    Platforms,
    Settings,
}

#[derive(Debug, Clone)]
pub struct AppState {
    active_section: MainSection,
    active_channel_tab_id: String,
    sidebar_collapsed: bool,
    unread_events: usize,
    runtime_started: bool,
    service_events_seen: usize,
    runtime_errors: Vec<String>,
    update_state: UpdateStatusSnapshot,
    pub platforms_panel: crate::ui::platforms::PlatformsPanel,
    pub messages: Vec<NormalizedChatMessage>,
    pub watched_channels: Vec<WatchedChannel>,
    pub watched_layouts: BTreeMap<String, WatchedChannelsLayout>,
    pub events: Vec<crate::protocol::types::NormalizedEvent>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_section: MainSection::Chat,
            active_channel_tab_id: String::from("home"),
            sidebar_collapsed: false,
            unread_events: 3,
            runtime_started: false,
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
            platforms_panel: crate::ui::platforms::PlatformsPanel::new(),
            messages: vec![],
            watched_channels: vec![],
            watched_layouts: BTreeMap::new(),
            events: vec![],
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

    pub fn apply_service_event(&mut self, event: ServiceEvent) {
        self.service_events_seen = self.service_events_seen.saturating_add(1);
        match event {
            ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarted) => {
                self.runtime_started = true;
            }
            ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStopped { .. }) => {
                self.runtime_started = false;
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
            _ => {}
        }
    }

    fn apply_backend_message(
        &mut self,
        message: crate::protocol::messages::BackendToDesktopMessage,
    ) {
        match message {
            crate::protocol::messages::BackendToDesktopMessage::ChatMessage { data } => {
                if let Ok(message) = serde_json::from_value(data) {
                    self.messages.push(message);
                }
            }
            crate::protocol::messages::BackendToDesktopMessage::ChatEvent { data } => {
                if let Ok(event) = serde_json::from_value(data) {
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
}

#[cfg(test)]
mod tests {
    use super::{AppState, MainSection};

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
}
