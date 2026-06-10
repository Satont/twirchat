use crate::protocol::types::{AppSettings, FontFamilyChoice};
use gpui::{App, Font, FontFallbacks, Result};
use std::borrow::Cow;
use std::sync::OnceLock;

static BUNDLED_FONT_FAMILIES: OnceLock<Vec<String>> = OnceLock::new();

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
            FontFamily::Inter => "Inter",
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
        FontFamilyChoice::Inter | FontFamilyChoice::Manrope => {
            let requested = app_font_family(choice);
            if is_font_available(requested) {
                requested
            } else {
                eprintln!("font '{requested}' not available, falling back to .SystemUIFont");
                ".SystemUIFont"
            }
        }
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

    let font_files: &[(&str, &[u8])] = &[
        (
            "Inter-Regular.ttf",
            include_bytes!("../../../assets/fonts/Inter-Regular.ttf").as_slice(),
        ),
        (
            "Manrope-VariableFont_wght.ttf",
            include_bytes!("../../../assets/fonts/manrope/Manrope-VariableFont_wght.ttf")
                .as_slice(),
        ),
    ];

    let mut loaded_count = 0;
    for (name, bytes) in font_files {
        match cx
            .text_system()
            .add_fonts(vec![Cow::Borrowed(*bytes)])
        {
            Ok(()) => {
                loaded_count += 1;
                eprintln!("loaded bundled font: {name}");
            }
            Err(error) => {
                eprintln!("failed to load bundled font {name}: {error}");
            }
        }
    }

    let available = cx.text_system().all_font_names();
    for family in ["Inter", "Manrope"] {
        if available.iter().any(|n| n == family) {
            eprintln!("font family available: {family}");
        } else {
            eprintln!("WARNING: font family NOT available after loading: {family}");
        }
    }

    BUNDLED_FONT_FAMILIES.set(available.clone()).ok();

    if loaded_count == 0 {
        eprintln!("WARNING: no bundled fonts loaded, will use system fallbacks");
    }
    Ok(())
}

pub fn is_font_available(family: &str) -> bool {
    BUNDLED_FONT_FAMILIES
        .get()
        .map(|names| names.iter().any(|n| n == family))
        .unwrap_or(false)
}

#[cfg(test)]
pub fn set_test_font_families(families: Vec<String>) {
    BUNDLED_FONT_FAMILIES.set(families).ok();
}

pub fn should_load_bundled_fonts() -> bool {
    true
}

fn emoji_font_family() -> &'static str {
    if cfg!(target_os = "macos") {
        "Apple Color Emoji"
    } else if cfg!(target_os = "windows") {
        "Segoe UI Emoji"
    } else {
        "Noto Color Emoji"
    }
}

fn app_font_fallbacks(choice: FontFamilyChoice) -> Vec<String> {
    let emoji = emoji_font_family();
    match choice {
        FontFamilyChoice::Inter => vec![".SystemUIFont", emoji],
        FontFamilyChoice::Manrope => vec!["Inter", ".SystemUIFont", emoji],
        FontFamilyChoice::System => vec!["Inter", emoji],
    }
    .into_iter()
    .map(String::from)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::settings::default_app_settings;

    fn ensure_test_fonts() {
        let _ = BUNDLED_FONT_FAMILIES.set(vec![
            "Inter".to_string(),
            "Manrope".to_string(),
            ".SystemUIFont".to_string(),
            "Apple Color Emoji".to_string(),
        ]);
    }

    #[test]
    fn font_choices_map_to_gpui_families() {
        assert_eq!(app_font_family(FontFamilyChoice::Inter), "Inter");
        assert_eq!(app_font_family(FontFamilyChoice::Manrope), "Manrope");
        assert_eq!(app_font_family(FontFamilyChoice::System), ".SystemUIFont");
    }

    #[test]
    fn app_font_includes_family_and_fallbacks() {
        ensure_test_fonts();
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
                "Inter".to_string(),
                ".SystemUIFont".to_string(),
                emoji_font_family().to_string(),
            ]
        );
    }

    #[test]
    fn emoji_font_is_in_all_fallback_chains() {
        ensure_test_fonts();
        let emoji = emoji_font_family();
        for choice in [
            FontFamilyChoice::Inter,
            FontFamilyChoice::Manrope,
            FontFamilyChoice::System,
        ] {
            let font = app_font(choice);
            let fallbacks = font
                .fallbacks
                .as_ref()
                .map(FontFallbacks::fallback_list)
                .unwrap_or_default();
            assert!(
                fallbacks.iter().any(|f| f == emoji),
                "{choice:?} fallbacks should include {emoji}, got {fallbacks:?}"
            );
        }
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
