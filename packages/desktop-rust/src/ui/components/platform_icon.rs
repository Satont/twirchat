use crate::models::Platform;
use gpui::*;
use std::path::PathBuf;

#[derive(IntoElement)]
pub struct PlatformIcon {
    pub platform: Platform,
    pub size: Pixels,
    pub color: Rgba,
}

impl PlatformIcon {
    pub fn new(platform: Platform) -> Self {
        Self {
            platform,
            size: px(16.0),
            color: rgba(0xffffffff),
        }
    }

    pub fn size(mut self, size: impl Into<Pixels>) -> Self {
        self.size = size.into();
        self
    }

    pub fn color(mut self, color: Rgba) -> Self {
        self.color = color;
        self
    }

    fn svg_path(&self) -> PathBuf {
        match self.platform {
            Platform::Twitch => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../desktop/src/assets/icons/platforms/twitch.svg"),
            Platform::YouTube => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../desktop/src/assets/icons/platforms/youtube.svg"),
            Platform::Kick => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../desktop/src/assets/icons/platforms/kick.svg"),
        }
    }
}

impl RenderOnce for PlatformIcon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        svg()
            .external_path(self.svg_path().to_string_lossy().to_string())
            .size(self.size)
            .text_color(self.color)
    }
}
