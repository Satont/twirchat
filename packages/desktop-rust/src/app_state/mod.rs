pub mod mock_data;

use gpui::{App, Entity};

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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_section: MainSection::Chat,
            active_channel_tab_id: String::from("home"),
            sidebar_collapsed: false,
            unread_events: 3,
        }
    }
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
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

    #[cfg(test)]
    fn set_unread_events_for_test(&mut self, unread_events: usize) {
        self.unread_events = unread_events;
    }
}

pub trait AppStateActions {
    fn select_section(&self, app: &mut App, section: MainSection);
    fn select_channel_tab(&self, app: &mut App, tab_id: &str);
    fn toggle_sidebar(&self, app: &mut App);
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
