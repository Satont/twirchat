use crate::platforms::kick::{embedded_kick_badge_svg, kick_badge_embedded_url};
use gpui::*;
use std::sync::{Arc, Mutex, OnceLock};

const KICK_BADGE_EMBEDDED_PREFIX: &str = "embedded:kick:";

static RENDERED_BADGE_CACHE: OnceLock<Mutex<std::collections::HashMap<String, Arc<RenderImage>>>> =
    OnceLock::new();

fn badge_cache() -> &'static Mutex<std::collections::HashMap<String, Arc<RenderImage>>> {
    RENDERED_BADGE_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn get_or_render_badge(svg: &'static str, cache_key: &str, cx: &App) -> Option<Arc<RenderImage>> {
    if let Ok(cache) = badge_cache().lock()
        && let Some(cached) = cache.get(cache_key)
    {
        return Some(cached.clone());
    }

    let svg_renderer = cx.svg_renderer();
    let image = svg_renderer
        .render_single_frame(svg.as_bytes(), 2.0)
        .ok()?;

    if let Ok(mut cache) = badge_cache().lock() {
        cache.insert(cache_key.to_string(), image.clone());
    }

    Some(image)
}

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
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        if let Some(image) = get_or_render_badge(self.svg, &self.cache_key, cx) {
            img(ImageSource::Render(image))
                .w(self.size)
                .h(self.size)
                .object_fit(ObjectFit::Contain)
                .into_any_element()
        } else {
            div()
                .w(self.size)
                .h(self.size)
                .child(self.cache_key.clone())
                .into_any_element()
        }
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
