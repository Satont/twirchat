use gpui::*;

type CloseCallback = Box<dyn Fn(&mut Window, &mut App) + 'static>;

pub struct Modal {
    content: AnyElement,
    on_close: Option<CloseCallback>,
}

impl Modal {
    pub fn new(content: impl IntoElement) -> Self {
        Self {
            content: content.into_any_element(),
            on_close: None,
        }
    }

    pub fn on_close(mut self, on_close: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Box::new(on_close));
        self
    }
}

impl RenderOnce for Modal {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div().child(self.content)
    }
}
