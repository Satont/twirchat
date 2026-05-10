use crate::models::Platform;
use gpui::{Rgba, rgb};

pub fn background() -> Rgba {
    rgb(0x0f0f11)
}

pub fn surface() -> Rgba {
    rgb(0x18181b)
}

pub fn surface_2() -> Rgba {
    rgb(0x1f1f24)
}

pub fn nav_background() -> Rgba {
    rgb(0x111114)
}

pub fn border() -> Rgba {
    rgb(0x2a2a33)
}

pub fn text_primary() -> Rgba {
    rgb(0xe2e2e8)
}

pub fn text_muted() -> Rgba {
    rgb(0x8b8b99)
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

pub fn platform_color(platform: Platform) -> Rgba {
    match platform {
        Platform::Twitch => rgb(0x9146ff),
        Platform::YouTube => rgb(0xff0000),
        Platform::Kick => rgb(0x53fc18),
    }
}

#[cfg(test)]
pub fn platform_color_hex(platform: Platform) -> u32 {
    match platform {
        Platform::Twitch => 0x9146ff,
        Platform::YouTube => 0xff0000,
        Platform::Kick => 0x53fc18,
    }
}

#[cfg(test)]
mod tests {
    use super::platform_color_hex;
    use crate::models::Platform;

    #[test]
    fn platform_colors_match_vue_palette() {
        assert_eq!(platform_color_hex(Platform::Twitch), 0x9146ff);
        assert_eq!(platform_color_hex(Platform::YouTube), 0xff0000);
        assert_eq!(platform_color_hex(Platform::Kick), 0x53fc18);
    }
}
