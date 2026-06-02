use crate::models::Platform;
use crate::ui::components::embedded_svg::EmbeddedSvg;
use gpui::*;

const TWITCH_ICON_KEY: &str = "platform-icon:twitch";
const YOUTUBE_ICON_KEY: &str = "platform-icon:youtube";
const KICK_ICON_KEY: &str = "platform-icon:kick";

const TWITCH_ICON_SVG: &[u8] = include_bytes!("../../../assets/icons/platforms/twitch.svg");
const YOUTUBE_ICON_SVG: &[u8] = include_bytes!("../../../assets/icons/platforms/youtube.svg");
const KICK_ICON_SVG: &[u8] = include_bytes!("../../../assets/icons/platforms/kick.svg");

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

    fn embedded_svg(&self) -> (&'static str, &'static [u8]) {
        match self.platform {
            Platform::Twitch => (TWITCH_ICON_KEY, TWITCH_ICON_SVG),
            Platform::YouTube => (YOUTUBE_ICON_KEY, YOUTUBE_ICON_SVG),
            Platform::Kick => (KICK_ICON_KEY, KICK_ICON_SVG),
        }
    }
}

impl RenderOnce for PlatformIcon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let (cache_key, bytes) = self.embedded_svg();

        EmbeddedSvg::new(cache_key, bytes)
            .size(self.size)
            .text_color(self.color)
    }
}
