use crate::app_state::AppState;
use crate::app_state::mock_data::PrototypeData;
use crate::theme;
use crate::ui::shell::{content, nav};
use gpui::{Context, Entity, Render, Window, div, prelude::*, px, rgb};

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
    pub(crate) data: PrototypeData,
}

impl TwirChatApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let state = cx.new(|_| AppState::new());
        cx.observe(&state, |_, _, cx| cx.notify()).detach();

        Self {
            state,
            data: PrototypeData::load(),
        }
    }
}

impl Render for TwirChatApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        let state = self.state.read(cx).clone();

        div().size_full().bg(rgb(0x070709)).p(px(8.0)).child(
            div()
                .size_full()
                .rounded_xl()
                .border_1()
                .border_color(rgb(0x2a2a33))
                .bg(theme::background())
                .text_color(theme::text_primary())
                .flex()
                .flex_row()
                .child(nav::rail(&state, self.state.clone()))
                .child(content::panel(&state, &self.data, self.state.clone(), cx)),
        )
    }
}
