use crate::app_state::AppState;

use crate::ui::shell::{content, nav, update_toast::UpdateToast};
use gpui::{Context, Entity, Render, Window, div, prelude::*, rgb};

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
}

impl TwirChatApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let state = cx.new(|_| AppState::new());
        cx.observe(&state, |_, _, cx| cx.notify()).detach();

        Self { state }
    }
}

impl Render for TwirChatApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        let state = self.state.read(cx).clone();

        div()
            .id("app-shell")
            .size_full()
            .bg(rgb(0x0f0f11)) // Match Vue body/app background
            .text_color(rgb(0xe2e2e8))
            .flex()
            .flex_row()
            .child(nav::rail(&state, self.state.clone()))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .bg(rgb(0x0f0f11)) // Match .content background
                    .child(content::panel(&state, self.state.clone(), cx)),
            )
            .child(UpdateToast::new(self.state.clone()))
    }
}
