use crate::models::Platform;
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

struct EmbeddedSvg {
    interactivity: Interactivity,
    cache_key: SharedString,
    bytes: &'static [u8],
}

impl EmbeddedSvg {
    fn new(cache_key: &'static str, bytes: &'static [u8]) -> Self {
        Self {
            interactivity: Interactivity::new(),
            cache_key: SharedString::from(cache_key),
            bytes,
        }
    }
}

impl Element for EmbeddedSvg {
    type RequestLayoutState = ();
    type PrepaintState = Option<Hitbox>;

    fn id(&self) -> Option<ElementId> {
        self.interactivity.element_id.clone()
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.interactivity.source_location()
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let layout_id = self.interactivity.request_layout(
            global_id,
            inspector_id,
            window,
            cx,
            |style, window, cx| window.request_layout(style, None, cx),
        );
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Hitbox> {
        self.interactivity.prepaint(
            global_id,
            inspector_id,
            bounds,
            bounds.size,
            window,
            cx,
            |_, _, hitbox, _, _| hitbox,
        )
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        hitbox: &mut Option<Hitbox>,
        window: &mut Window,
        cx: &mut App,
    ) where
        Self: Sized,
    {
        self.interactivity.paint(
            global_id,
            inspector_id,
            bounds,
            hitbox.as_ref(),
            window,
            cx,
            |style, window, cx| {
                if let Some(color) = style.text.color {
                    let result = window.paint_svg(
                        bounds,
                        self.cache_key.clone(),
                        Some(self.bytes),
                        TransformationMatrix::default(),
                        color,
                        cx,
                    );
                    if let Err(error) = result {
                        eprintln!("failed to paint embedded platform icon: {error}");
                    }
                }
            },
        );
    }
}

impl IntoElement for EmbeddedSvg {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Styled for EmbeddedSvg {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.interactivity.base_style
    }
}

impl InteractiveElement for EmbeddedSvg {
    fn interactivity(&mut self) -> &mut Interactivity {
        &mut self.interactivity
    }
}
