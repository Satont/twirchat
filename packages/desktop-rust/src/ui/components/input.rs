use gpui::*;

type ChangeCallback = Box<dyn Fn(String, &mut Window, &mut App) + 'static>;

pub struct Input {
    placeholder: SharedString,
    value: SharedString,
    on_change: Option<ChangeCallback>,
}

impl Input {
    pub fn new(placeholder: impl Into<SharedString>) -> Self {
        Self {
            placeholder: placeholder.into(),
            value: SharedString::default(),
            on_change: None,
        }
    }

    pub fn value(mut self, value: impl Into<SharedString>) -> Self {
        self.value = value.into();
        self
    }

    pub fn on_change(mut self, callback: impl Fn(String, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Box::new(callback));
        self
    }
}

impl RenderOnce for Input {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        self
    }
}

impl IntoElement for Input {
    type Element = AnyElement;

    fn into_element(self) -> Self::Element {
        let has_value = !self.value.is_empty();
        let display_value = if has_value {
            self.value.clone()
        } else {
            self.placeholder.clone()
        };
        let value = self.value.to_string();

        let element = div()
            .id("input")
            .w_full()
            .min_h(px(36.0))
            .rounded_lg()
            .border_1()
            .border_color(rgb(0x3f3f46))
            .bg(rgb(0x18181b))
            .px(px(12.0))
            .flex()
            .items_center()
            .text_size(px(13.0))
            .text_color(if has_value {
                rgb(0xf4f4f5)
            } else {
                rgb(0x71717a)
            })
            .child(display_value);

        if let Some(callback) = self.on_change {
            return element
                .cursor_text()
                .on_click(move |_event, window, app| {
                    callback(value.clone(), window, app);
                })
                .into_any_element();
        }

        element.into_any_element()
    }
}
