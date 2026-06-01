use gpui::*;

pub struct Icon {
    path: &'static str,
}

impl Icon {
    pub fn new(path: &'static str) -> Self {
        Self { path }
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        svg().path(self.path)
    }
}
