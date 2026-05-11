use crate::protocol::types::{
    AppSettings, AppTheme, FontFamilyChoice, OverlayConfig, SelfPingConfig,
};

pub struct SettingsManager {
    pub settings: AppSettings,
}

impl SettingsManager {
    pub fn new(settings: AppSettings) -> Self {
        Self { settings }
    }

    pub fn set_theme(&mut self, theme: AppTheme) {
        self.settings.theme = theme;
    }

    pub fn set_font_family(&mut self, font: FontFamilyChoice) {
        self.settings.font_family = font;
    }

    pub fn set_self_ping(&mut self, enabled: bool, color: String) {
        self.settings.self_ping = Some(SelfPingConfig { enabled, color });
    }

    pub fn set_auto_check_updates(&mut self, enabled: bool) {
        self.settings.auto_check_updates = Some(enabled);
    }

    pub fn update_overlay_config(&mut self, config: OverlayConfig) {
        self.settings.overlay = config;
    }
}

#[cfg(test)]
mod settings_parity_tests {
    use super::*;
    use crate::protocol::types::OverlayAnimation;
    use crate::storage::settings::default_app_settings;

    #[test]
    fn test_settings_parity() {
        let mut m = SettingsManager::new(default_app_settings());

        m.set_theme(AppTheme::Light);
        assert_eq!(m.settings.theme, AppTheme::Light);

        m.set_font_family(FontFamilyChoice::Inter);
        assert_eq!(m.settings.font_family, FontFamilyChoice::Inter);

        m.set_self_ping(false, "rgba(0,0,0,0)".to_string());
        let ping = m.settings.self_ping.as_ref().unwrap();
        assert!(!ping.enabled);
        assert_eq!(ping.color, "rgba(0,0,0,0)");

        m.set_auto_check_updates(false);
        assert_eq!(m.settings.auto_check_updates, Some(false));

        let mut overlay = m.settings.overlay.clone();
        overlay.animation = OverlayAnimation::Fade;
        m.update_overlay_config(overlay);
        assert_eq!(m.settings.overlay.animation, OverlayAnimation::Fade);
    }
}
