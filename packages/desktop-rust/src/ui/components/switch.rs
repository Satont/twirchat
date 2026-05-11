use gpui::*;

pub struct Switch {
    _checked: bool,
}

impl Switch {
    pub fn new(checked: bool) -> Self {
        Self { _checked: checked }
    }
}

impl RenderOnce for Switch {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div()
    }
}
