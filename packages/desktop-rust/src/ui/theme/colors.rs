use gpui::{Hsla, Rgba};

pub struct ThemeColors {
    pub bg: Hsla,
    pub surface: Hsla,
    pub surface_2: Hsla,
    pub border: Hsla,
    pub text: Hsla,
    pub text_2: Hsla,
    pub nav_bg: Hsla,
    pub nav_text: Hsla,
    pub nav_active: Hsla,
}

impl ThemeColors {
    pub fn dark() -> Self {
        Self {
            bg: Rgba {
                r: 0x0f as f32 / 255.0,
                g: 0x0f as f32 / 255.0,
                b: 0x11 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            surface: Rgba {
                r: 0x18 as f32 / 255.0,
                g: 0x18 as f32 / 255.0,
                b: 0x1b as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            surface_2: Rgba {
                r: 0x1f as f32 / 255.0,
                g: 0x1f as f32 / 255.0,
                b: 0x24 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            border: Rgba {
                r: 0x2a as f32 / 255.0,
                g: 0x2a as f32 / 255.0,
                b: 0x33 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            text: Rgba {
                r: 0xe2 as f32 / 255.0,
                g: 0xe2 as f32 / 255.0,
                b: 0xe8 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            text_2: Rgba {
                r: 0x8b as f32 / 255.0,
                g: 0x8b as f32 / 255.0,
                b: 0x99 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            nav_bg: Rgba {
                r: 0x11 as f32 / 255.0,
                g: 0x11 as f32 / 255.0,
                b: 0x14 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            nav_text: Rgba {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 0.45,
            }
            .into(),
            nav_active: Rgba {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 1.0,
            }
            .into(),
        }
    }

    pub fn light() -> Self {
        Self {
            bg: Rgba {
                r: 0xf0 as f32 / 255.0,
                g: 0xef as f32 / 255.0,
                b: 0xf4 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            surface: Rgba {
                r: 0xfa as f32 / 255.0,
                g: 0xf9 as f32 / 255.0,
                b: 0xfc as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            surface_2: Rgba {
                r: 0xe8 as f32 / 255.0,
                g: 0xe7 as f32 / 255.0,
                b: 0xed as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            border: Rgba {
                r: 0xd8 as f32 / 255.0,
                g: 0xd6 as f32 / 255.0,
                b: 0xe0 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            text: Rgba {
                r: 0x1c as f32 / 255.0,
                g: 0x1b as f32 / 255.0,
                b: 0x22 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            text_2: Rgba {
                r: 0x6b as f32 / 255.0,
                g: 0x68 as f32 / 255.0,
                b: 0x78 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            nav_bg: Rgba {
                r: 0xfa as f32 / 255.0,
                g: 0xf9 as f32 / 255.0,
                b: 0xfc as f32 / 255.0,
                a: 1.0,
            }
            .into(),
            nav_text: Rgba {
                r: 0x1c as f32 / 255.0,
                g: 0x1b as f32 / 255.0,
                b: 0x22 as f32 / 255.0,
                a: 0.45,
            }
            .into(),
            nav_active: Rgba {
                r: 0x1c as f32 / 255.0,
                g: 0x1b as f32 / 255.0,
                b: 0x22 as f32 / 255.0,
                a: 1.0,
            }
            .into(),
        }
    }
}

pub struct PlatformColors {
    pub twitch: Hsla,
    pub youtube: Hsla,
    pub kick: Hsla,
}

impl PlatformColors {
    pub fn new() -> Self {
        Self {
            twitch: Rgba {
                r: 0.57,
                g: 0.27,
                b: 1.0,
                a: 1.0,
            }
            .into(), // Approx #9146FF
            youtube: Rgba {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }
            .into(),
            kick: Rgba {
                r: 0.33,
                g: 1.0,
                b: 0.11,
                a: 1.0,
            }
            .into(), // Approx #53FC18
        }
    }
}

pub fn background() -> Rgba {
    ThemeColors::dark().bg.into()
}
pub fn surface() -> Rgba {
    ThemeColors::dark().surface.into()
}
pub fn surface_2() -> Rgba {
    ThemeColors::dark().surface_2.into()
}
pub fn border() -> Rgba {
    ThemeColors::dark().border.into()
}
pub fn text_primary() -> Rgba {
    ThemeColors::dark().text.into()
}
pub fn text_muted() -> Rgba {
    ThemeColors::dark().text_2.into()
}
pub fn nav_background() -> Rgba {
    ThemeColors::dark().nav_bg.into()
}
pub fn accent() -> Rgba {
    rgb(0xa78bfa)
}
pub fn accent_strong() -> Rgba {
    rgb(0x7c3aed)
}
pub fn green() -> Rgba {
    rgb(0x22c55e)
}
pub fn red() -> Rgba {
    rgb(0xef4444)
}

use crate::models::Platform;
pub fn platform_color(platform: Platform) -> Rgba {
    match platform {
        Platform::Twitch => rgb(0x9146ff),
        Platform::YouTube => rgb(0xff0000),
        Platform::Kick => rgb(0x53fc18),
    }
}

pub fn rgb(hex: u32) -> Rgba {
    let r = ((hex >> 16) & 0xff) as f32 / 255.0;
    let g = ((hex >> 8) & 0xff) as f32 / 255.0;
    let b = (hex & 0xff) as f32 / 255.0;
    Rgba { r, g, b, a: 1.0 }
}
impl Default for PlatformColors {
    fn default() -> Self {
        Self::new()
    }
}
