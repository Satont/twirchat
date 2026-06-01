use gpui::*;

pub struct Tabs {
    _items: Vec<SharedString>,
}

impl Tabs {
    pub fn new(items: Vec<SharedString>) -> Self {
        Self { _items: items }
    }
}

impl RenderOnce for Tabs {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div()
    }
}
