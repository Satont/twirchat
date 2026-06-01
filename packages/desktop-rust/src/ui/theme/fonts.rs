use crate::protocol::types::FontFamilyChoice;
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
    if cfg!(target_os = "macos") {
        return FontFamily::System.as_str();
    }

    FontFamily::for_choice(choice).as_str()
}

pub fn app_font(choice: FontFamilyChoice) -> Font {
    let mut font = gpui::font(app_font_family(choice));
    font.fallbacks = Some(FontFallbacks::from_fonts(app_font_fallbacks(choice)));
    font
}

pub fn load_app_fonts(cx: &App) -> Result<()> {
    cx.text_system().add_fonts(vec![
        Cow::Borrowed(include_bytes!("../../../assets/fonts/InterVariable.ttf").as_slice()),
        Cow::Borrowed(include_bytes!("../../../assets/fonts/InterVariable-Italic.ttf").as_slice()),
        Cow::Borrowed(
            include_bytes!("../../../assets/fonts/manrope/Manrope-VariableFont_wght.ttf")
                .as_slice(),
        ),
    ])
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

    #[test]
    fn font_choices_map_to_gpui_families() {
        let expected_inter = if cfg!(target_os = "macos") {
            ".SystemUIFont"
        } else {
            "Inter Variable"
        };
        let expected_manrope = if cfg!(target_os = "macos") {
            ".SystemUIFont"
        } else {
            "Manrope"
        };

        assert_eq!(app_font_family(FontFamilyChoice::Inter), expected_inter);
        assert_eq!(app_font_family(FontFamilyChoice::Manrope), expected_manrope);
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
}
