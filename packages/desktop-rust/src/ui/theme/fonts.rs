use crate::protocol::types::{AppSettings, FontFamilyChoice};
use gpui::{App, Font, FontFallbacks, Result};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontFamily {
    Inter,
    Manrope,
    System,
}

impl FontFamily {
    pub fn for_choice(choice: FontFamilyChoice) -> Self {
        match choice {
            FontFamilyChoice::Inter => FontFamily::Inter,
            FontFamilyChoice::Manrope => FontFamily::Manrope,
            FontFamilyChoice::System => FontFamily::System,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FontFamily::Inter => "Inter Variable",
            FontFamily::Manrope => "Manrope",
            FontFamily::System => ".SystemUIFont",
        }
    }
}

pub fn app_font_family(choice: FontFamilyChoice) -> &'static str {
    FontFamily::for_choice(choice).as_str()
}

pub fn app_font(choice: FontFamilyChoice) -> Font {
    app_font_with_system_family(choice, None)
}

pub fn app_font_for_settings(settings: &AppSettings) -> Font {
    app_font_with_system_family(settings.font_family, settings.system_font_family.as_deref())
}

pub fn app_font_with_system_family(
    choice: FontFamilyChoice,
    system_font_family: Option<&str>,
) -> Font {
    let family = match choice {
        FontFamilyChoice::System => system_font_family
            .map(str::trim)
            .filter(|family| !family.is_empty())
            .unwrap_or_else(|| app_font_family(choice)),
        FontFamilyChoice::Inter | FontFamilyChoice::Manrope => app_font_family(choice),
    };
    let mut font = gpui::font(family);
    let fallbacks = app_font_fallbacks(choice);
    if !fallbacks.is_empty() {
        font.fallbacks = Some(FontFallbacks::from_fonts(fallbacks));
    }
    font
}

pub fn load_app_fonts(cx: &App) -> Result<()> {
    if !should_load_bundled_fonts() {
        return Ok(());
    }

    cx.text_system().add_fonts(vec![
        Cow::Borrowed(include_bytes!("../../../assets/fonts/InterVariable.ttf").as_slice()),
        Cow::Borrowed(include_bytes!("../../../assets/fonts/InterVariable-Italic.ttf").as_slice()),
        Cow::Borrowed(
            include_bytes!("../../../assets/fonts/manrope/Manrope-VariableFont_wght.ttf")
                .as_slice(),
        ),
    ])
}

pub fn should_load_bundled_fonts() -> bool {
    true
}

fn app_font_fallbacks(choice: FontFamilyChoice) -> Vec<String> {
    match choice {
        FontFamilyChoice::Inter => vec!["Inter", ".SystemUIFont"],
        FontFamilyChoice::Manrope => vec!["Inter Variable", "Inter", ".SystemUIFont"],
        FontFamilyChoice::System => vec!["Inter Variable", "Inter"],
    }
    .into_iter()
    .map(String::from)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::settings::default_app_settings;

    #[test]
    fn font_choices_map_to_gpui_families() {
        assert_eq!(app_font_family(FontFamilyChoice::Inter), "Inter Variable");
        assert_eq!(app_font_family(FontFamilyChoice::Manrope), "Manrope");
        assert_eq!(app_font_family(FontFamilyChoice::System), ".SystemUIFont");
    }

    #[test]
    fn app_font_includes_family_and_fallbacks() {
        let font = app_font(FontFamilyChoice::Manrope);

        assert_eq!(font.family.to_string(), "Manrope");
        let fallbacks = font
            .fallbacks
            .as_ref()
            .map(FontFallbacks::fallback_list)
            .unwrap_or_default();
        assert_eq!(
            fallbacks,
            [
                "Inter Variable".to_string(),
                "Inter".to_string(),
                ".SystemUIFont".to_string(),
            ]
        );
    }

    #[test]
    fn app_font_uses_named_system_font_when_configured() {
        let mut settings = default_app_settings();
        settings.font_family = FontFamilyChoice::System;
        settings.system_font_family = Some("JetBrains Mono".to_string());

        let font = app_font_for_settings(&settings);

        assert_eq!(font.family.to_string(), "JetBrains Mono");
    }

    #[test]
    fn app_font_falls_back_to_os_system_font_when_system_name_is_blank() {
        let mut settings = default_app_settings();
        settings.font_family = FontFamilyChoice::System;
        settings.system_font_family = Some("  ".to_string());

        let font = app_font_for_settings(&settings);

        assert_eq!(font.family.to_string(), ".SystemUIFont");
    }

    #[test]
    fn bundled_font_registration_is_enabled() {
        assert!(should_load_bundled_fonts());
    }
}
