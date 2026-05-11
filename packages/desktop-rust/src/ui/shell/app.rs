use crate::app_state::{AppState, RuntimeStatus};
use crate::runtime::AppRuntime;

use crate::ui::shell::{content, nav, update_toast::UpdateToast};
use gpui::{Context, Entity, Render, Task, Window, div, prelude::*, px, rgb};
use std::time::Duration;

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
    runtime: Option<AppRuntime>,
    _runtime_poll_task: Option<Task<()>>,
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
                let mut state = AppState::new();
                state.record_runtime_failure(error.to_string());
                (None, state)
            }
        };
        let state = cx.new(|_| initial_state);
        cx.observe(&state, |_, _, cx| cx.notify()).detach();

        let runtime_poll_task = runtime.as_ref().map(|_| {
            cx.spawn(async move |this, cx| {
                loop {
                    if this
                        .update(cx, |this, cx| this.drain_runtime_events(cx))
                        .is_err()
                    {
                        break;
                    }
                    cx.background_executor()
                        .timer(Duration::from_millis(250))
                        .await;
                }
            })
        });

        Self {
            state,
            runtime,
            _runtime_poll_task: runtime_poll_task,
        }
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
            .relative()
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
            .child(runtime_status_bar(&state))
            .child(UpdateToast::new(self.state.clone()))
    }
}

fn runtime_status_bar(state: &AppState) -> impl gpui::IntoElement {
    let status_text = if !state.runtime_errors().is_empty() {
        format!("runtime error · {} issue(s)", state.runtime_errors().len())
    } else {
        match state.runtime_status() {
            RuntimeStatus::Starting => String::from("runtime starting…"),
            RuntimeStatus::Running => {
                format!(
                    "runtime connected · {} event(s)",
                    state.service_events_seen()
                )
            }
            RuntimeStatus::Stopped => String::from("runtime stopped"),
            RuntimeStatus::Failed => String::from("runtime failed"),
        }
    };

    div()
        .absolute()
        .right(px(16.0))
        .bottom(px(12.0))
        .rounded_lg()
        .px(px(10.0))
        .py(px(6.0))
        .bg(rgb(0x18181b))
        .border_1()
        .border_color(if state.runtime_errors().is_empty() {
            rgb(0x2a2a33)
        } else {
            rgb(0x7f1d1d)
        })
        .text_size(px(11.0))
        .text_color(if state.runtime_errors().is_empty() {
            rgb(0xa1a1aa)
        } else {
            rgb(0xfca5a5)
        })
        .child(status_text)
}
