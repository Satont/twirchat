use gpui::{
    AnyElement, App, ClickEvent, IntoElement, RenderOnce, Window, div, prelude::*, px, rgb,
};

type SwitchCallback = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;
type ToggleCallback = Box<dyn Fn(bool, &mut Window, &mut App) + 'static>;

pub struct Switch {
    checked: bool,
    on_click: Option<SwitchCallback>,
    on_toggle: Option<ToggleCallback>,
}

impl Switch {
    pub fn new(checked: bool) -> Self {
        Self {
            checked,
            on_click: None,
            on_toggle: None,
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    pub fn on_click(
        mut self,
        callback: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(callback));
        self
    }

    pub fn on_toggle(mut self, callback: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Box::new(callback));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, _window: &mut Window, _app: &mut App) -> impl IntoElement {
        self
    }
}

impl IntoElement for Switch {
    type Element = AnyElement;

    fn into_element(self) -> Self::Element {
        let bg_color = if self.checked {
            rgb(0x6d28d9) // purple-600
        } else {
            rgb(0x3f3f46) // zinc-700
        };

        let handle_offset = if self.checked { px(18.0) } else { px(2.0) };
        let checked = self.checked;

        let element = div()
            .id("switch")
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
            );

        if let Some(callback) = self.on_click {
            return element
                .on_click(move |event, window, app| {
                    callback(event, window, app);
                })
                .into_any_element();
        }

        if let Some(callback) = self.on_toggle {
            return element
                .on_click(move |_event, window, app| {
                    callback(!checked, window, app);
                })
                .into_any_element();
        }

        element.into_any_element()
    }
}
