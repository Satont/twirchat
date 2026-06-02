use gpui::*;

pub struct EmbeddedSvg {
    interactivity: Interactivity,
    cache_key: SharedString,
    bytes: &'static [u8],
}

impl EmbeddedSvg {
    pub fn new(cache_key: impl Into<SharedString>, bytes: &'static [u8]) -> Self {
        Self {
            interactivity: Interactivity::new(),
            cache_key: cache_key.into(),
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
                        eprintln!("failed to paint embedded svg: {error}");
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
