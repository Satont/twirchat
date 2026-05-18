use crate::app_state::AppState;
use crate::runtime::AppRuntime;
use crate::services::{BackendWsEvent, ServiceEvent};

use crate::ui::chat::ChatScrollUi;
use crate::ui::components::input::Input;
use crate::ui::shell::{content, nav, update_toast::UpdateToast};
use gpui::{
    Context, Entity, FollowMode, ListAlignment, ListState, Render, ScrollHandle, Task, Window, div,
    prelude::*, px, retain_all, rgb,
};
use std::time::Duration;

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
    composer_input: Entity<Input>,
    add_channel_input: Entity<Input>,
    runtime: Option<AppRuntime>,
    _runtime_poll_task: Option<Task<()>>,
    chat_list_state: ListState,
    settings_scroll_handle: ScrollHandle,
    platforms_scroll_handle: ScrollHandle,
    last_chat_message_count: usize,
    chat_scroll_paused: bool,
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
        let composer_input = cx.new(|cx| {
            Input::new(
                "Send a message... (Enter ↵ to send, Shift+Enter for newline)",
                cx,
            )
        });
        let add_channel_input = cx.new(|cx| Input::new("Twitch channel name", cx));
        cx.observe(&state, |_, _, cx| cx.notify()).detach();
        cx.observe(&composer_input, |_, _, cx| cx.notify()).detach();
        cx.observe(&add_channel_input, |_, _, cx| cx.notify())
            .detach();

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

        let chat_list_state = ListState::new(0, ListAlignment::Bottom, px(2048.));
        chat_list_state.set_follow_mode(FollowMode::Tail);

        Self {
            state,
            composer_input,
            add_channel_input,
            runtime,
            _runtime_poll_task: runtime_poll_task,
            chat_list_state,
            settings_scroll_handle: ScrollHandle::new(),
            platforms_scroll_handle: ScrollHandle::new(),
            last_chat_message_count: 0,
            chat_scroll_paused: false,
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
        let should_resubscribe_seven_tv = events
            .iter()
            .any(|event| matches!(event, ServiceEvent::BackendWs(BackendWsEvent::Connected)));
        self.state.update(cx, |state, cx| {
            for event in events {
                state.apply_service_event(event);
            }
            cx.notify();
        });
        if should_resubscribe_seven_tv && let Err(error) = runtime.dispatch_seven_tv_resubscribe() {
            self.state.update(cx, |state, cx| {
                state.record_runtime_failure(format!(
                    "failed to resubscribe 7TV after backend reconnect: {error}"
                ));
                cx.notify();
            });
        }
    }

    fn flush_pending_watched_channel_adds(&self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let pending = self
            .state
            .update(cx, |state, _| state.take_pending_watched_channel_adds());

        for add in pending {
            eprintln!(
                "[watched/live] dispatching watched-channel add platform={:?} slug={}",
                add.platform, add.channel_slug
            );
            if let Err(error) = runtime.dispatch_watched_channel_add(
                add.platform,
                add.channel_slug.clone(),
                add.display_name.clone(),
            ) {
                let message = format!(
                    "failed to dispatch watched-channel add for {:?}/{}: {}",
                    add.platform, add.channel_slug, error
                );
                eprintln!("[watched/live] {message}");
                self.state.update(cx, |state, cx| {
                    state.record_runtime_failure(message);
                    cx.notify();
                });
            }
        }
    }

    fn flush_pending_watched_channel_messages(&self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let pending = self
            .state
            .update(cx, |state, _| state.take_pending_watched_channel_messages());

        for message in pending {
            if let Err(error) = runtime
                .dispatch_watched_channel_message(message.channel_id.clone(), message.text.clone())
            {
                let error_message = format!(
                    "failed to send watched-channel message for {}: {}",
                    message.channel_id, error
                );
                self.state.update(cx, |state, cx| {
                    state.record_runtime_failure(error_message);
                    cx.notify();
                });
            }
        }
    }

    fn flush_pending_backend_messages(&self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let pending = self
            .state
            .update(cx, |state, _| state.take_pending_backend_messages());

        for message in pending {
            if let Err(error) = runtime.dispatch_backend_ws_message(message) {
                let error_message = format!("failed to send backend message: {}", error);
                self.state.update(cx, |state, cx| {
                    state.record_runtime_failure(error_message);
                    cx.notify();
                });
            }
        }
    }

    fn flush_composer_submit(&self, cx: &mut Context<Self>) {
        let submit_text = self.composer_input.update(cx, |input, _cx| {
            input
                .take_submit_requested()
                .then(|| input.text().trim().to_string())
        });

        let Some(text) = submit_text.filter(|text| !text.is_empty()) else {
            return;
        };

        let queued = self.state.update(cx, |state, cx| {
            let queued = state.queue_composer_send(&text);
            cx.notify();
            queued
        });
        if queued {
            self.composer_input.update(cx, |input, cx| input.clear(cx));
        }
    }
}

impl Render for TwirChatApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        self.drain_runtime_events(cx);
        self.flush_composer_submit(cx);
        self.flush_pending_watched_channel_adds(cx);
        self.flush_pending_watched_channel_messages(cx);
        self.flush_pending_backend_messages(cx);
        let state = self.state.read(cx).clone();
        let composer_text = self.composer_input.read(cx).text().to_string();
        let was_following_tail = self.chat_list_state.is_following_tail();
        self.chat_scroll_paused = !was_following_tail;

        if state.messages.len() != self.last_chat_message_count {
            self.chat_list_state.reset(state.messages.len());
            if was_following_tail {
                self.chat_list_state.set_follow_mode(FollowMode::Tail);
            }
        }
        self.last_chat_message_count = state.messages.len();

        div()
            .image_cache(retain_all("twirchat-images"))
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
                    .min_w(px(0.0))
                    .min_h(px(0.0))
                    .flex()
                    .flex_col()
                    .bg(rgb(0x0f0f11)) // Match .content background
                    .child(content::panel(
                        &state,
                        content::ContentPanelProps {
                            state_entity: self.state.clone(),
                            composer_input: self.composer_input.clone(),
                            add_channel_input: self.add_channel_input.clone(),
                            composer_text,
                            scroll_ui: content::SectionScrollUi {
                                chat: ChatScrollUi {
                                    list_state: &self.chat_list_state,
                                    paused: self.chat_scroll_paused,
                                },
                                settings: &self.settings_scroll_handle,
                                platforms: &self.platforms_scroll_handle,
                            },
                        },
                        window,
                        cx,
                    )),
            )
            .child(UpdateToast::new(self.state.clone()))
    }
}
