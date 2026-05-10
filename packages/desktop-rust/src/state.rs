#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainSection {
    Chat,
    Events,
    Platforms,
    Settings,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub active_section: MainSection,
    pub active_channel_tab_id: String,
    pub sidebar_collapsed: bool,
    pub unread_events: usize,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_section: MainSection::Chat,
            active_channel_tab_id: String::from("home"),
            sidebar_collapsed: false,
            unread_events: 3,
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
}

#[cfg(test)]
mod tests {
    use super::{AppState, MainSection};

    #[test]
    fn selecting_events_clears_unread_counter() {
        let mut state = AppState::new();
        state.unread_events = 9;
        state.select_section(MainSection::Events);

        assert_eq!(state.unread_events, 0);
    }

    #[test]
    fn toggle_sidebar_flips_flag() {
        let mut state = AppState::new();
        assert!(!state.sidebar_collapsed);

        state.toggle_sidebar();
        assert!(state.sidebar_collapsed);
    }
}
