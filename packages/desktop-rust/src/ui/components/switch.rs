use gpui::{App, Div, IntoElement, RenderOnce, Window, div, prelude::*, px, rgb};

pub struct Switch {
    checked: bool,
}

impl Switch {
    pub fn new(checked: bool) -> Self {
        Self { checked }
    }
}

impl RenderOnce for Switch {
    fn render(self, _window: &mut Window, _app: &mut App) -> impl IntoElement {
        let bg_color = if self.checked {
            rgb(0x6d28d9) // purple-600
        } else {
            rgb(0x3f3f46) // zinc-700
        };

        let handle_offset = if self.checked { px(18.0) } else { px(2.0) };

        div()
            .w(px(36.0))
            .h(px(20.0))
            .rounded_full()
            .bg(bg_color)
            .relative()
            .cursor_pointer()
            .child(
                div()
                    .absolute()
                    .top(px(2.0))
                    .left(handle_offset)
                    .w(px(16.0))
                    .h(px(16.0))
                    .rounded_full()
                    .bg(rgb(0xffffff))
                    .shadow_sm(),
            )
    }
}

impl IntoElement for Switch {
    type Element = Div;

    fn into_element(self) -> Self::Element {
        let bg_color = if self.checked {
            rgb(0x6d28d9) // purple-600
        } else {
            rgb(0x3f3f46) // zinc-700
        };

        let handle_offset = if self.checked { px(18.0) } else { px(2.0) };

        div()
            .w(px(36.0))
            .h(px(20.0))
            .rounded_full()
            .bg(bg_color)
            .relative()
            .cursor_pointer()
            .child(
                div()
                    .absolute()
                    .top(px(2.0))
                    .left(handle_offset)
                    .w(px(16.0))
                    .h(px(16.0))
                    .rounded_full()
                    .bg(rgb(0xffffff))
                    .shadow_sm(),
            )
    }
}
