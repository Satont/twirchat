use crate::protocol::types::HotkeySettings;
use gpui::Keystroke;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    NewTab,
    NextTab,
    PrevTab,
    TabSelector,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HotkeyManager {
    recording_action: Option<HotkeyAction>,
}

impl Default for HotkeyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl HotkeyManager {
    pub fn new() -> Self {
        Self {
            recording_action: None,
        }
    }

    pub fn start_recording(&mut self, action: HotkeyAction) {
        self.recording_action = Some(action);
    }

    pub fn cancel_recording(&mut self) {
        self.recording_action = None;
    }

    pub fn recording_action(&self) -> Option<HotkeyAction> {
        self.recording_action
    }

    pub fn is_recording(&self, action: HotkeyAction) -> bool {
        self.recording_action == Some(action)
    }

    pub fn record_keystroke(&mut self, keystroke: &Keystroke) -> Option<(HotkeyAction, String)> {
        let action = self.recording_action?;

        if keystroke.key.eq_ignore_ascii_case("escape") {
            self.cancel_recording();
            return None;
        }

        let normalized = normalize_keystroke(keystroke)?;
        self.cancel_recording();
        Some((action, normalized))
    }
}

pub fn hotkey_for_action(settings: &HotkeySettings, action: HotkeyAction) -> &str {
    match action {
        HotkeyAction::NewTab => &settings.new_tab,
        HotkeyAction::NextTab => &settings.next_tab,
        HotkeyAction::PrevTab => &settings.prev_tab,
        HotkeyAction::TabSelector => &settings.tab_selector,
    }
}

pub fn set_hotkey_for_action(
    settings: &mut HotkeySettings,
    action: HotkeyAction,
    value: impl Into<String>,
) {
    let value = value.into();

    match action {
        HotkeyAction::NewTab => settings.new_tab = value,
        HotkeyAction::NextTab => settings.next_tab = value,
        HotkeyAction::PrevTab => settings.prev_tab = value,
        HotkeyAction::TabSelector => settings.tab_selector = value,
    }
}

pub fn normalize_keystroke(keystroke: &Keystroke) -> Option<String> {
    let key = normalize_key_name(&keystroke.key)?;
    let mut parts = Vec::new();

    if keystroke.modifiers.control {
        parts.push("ctrl".to_string());
    }
    if keystroke.modifiers.alt {
        parts.push("alt".to_string());
    }
    if keystroke.modifiers.shift {
        parts.push("shift".to_string());
    }
    if keystroke.modifiers.platform {
        parts.push("cmd".to_string());
    }
    if keystroke.modifiers.function {
        parts.push("fn".to_string());
    }

    parts.push(key);
    Some(parts.join("+"))
}

pub fn normalize_hotkey_combo(value: &str) -> Option<String> {
    let mut control = false;
    let mut alt = false;
    let mut shift = false;
    let mut platform = false;
    let mut function = false;
    let mut key = None;

    for part in value
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
    {
        match part.as_str() {
            "ctrl" | "control" => control = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "cmd" | "command" | "meta" | "platform" | "super" => platform = true,
            "fn" | "function" => function = true,
            other => key = normalize_key_name(other),
        }
    }

    let key = key?;
    let mut parts = Vec::new();

    if control {
        parts.push("ctrl".to_string());
    }
    if alt {
        parts.push("alt".to_string());
    }
    if shift {
        parts.push("shift".to_string());
    }
    if platform {
        parts.push("cmd".to_string());
    }
    if function {
        parts.push("fn".to_string());
    }

    parts.push(key);
    Some(parts.join("+"))
}

pub fn matches_hotkey(keystroke: &Keystroke, combo: &str) -> bool {
    match (
        normalize_keystroke(keystroke),
        normalize_hotkey_combo(combo),
    ) {
        (Some(actual), Some(expected)) => actual == expected,
        _ => false,
    }
}

pub fn format_hotkey_display(value: &str) -> String {
    value
        .split('+')
        .filter(|part| !part.is_empty())
        .map(|part| match part {
            "ctrl" => "Ctrl".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "cmd" => "Cmd".to_string(),
            "fn" => "Fn".to_string(),
            "arrowleft" => "Left".to_string(),
            "arrowright" => "Right".to_string(),
            "arrowup" => "Up".to_string(),
            "arrowdown" => "Down".to_string(),
            "pageup" => "PageUp".to_string(),
            "pagedown" => "PageDown".to_string(),
            "escape" => "Esc".to_string(),
            other if other.len() == 1 => other.to_ascii_uppercase(),
            other => {
                let mut chars = other.chars();
                let Some(first) = chars.next() else {
                    return String::new();
                };
                format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn to_gpui_binding(value: &str) -> Option<String> {
    let parts = value
        .split('+')
        .filter(|part| !part.is_empty())
        .map(|part| match part {
            "arrowleft" => "left".to_string(),
            "arrowright" => "right".to_string(),
            "arrowup" => "up".to_string(),
            "arrowdown" => "down".to_string(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>();

    (!parts.is_empty()).then(|| parts.join("-"))
}

fn normalize_key_name(key: &str) -> Option<String> {
    let key = key.trim().to_ascii_lowercase();

    if key.is_empty() {
        return None;
    }

    let normalized = match key.as_str() {
        "control" | "ctrl" | "shift" | "alt" | "meta" | "super" | "cmd" | "command"
        | "platform" | "function" | "fn" => return None,
        "left" => "arrowleft",
        "right" => "arrowright",
        "up" => "arrowup",
        "down" => "arrowdown",
        "esc" => "escape",
        "return" => "enter",
        other => other,
    };

    Some(normalized.to_string())
}

#[cfg(test)]
mod hotkey_recording_contract_tests {
    use super::*;
    use gpui::Modifiers;

    fn keystroke(key: &str) -> Keystroke {
        Keystroke {
            key: key.to_string(),
            ..Default::default()
        }
    }

    fn modified_keystroke(key: &str, modifiers: Modifiers) -> Keystroke {
        Keystroke {
            key: key.to_string(),
            modifiers,
            ..Default::default()
        }
    }

    #[test]
    fn records_normalized_hotkey_and_stops_recording() {
        let mut m = HotkeyManager::new();
        m.start_recording(HotkeyAction::TabSelector);

        let recorded = m.record_keystroke(&modified_keystroke(
            "k",
            Modifiers {
                control: true,
                shift: true,
                ..Default::default()
            },
        ));

        assert_eq!(
            recorded,
            Some((HotkeyAction::TabSelector, "ctrl+shift+k".to_string()))
        );
        assert_eq!(m.recording_action(), None);
    }

    #[test]
    fn escape_cancels_recording() {
        let mut m = HotkeyManager::new();
        m.start_recording(HotkeyAction::NewTab);

        assert_eq!(m.record_keystroke(&keystroke("escape")), None);
        assert_eq!(m.recording_action(), None);
    }

    #[test]
    fn bare_modifier_does_not_finish_recording() {
        let mut m = HotkeyManager::new();
        m.start_recording(HotkeyAction::PrevTab);

        assert_eq!(m.record_keystroke(&keystroke("shift")), None);
        assert_eq!(m.recording_action(), Some(HotkeyAction::PrevTab));
    }

    #[test]
    fn formats_display_labels() {
        assert_eq!(format_hotkey_display("ctrl+shift+k"), "Ctrl+Shift+K");
        assert_eq!(format_hotkey_display("alt+arrowleft"), "Alt+Left");
    }

    #[test]
    fn updates_only_requested_hotkey_field() {
        let mut settings = HotkeySettings {
            new_tab: "ctrl+t".to_string(),
            next_tab: "ctrl+tab".to_string(),
            prev_tab: "alt+arrowleft".to_string(),
            tab_selector: "ctrl+l".to_string(),
        };

        set_hotkey_for_action(&mut settings, HotkeyAction::NewTab, "ctrl+n");

        assert_eq!(settings.new_tab, "ctrl+n");
        assert_eq!(settings.next_tab, "ctrl+tab");
        assert_eq!(settings.prev_tab, "alt+arrowleft");
        assert_eq!(settings.tab_selector, "ctrl+l");
    }
}
