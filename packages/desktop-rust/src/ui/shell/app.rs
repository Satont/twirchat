use crate::app_state::AppState;
use crate::runtime::AppRuntime;

use crate::ui::shell::{content, nav, update_toast::UpdateToast};
use gpui::{Context, Entity, Render, Window, div, prelude::*, rgb};

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
    runtime: Option<AppRuntime>,
}

impl TwirChatApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let (runtime, initial_state) = match AppRuntime::start(Default::default()) {
            Ok(runtime) => {
                let state = AppState::from_storage(runtime.storage());
                (Some(runtime), state)
            }
            Err(error) => {
                eprintln!("desktop-rust runtime startup failed: {error}");
                (None, AppState::new())
            }
        };
        let state = cx.new(|_| initial_state);
        cx.observe(&state, |_, _, cx| cx.notify()).detach();

        Self { state, runtime }
    }

    fn drain_runtime_events(&self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let events = runtime.drain_events();
        if events.is_empty() {
            return;
        }
        self.state.update(cx, |state, cx| {
            for event in events {
                state.apply_service_event(event);
            }
            cx.notify();
        });
    }
}

impl Render for TwirChatApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        self.drain_runtime_events(cx);
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
