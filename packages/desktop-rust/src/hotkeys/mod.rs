#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HotkeyManager {
    pub is_recording: bool,
    pub recording_key: Option<String>,
}

impl Default for HotkeyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl HotkeyManager {
    pub fn new() -> Self {
        Self {
            is_recording: false,
            recording_key: None,
        }
    }

    pub fn start_recording(&mut self) {
        self.is_recording = true;
        self.recording_key = None;
    }

    pub fn cancel_recording(&mut self) {
        self.is_recording = false;
        self.recording_key = None;
    }

    pub fn record_key(&mut self, key: &str) {
        if self.is_recording {
            if key == "Escape" {
                self.cancel_recording();
            } else {
                self.recording_key = Some(key.to_string());
            }
        }
    }
}

#[cfg(test)]
mod hotkey_recording_contract_tests {
    use super::*;

    #[test]
    fn test_hotkey_recording() {
        let mut m = HotkeyManager::new();
        m.start_recording();
        assert!(m.is_recording);

        m.record_key("Ctrl+K");
        assert_eq!(m.recording_key, Some("Ctrl+K".to_string()));

        m.cancel_recording();
        assert!(!m.is_recording);
        assert_eq!(m.recording_key, None);
    }

    #[test]
    fn test_escape_cancels_recording() {
        let mut m = HotkeyManager::new();
        m.start_recording();
        m.record_key("Escape");
        assert!(!m.is_recording);
        assert_eq!(m.recording_key, None);
    }

    #[test]
    fn test_pause_resume_semantics() {
        // Just verify state changes that represent "pause/resume semantics for active hotkey handling"
        let mut m = HotkeyManager::new();
        assert!(!m.is_recording); // Active hotkeys would be processed
        m.start_recording();
        assert!(m.is_recording); // Active hotkeys should be paused
        m.cancel_recording();
        assert!(!m.is_recording); // Active hotkeys resumed
    }
}
