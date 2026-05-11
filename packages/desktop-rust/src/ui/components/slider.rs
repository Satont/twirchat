use gpui::*;

pub struct Slider {
    _value: f32,
}

impl Slider {
    pub fn new(value: f32) -> Self {
        Self { _value: value }
    }
}

impl RenderOnce for Slider {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div()
    }
}
