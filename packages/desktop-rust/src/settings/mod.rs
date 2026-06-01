use crate::hotkeys::{HotkeyAction, hotkey_for_action, set_hotkey_for_action};
use crate::protocol::types::{
    AppSettings, AppTheme, ChatTheme, FontFamilyChoice, OverlayAnimation, OverlayConfig,
    OverlayPosition, SelfPingConfig,
};

#[derive(Debug, Clone)]
pub struct SettingsManager {
    pub settings: AppSettings,
}

impl SettingsManager {
    pub fn new(settings: AppSettings) -> Self {
        Self { settings }
    }

    pub fn settings(&self) -> &AppSettings {
        &self.settings
    }

    pub fn hotkey(&self, action: HotkeyAction) -> &str {
        hotkey_for_action(&self.settings.hotkeys, action)
    }

    pub fn set_theme(&mut self, theme: AppTheme) {
        self.settings.theme = theme;
    }

    pub fn set_chat_theme(&mut self, chat_theme: ChatTheme) {
        self.settings.chat_theme = chat_theme;
    }

    pub fn set_font_family(&mut self, font: FontFamilyChoice) {
        self.settings.font_family = font;
    }

    pub fn set_font_size(&mut self, font_size: f64) {
        self.settings.font_size = font_size.max(1.0);
    }

    pub fn set_show_platform_color_stripe(&mut self, show: bool) {
        self.settings.show_platform_color_stripe = show;
    }

    pub fn set_show_platform_icon(&mut self, show: bool) {
        self.settings.show_platform_icon = show;
    }

    pub fn set_show_timestamp(&mut self, show: bool) {
        self.settings.show_timestamp = show;
    }

    pub fn set_show_avatars(&mut self, show: bool) {
        self.settings.show_avatars = show;
    }

    pub fn set_show_badges(&mut self, show: bool) {
        self.settings.show_badges = show;
    }

    pub fn set_self_ping(&mut self, enabled: bool, color: String) {
        self.settings.self_ping = Some(SelfPingConfig { enabled, color });
    }

    pub fn set_auto_check_updates(&mut self, enabled: bool) {
        self.settings.auto_check_updates = Some(enabled);
    }

    pub fn set_hotkey(&mut self, action: HotkeyAction, hotkey: impl Into<String>) {
        set_hotkey_for_action(&mut self.settings.hotkeys, action, hotkey);
    }

    pub fn update_overlay_config(&mut self, config: OverlayConfig) {
        self.settings.overlay = config;
    }

    pub fn set_overlay_background(&mut self, background: impl Into<String>) {
        self.settings.overlay.background = background.into();
    }

    pub fn set_overlay_text_color(&mut self, text_color: impl Into<String>) {
        self.settings.overlay.text_color = text_color.into();
    }

    pub fn set_overlay_font_size(&mut self, font_size: f64) {
        self.settings.overlay.font_size = font_size.max(1.0);
    }

    pub fn set_overlay_font_family(&mut self, font_family: impl Into<String>) {
        self.settings.overlay.font_family = font_family.into();
    }

    pub fn set_overlay_max_messages(&mut self, max_messages: u32) {
        self.settings.overlay.max_messages = max_messages.max(1);
    }

    pub fn set_overlay_message_timeout(&mut self, message_timeout: u64) {
        self.settings.overlay.message_timeout = message_timeout;
    }

    pub fn set_overlay_show_platform_icon(&mut self, show: bool) {
        self.settings.overlay.show_platform_icon = show;
    }

    pub fn set_overlay_show_avatar(&mut self, show: bool) {
        self.settings.overlay.show_avatar = show;
    }

    pub fn set_overlay_show_badges(&mut self, show: bool) {
        self.settings.overlay.show_badges = show;
    }

    pub fn set_overlay_animation(&mut self, animation: OverlayAnimation) {
        self.settings.overlay.animation = animation;
    }

    pub fn set_overlay_position(&mut self, position: OverlayPosition) {
        self.settings.overlay.position = position;
    }

    pub fn set_overlay_port(&mut self, port: u16) {
        self.settings.overlay.port = port;
    }
}

#[cfg(test)]
mod settings_parity_tests {
    use super::*;
    use crate::hotkeys::HotkeyAction;
    use crate::protocol::types::OverlayAnimation;
    use crate::storage::settings::default_app_settings;

    #[test]
    fn test_settings_parity() {
        let mut m = SettingsManager::new(default_app_settings());

        m.set_theme(AppTheme::Light);
        assert_eq!(m.settings.theme, AppTheme::Light);

        m.set_font_family(FontFamilyChoice::Inter);
        assert_eq!(m.settings.font_family, FontFamilyChoice::Inter);

        m.set_chat_theme(ChatTheme::Compact);
        assert_eq!(m.settings.chat_theme, ChatTheme::Compact);

        m.set_font_size(16.0);
        assert_eq!(m.settings.font_size, 16.0);

        m.set_show_platform_color_stripe(false);
        m.set_show_platform_icon(false);
        m.set_show_timestamp(false);
        m.set_show_avatars(false);
        m.set_show_badges(false);
        assert!(!m.settings.show_platform_color_stripe);
        assert!(!m.settings.show_platform_icon);
        assert!(!m.settings.show_timestamp);
        assert!(!m.settings.show_avatars);
        assert!(!m.settings.show_badges);

        m.set_self_ping(false, "rgba(0,0,0,0)".to_string());
        let ping = m.settings.self_ping.as_ref().unwrap();
        assert!(!ping.enabled);
        assert_eq!(ping.color, "rgba(0,0,0,0)");

        m.set_auto_check_updates(false);
        assert_eq!(m.settings.auto_check_updates, Some(false));

        m.set_hotkey(HotkeyAction::NewTab, "ctrl+n");
        assert_eq!(m.hotkey(HotkeyAction::NewTab), "ctrl+n");
        assert_eq!(m.hotkey(HotkeyAction::NextTab), "ctrl+tab");

        let mut overlay = m.settings.overlay.clone();
        overlay.animation = OverlayAnimation::Fade;
        m.update_overlay_config(overlay);
        assert_eq!(m.settings.overlay.animation, OverlayAnimation::Fade);

        m.set_overlay_max_messages(0);
        assert_eq!(m.settings.overlay.max_messages, 1);
    }
}
