use crate::platforms::kick::{embedded_kick_badge_svg, kick_badge_embedded_url};
use crate::ui::components::embedded_svg::EmbeddedSvg;
use gpui::*;

const KICK_BADGE_EMBEDDED_PREFIX: &str = "embedded:kick:";

#[derive(IntoElement)]
pub struct KickBadgeIcon {
    cache_key: SharedString,
    svg: &'static str,
    size: Pixels,
}

impl KickBadgeIcon {
    fn new(cache_key: impl Into<SharedString>, svg: &'static str) -> Self {
        Self {
            cache_key: cache_key.into(),
            svg,
            size: px(16.0),
        }
    }

    pub fn size(mut self, size: impl Into<Pixels>) -> Self {
        self.size = size.into();
        self
    }
}

impl RenderOnce for KickBadgeIcon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        EmbeddedSvg::new(self.cache_key, self.svg.as_bytes())
            .size(self.size)
            .text_color(rgba(0xffffffff))
    }
}

pub fn embedded_kick_badge_icon(
    image_url: Option<&str>,
    badge_type: &str,
    size: impl Into<Pixels>,
) -> Option<KickBadgeIcon> {
    let size = size.into();

    if let Some(url) = image_url.and_then(|url| url.strip_prefix(KICK_BADGE_EMBEDDED_PREFIX)) {
        let svg = embedded_kick_badge_svg(url)?;
        return Some(
            KickBadgeIcon::new(format!("{KICK_BADGE_EMBEDDED_PREFIX}{url}"), svg).size(size),
        );
    }

    let svg = embedded_kick_badge_svg(badge_type)?;
    let cache_key = kick_badge_embedded_url(badge_type)?;
    Some(KickBadgeIcon::new(cache_key, svg).size(size))
}
