use crate::app_state::{
    AppState, AppStateActions, MainSection, UserCardHistoryPage, UserCardHistoryRequest,
    UserCardLoadState,
};
use crate::chat::{
    MentionSuggestion, ParsedMentionToken, fuzzy_filter_mentions, mention_suggestions,
    parse_mention_token, replace_mention_token,
};
use crate::hotkeys::matches_hotkey;
use crate::models::Platform as UiPlatform;
use crate::protocol::messages::{
    UserCardFieldStatus, UserCardMetadataPlatform, UserCardMetadataRequest,
    UserCardMetadataResponse,
};
use crate::protocol::rpc::{GetUserChatHistoryParams, UserChatHistoryPage};
use crate::protocol::types::Platform;
use crate::runtime::{AppRuntime, UPDATE_CHECK_INTERVAL, UpdateCheckSource, UserCardRuntimeLoader};
use crate::services::{BackendWsEvent, ServiceEvent, fetch_channels_status};

use crate::ui::components::input::Input;
use crate::ui::components::user_card::{
    HistoryMessage, HistoryState, MetadataState, UserCard, UserCardMetadata,
};
use crate::ui::shell::{content, nav, update_toast::UpdateToast};
use crate::ui::{
    chat::{ChatScrollUi, MentionAutocompleteUi},
    theme,
};
use gpui::{
    App, Context, Entity, FocusHandle, Focusable, FollowMode, KeystrokeEvent, ListAlignment,
    ListState, Render, ScrollHandle, Subscription, Task, Window, div, prelude::*, px, retain_all,
    rgb,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

pub struct TwirChatApp {
    pub(crate) state: Entity<AppState>,
    composer_input: Entity<Input>,
    font_size_input: Entity<Input>,
    user_card_alias_input: Entity<Input>,
    add_channel_input: Entity<Input>,
    tab_selector_input: Entity<Input>,
    watched_composer_inputs: BTreeMap<String, Entity<Input>>,
    hotkey_capture_focus: FocusHandle,
    tab_selector_focus: FocusHandle,
    runtime: Option<AppRuntime>,
    _runtime_poll_task: Option<Task<()>>,
    _update_check_task: Option<Task<()>>,
    update_toast_dismiss_task: Option<Task<()>>,
    _stream_status_task: Option<Task<()>>,
    _user_card_history_task: Option<Task<()>>,
    _user_card_metadata_task: Option<Task<()>>,
    user_card_load_generation: Option<u64>,
    mention_selected_index: usize,
    mention_last_context: String,
    mention_dismissed_context: Option<String>,
    chat_list_state: ListState,
    settings_scroll_handle: ScrollHandle,
    platforms_scroll_handle: ScrollHandle,
    user_card_scroll_handle: ScrollHandle,
    last_chat_message_count: usize,
    chat_scroll_paused: bool,
    tab_selector_open: bool,
    tab_selector_selected_index: usize,
    last_tab_selector_query: String,
    _keystroke_subscription: Subscription,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MentionComposerTarget {
    Home,
    Watched(String),
}

struct ActiveMentionAutocomplete {
    target: MentionComposerTarget,
    context_id: String,
    token: ParsedMentionToken,
    suggestions: Vec<MentionSuggestion>,
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
        let composer_input = cx.new(|cx| Input::new("Send a message...", cx).with_clear_on_copy());
        let initial_font_size =
            crate::ui::chat::format_chat_font_size(state.read(cx).settings().font_size);
        let font_size_input = cx.new(|cx| {
            let mut input = Input::new("14", cx).with_compact_appearance();
            input.set_text(initial_font_size, cx);
            input
        });
        let user_card_alias_input = cx.new(|cx| Input::new("Local alias", cx));
        let add_channel_input = cx.new(|cx| Input::new("Twitch channel name", cx));
        let tab_selector_input = cx.new(|cx| Input::new("Switch to tab...", cx));
        let hotkey_capture_focus = cx.focus_handle();
        let tab_selector_focus = cx.focus_handle();
        cx.observe(&state, |_, _, cx| cx.notify()).detach();
        cx.observe(&composer_input, |_, _, cx| cx.notify()).detach();
        cx.observe(&font_size_input, |_, _, cx| cx.notify())
            .detach();
        cx.observe(&user_card_alias_input, |_, _, cx| cx.notify())
            .detach();
        cx.observe(&add_channel_input, |_, _, cx| cx.notify())
            .detach();
        cx.observe(&tab_selector_input, |_, _, cx| cx.notify())
            .detach();
        let keystroke_listener = cx.listener(Self::observe_keystrokes);
        let keystroke_subscription = cx.intercept_keystrokes(keystroke_listener);

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
        let stream_status_task = runtime.as_ref().map(|runtime| {
            let config = runtime.config().clone();
            cx.spawn(async move |this, cx| {
                loop {
                    let requests = match this.update(cx, |this, cx| {
                        this.state.read(cx).home_channel_status_requests()
                    }) {
                        Ok(requests) => requests,
                        Err(_) => break,
                    };

                    if !requests.is_empty() {
                        let config = config.clone();
                        let result = cx
                            .background_executor()
                            .spawn(async move { fetch_channels_status(&config, requests) })
                            .await;

                        match result {
                            Ok(response) => {
                                if this
                                    .update(cx, |this, cx| {
                                        this.state.update(cx, |state, cx| {
                                            state.apply_home_channel_statuses(response.channels);
                                            cx.notify();
                                        });
                                        cx.notify();
                                    })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(error) => {
                                eprintln!("[stream-status] channel status refresh failed: {error}");
                            }
                        }
                    }

                    cx.background_executor()
                        .timer(Duration::from_secs(30))
                        .await;
                }
            })
        });

        let update_check_task = runtime.as_ref().map(|runtime| {
            let auto_check_enabled = state.read(cx).update_state().auto_check_updates;
            if auto_check_enabled {
                let _ = runtime.dispatch_update_check(UpdateCheckSource::Startup);
            }
            cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(UPDATE_CHECK_INTERVAL).await;
                    let auto_check_enabled = match this.update(cx, |this, cx| {
                        this.state.read(cx).update_state().auto_check_updates
                    }) {
                        Ok(enabled) => enabled,
                        Err(_) => break,
                    };
                    if auto_check_enabled
                        && let Ok(Some(runtime)) = this.update(cx, |this, _| {
                            this.runtime.as_ref().map(|runtime| {
                                runtime.dispatch_update_check(UpdateCheckSource::Periodic)
                            })
                        })
                        && let Err(error) = runtime
                    {
                        let _ = this.update(cx, |this, cx| {
                            this.state.update(cx, |state, cx| {
                                state.record_runtime_failure(format!(
                                    "failed to dispatch periodic update check: {error}"
                                ));
                                cx.notify();
                            });
                        });
                    }
                }
            })
        });

        let chat_list_state = ListState::new(0, ListAlignment::Bottom, px(2048.));
        chat_list_state.set_follow_mode(FollowMode::Tail);

        Self {
            state,
            composer_input,
            font_size_input,
            user_card_alias_input,
            add_channel_input,
            tab_selector_input,
            watched_composer_inputs: BTreeMap::new(),
            hotkey_capture_focus,
            tab_selector_focus,
            runtime,
            _runtime_poll_task: runtime_poll_task,
            _update_check_task: update_check_task,
            update_toast_dismiss_task: None,
            _stream_status_task: stream_status_task,
            _user_card_history_task: None,
            _user_card_metadata_task: None,
            user_card_load_generation: None,
            mention_selected_index: 0,
            mention_last_context: String::new(),
            mention_dismissed_context: None,
            chat_list_state,
            settings_scroll_handle: ScrollHandle::new(),
            platforms_scroll_handle: ScrollHandle::new(),
            user_card_scroll_handle: ScrollHandle::new(),
            last_chat_message_count: 0,
            chat_scroll_paused: false,
            tab_selector_open: false,
            tab_selector_selected_index: 0,
            last_tab_selector_query: String::new(),
            _keystroke_subscription: keystroke_subscription,
        }
    }

    fn drain_runtime_events(&mut self, cx: &mut Context<Self>) {
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
        let update_snapshot = self.state.read(cx).update_state().clone();
        self.schedule_update_toast_auto_dismiss(update_snapshot, cx);
        if should_resubscribe_seven_tv
            && let Some(runtime) = &self.runtime
            && let Err(error) = runtime.dispatch_seven_tv_resubscribe()
        {
            self.state.update(cx, |state, cx| {
                state.record_runtime_failure(format!(
                    "failed to resubscribe 7TV after backend reconnect: {error}"
                ));
                cx.notify();
            });
        }
    }

    fn schedule_update_toast_auto_dismiss(
        &mut self,
        update_snapshot: crate::runtime::UpdateStatusSnapshot,
        cx: &mut Context<Self>,
    ) {
        let Some(delay_ms) = update_snapshot.auto_dismiss_after_ms else {
            return;
        };
        let expected_status = update_snapshot.status;
        let expected_message = update_snapshot.message;
        let expected_hash = update_snapshot.hash;

        self.update_toast_dismiss_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(delay_ms))
                .await;

            let _ = this.update(cx, |this, cx| {
                let current = this.state.read(cx).update_state();
                let matches_auto_dismiss_target = current.show
                    && current.status == expected_status
                    && current.message == expected_message
                    && current.hash == expected_hash;
                if matches_auto_dismiss_target {
                    this.state.update(cx, |state, cx| {
                        state.dismiss_update_toast();
                        cx.notify();
                    });
                    cx.notify();
                }
            });
        }));
    }

    pub(crate) fn download_update(&mut self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            self.record_update_dispatch_failure("download update", "runtime is not running", cx);
            return;
        };

        if let Err(error) = runtime.dispatch_update_download() {
            self.record_update_dispatch_failure("download update", &error.to_string(), cx);
        }
    }

    pub(crate) fn apply_update(&mut self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            self.record_update_dispatch_failure("apply update", "runtime is not running", cx);
            return;
        };

        if let Err(error) = runtime.dispatch_update_apply() {
            self.record_update_dispatch_failure("apply update", &error.to_string(), cx);
        }
    }

    pub(crate) fn skip_update(&mut self, hash: String, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            self.record_update_dispatch_failure("skip update", "runtime is not running", cx);
            return;
        };

        if let Err(error) = runtime.dispatch_update_skip(hash) {
            self.record_update_dispatch_failure("skip update", &error.to_string(), cx);
        }
    }

    fn record_update_dispatch_failure(
        &mut self,
        action: &'static str,
        reason: &str,
        cx: &mut Context<Self>,
    ) {
        let message = format!("failed to dispatch {action}: {reason}");
        eprintln!("[updates] {message}");
        self.state.update(cx, |state, cx| {
            state.record_runtime_failure(message);
            cx.notify();
        });
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
            if let Err(error) = runtime.dispatch_watched_channel_message(
                message.channel_id.clone(),
                message.text.clone(),
                message.reply_to_message_id.clone(),
                message.client_message_id.clone(),
            ) {
                let error_message = format!(
                    "failed to send watched-channel message for {}: {}",
                    message.channel_id, error
                );
                self.state.update(cx, |state, cx| {
                    state.mark_watched_send_dispatch_failed(
                        message.client_message_id.as_deref(),
                        error_message,
                    );
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

    fn start_user_card_loads(&mut self, cx: &mut Context<Self>) {
        self.refresh_user_card_metadata(cx);
        self.refresh_user_card_history(cx);
    }

    fn refresh_user_card_metadata(&mut self, cx: &mut Context<Self>) {
        let Some(target) = self
            .state
            .update(cx, |state, _cx| state.user_card.target.clone())
        else {
            return;
        };
        let Some(platform) = metadata_platform(target.platform) else {
            return;
        };

        let Some(generation) = self.state.update(cx, |state, cx| {
            let generation = state.start_user_card_metadata_load()?;
            cx.notify();
            Some(generation)
        }) else {
            return;
        };

        let request = UserCardMetadataRequest {
            platform,
            platform_user_id: target.platform_user_id,
            username: target.username,
            channel_id: Some(target.channel_id),
            channel_slug: Some(target.channel_slug),
        };
        let Some(loader) = self.runtime.as_ref().map(AppRuntime::user_card_loader) else {
            self.state.update(cx, |state, cx| {
                state.apply_user_card_metadata_result(
                    generation,
                    Err("runtime is not available".to_string()),
                );
                cx.notify();
            });
            return;
        };

        self._user_card_metadata_task = Some(cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    loader
                        .fetch_user_card_metadata(request)
                        .map_err(|error| error.to_string())
                })
                .await;

            let _ = this.update(cx, |this, cx| {
                this.state.update(cx, |state, cx| {
                    state.apply_user_card_metadata_result(generation, result);
                    cx.notify();
                });
                this._user_card_metadata_task = None;
                cx.notify();
            });
        }));
    }

    fn refresh_user_card_history(&mut self, cx: &mut Context<Self>) {
        let Some((request, target)) = self.state.update(cx, |state, cx| {
            let target = state.user_card.target.clone()?;
            let request = state.start_user_card_history_load()?;
            cx.notify();
            Some((request, target))
        }) else {
            return;
        };

        self.start_user_card_history_task(
            self.runtime.as_ref().map(AppRuntime::user_card_loader),
            request,
            GetUserChatHistoryParams {
                platform: target.platform,
                platform_user_id: target.platform_user_id,
                limit: Some(50),
                cursor: None,
            },
            cx,
        );
    }

    fn load_older_user_card_history(&mut self, cx: &mut Context<Self>) {
        let Some((request, target, cursor)) = self.state.update(cx, |state, cx| {
            let target = state.user_card.target.clone()?;
            let cursor = state.user_card.next_cursor.clone()?;
            let request = state.start_user_card_older_history_load()?;
            cx.notify();
            Some((request, target, cursor))
        }) else {
            return;
        };

        self.start_user_card_history_task(
            self.runtime.as_ref().map(AppRuntime::user_card_loader),
            request,
            GetUserChatHistoryParams {
                platform: target.platform,
                platform_user_id: target.platform_user_id,
                limit: Some(50),
                cursor: Some(cursor),
            },
            cx,
        );
    }

    fn start_user_card_history_task(
        &mut self,
        loader: Option<UserCardRuntimeLoader>,
        request: UserCardHistoryRequest,
        params: GetUserChatHistoryParams,
        cx: &mut Context<Self>,
    ) {
        let Some(loader) = loader else {
            self.state.update(cx, |state, cx| {
                state.apply_user_card_history_result(
                    request,
                    Err("runtime is not available".to_string()),
                );
                cx.notify();
            });
            return;
        };

        self._user_card_history_task = Some(cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    loader
                        .load_user_chat_history(params)
                        .map(user_card_history_page_from_protocol)
                        .map_err(|error| error.to_string())
                })
                .await;

            let _ = this.update(cx, |this, cx| {
                this.state.update(cx, |state, cx| {
                    state.apply_user_card_history_result(request, result);
                    cx.notify();
                });
                this._user_card_history_task = None;
                cx.notify();
            });
        }));
    }

    fn close_user_card(&mut self, cx: &mut Context<Self>) {
        self._user_card_history_task = None;
        self._user_card_metadata_task = None;
        self.user_card_load_generation = None;
        self.state.update(cx, |state, cx| {
            state.close_user_card();
            cx.notify();
        });
        cx.notify();
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

    fn flush_font_size_submit(&self, cx: &mut Context<Self>) {
        let submitted_text = self.font_size_input.update(cx, |input, _cx| {
            input
                .take_submit_requested()
                .then(|| input.text().trim().to_string())
        });

        let Some(submitted_text) = submitted_text else {
            return;
        };

        let current_font_size = self.state.read(cx).settings().font_size;
        let parsed_font_size = crate::ui::chat::parse_chat_font_size_input(&submitted_text);
        let display_font_size = parsed_font_size
            .unwrap_or_else(|| crate::ui::chat::normalize_chat_font_size(current_font_size));

        if let Some(font_size) = parsed_font_size {
            self.state.set_font_size(cx, font_size);
            self.state.persist_settings(cx);
        }

        self.font_size_input.update(cx, |input, cx| {
            input.set_text(
                crate::ui::chat::format_chat_font_size(display_font_size),
                cx,
            );
        });
        cx.notify();
    }

    fn sync_font_size_input(&self, state: &AppState, window: &Window, cx: &mut Context<Self>) {
        if self
            .font_size_input
            .read(cx)
            .focus_handle(cx)
            .is_focused(window)
        {
            return;
        }

        let expected_text = crate::ui::chat::format_chat_font_size(state.settings().font_size);
        if self.font_size_input.read(cx).text() == expected_text {
            return;
        }

        self.font_size_input
            .update(cx, |input, cx| input.set_text(expected_text, cx));
    }

    fn flush_pending_watched_channel_removals(&self, cx: &mut Context<Self>) {
        let Some(runtime) = &self.runtime else {
            return;
        };
        let pending = self
            .state
            .update(cx, |state, _| state.take_pending_watched_channel_removals());

        for remove in pending {
            if let Err(error) = runtime.dispatch_watched_channel_remove(remove.channel_id.clone()) {
                let error_message = format!(
                    "failed to remove watched channel {}: {}",
                    remove.channel_id, error
                );
                self.state.update(cx, |state, cx| {
                    state.record_runtime_failure(error_message);
                    cx.notify();
                });
            }
        }
    }

    fn flush_watched_composer_submits(&self, cx: &mut Context<Self>) {
        for (channel_id, input) in &self.watched_composer_inputs {
            let submit_text = input.update(cx, |input, _cx| {
                input
                    .take_submit_requested()
                    .then(|| input.text().trim().to_string())
            });

            let Some(text) = submit_text.filter(|text| !text.is_empty()) else {
                continue;
            };

            let queued = self.state.update(cx, |state, cx| {
                let queued = state.queue_watched_channel_send(channel_id, &text);
                cx.notify();
                queued
            });
            if queued {
                input.update(cx, |input, cx| input.clear(cx));
            }
        }
    }

    fn sync_watched_composer_inputs(&mut self, state: &AppState, cx: &mut Context<Self>) {
        let watched_ids = state
            .watched_channels
            .iter()
            .map(|channel| channel.id.clone())
            .collect::<BTreeSet<_>>();
        self.watched_composer_inputs
            .retain(|channel_id, _| watched_ids.contains(channel_id));

        for channel in &state.watched_channels {
            if self.watched_composer_inputs.contains_key(&channel.id) {
                continue;
            }

            let input =
                cx.new(|input_cx| Input::new("Send a message...", input_cx).with_clear_on_copy());
            cx.observe(&input, |_, _, cx| cx.notify()).detach();
            self.watched_composer_inputs
                .insert(channel.id.clone(), input);
        }
    }

    fn sync_mention_selection(&mut self, active: &ActiveMentionAutocomplete) {
        if self.mention_last_context != active.context_id {
            self.mention_last_context = active.context_id.clone();
            self.mention_selected_index = 0;
            return;
        }

        if active.suggestions.is_empty() {
            self.mention_selected_index = 0;
        } else {
            self.mention_selected_index = self
                .mention_selected_index
                .min(active.suggestions.len().saturating_sub(1));
        }
    }

    fn active_mention_autocomplete(
        &self,
        state: &AppState,
        window: &Window,
        cx: &App,
    ) -> Option<ActiveMentionAutocomplete> {
        let (target, text) = self.focused_mention_input_text(window, cx)?;
        let token = parse_mention_token(&text)?;
        let context_id = mention_context_id(&target, &token.query);
        if self.mention_dismissed_context.as_deref() == Some(context_id.as_str()) {
            return None;
        }

        let messages = mention_source_messages(state, &target);
        let candidates = mention_suggestions(messages, state.aliases());
        let suggestions = fuzzy_filter_mentions(&candidates, &token.query, 15);
        if suggestions.is_empty() {
            return None;
        }

        Some(ActiveMentionAutocomplete {
            target,
            context_id,
            token,
            suggestions,
        })
    }

    fn focused_mention_input_text(
        &self,
        window: &Window,
        cx: &App,
    ) -> Option<(MentionComposerTarget, String)> {
        let home_focused = self
            .composer_input
            .read(cx)
            .focus_handle(cx)
            .is_focused(window);
        if home_focused {
            return Some((
                MentionComposerTarget::Home,
                self.composer_input.read(cx).text().to_string(),
            ));
        }

        for (channel_id, input) in &self.watched_composer_inputs {
            if input.read(cx).focus_handle(cx).is_focused(window) {
                return Some((
                    MentionComposerTarget::Watched(channel_id.clone()),
                    input.read(cx).text().to_string(),
                ));
            }
        }

        None
    }

    fn input_for_mention_target(&self, target: &MentionComposerTarget) -> Option<Entity<Input>> {
        match target {
            MentionComposerTarget::Home => Some(self.composer_input.clone()),
            MentionComposerTarget::Watched(channel_id) => {
                self.watched_composer_inputs.get(channel_id).cloned()
            }
        }
    }

    pub(crate) fn select_mention_suggestion(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let state = self.state.read(cx).clone();
        let Some(active) = self.active_mention_autocomplete(&state, window, cx) else {
            return;
        };
        let Some(suggestion) = active
            .suggestions
            .get(index.min(active.suggestions.len().saturating_sub(1)))
            .cloned()
        else {
            return;
        };
        let Some(input) = self.input_for_mention_target(&active.target) else {
            return;
        };

        let next_text = replace_mention_token(input.read(cx).text(), &active.token, &suggestion);
        input.update(cx, |input, cx| input.set_text(next_text, cx));
        let focus = input.read(cx).focus_handle(cx);
        window.focus(&focus, cx);
        self.mention_selected_index = 0;
        self.mention_last_context.clear();
        self.mention_dismissed_context = None;
        cx.notify();
    }

    fn handle_mention_keystroke(
        &mut self,
        event: &KeystrokeEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let state = self.state.read(cx).clone();
        let Some(active) = self.active_mention_autocomplete(&state, window, cx) else {
            return false;
        };
        self.sync_mention_selection(&active);

        match event.keystroke.key.as_str() {
            "escape" => {
                self.mention_dismissed_context = Some(active.context_id);
                cx.stop_propagation();
                cx.notify();
                true
            }
            "down" | "arrowdown" => {
                self.mention_selected_index =
                    (self.mention_selected_index + 1) % active.suggestions.len();
                cx.stop_propagation();
                cx.notify();
                true
            }
            "up" | "arrowup" => {
                self.mention_selected_index = if self.mention_selected_index == 0 {
                    active.suggestions.len().saturating_sub(1)
                } else {
                    self.mention_selected_index - 1
                };
                cx.stop_propagation();
                cx.notify();
                true
            }
            "enter" | "tab" => {
                self.select_mention_suggestion(self.mention_selected_index, window, cx);
                cx.stop_propagation();
                true
            }
            _ => false,
        }
    }

    fn save_user_alias(
        &mut self,
        platform: Platform,
        platform_user_id: String,
        alias: String,
        cx: &mut Context<Self>,
    ) {
        let Some(runtime) = &self.runtime else {
            self.state.update(cx, |state, cx| {
                state
                    .record_runtime_failure("cannot save alias before runtime startup".to_string());
                cx.notify();
            });
            return;
        };

        let saved = self.state.update(cx, |state, cx| {
            let saved = match state.set_user_alias(
                runtime.storage(),
                platform,
                &platform_user_id,
                &alias,
            ) {
                Ok(saved) => saved,
                Err(error) => {
                    state.record_runtime_failure(error.to_string());
                    false
                }
            };
            cx.notify();
            saved
        });
        if saved {
            self.close_user_card(cx);
        }
    }

    fn remove_user_alias(
        &mut self,
        platform: Platform,
        platform_user_id: String,
        cx: &mut Context<Self>,
    ) {
        let Some(runtime) = &self.runtime else {
            self.state.update(cx, |state, cx| {
                state.record_runtime_failure(
                    "cannot remove alias before runtime startup".to_string(),
                );
                cx.notify();
            });
            return;
        };

        let removed = self.state.update(cx, |state, cx| {
            let removed =
                match state.remove_user_alias(runtime.storage(), platform, &platform_user_id) {
                    Ok(removed) => removed,
                    Err(error) => {
                        state.record_runtime_failure(error.to_string());
                        false
                    }
                };
            cx.notify();
            removed
        });
        if removed {
            self.user_card_alias_input
                .update(cx, |input, cx| input.clear(cx));
            self.close_user_card(cx);
        }
    }

    fn shortcuts_blocked(&self, window: &Window, cx: &App) -> bool {
        if self.hotkey_capture_focus.is_focused(window) {
            return true;
        }

        self.add_channel_input
            .read(cx)
            .focus_handle(cx)
            .is_focused(window)
            || self
                .font_size_input
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
            || self
                .user_card_alias_input
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
    }

    fn observe_keystrokes(
        &mut self,
        event: &KeystrokeEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.keystroke.key.as_str() == "escape" && self.state.read(cx).user_card.open {
            self.close_user_card(cx);
            cx.stop_propagation();
            return;
        }

        if self.tab_selector_open {
            self.handle_tab_selector_keystroke(event, cx);
            return;
        }

        if self.handle_mention_keystroke(event, window, cx) {
            return;
        }

        if self.shortcuts_blocked(window, cx) {
            return;
        }

        let hotkeys = self.state.read(cx).settings().hotkeys.clone();

        if matches_hotkey(&event.keystroke, &hotkeys.new_tab) {
            self.add_channel_input.update(cx, |input, cx| {
                input.clear(cx);
                input.set_placeholder("Twitch channel name", cx);
            });
            self.state.update(cx, |state, cx| {
                state.select_section(MainSection::Chat);
                state.open_add_channel_modal();
                cx.notify();
            });
            cx.stop_propagation();
            return;
        }

        if matches_hotkey(&event.keystroke, &hotkeys.next_tab) {
            self.state.update(cx, |state, cx| {
                state.cycle_channel_tab(1);
                cx.notify();
            });
            cx.stop_propagation();
            return;
        }

        if matches_hotkey(&event.keystroke, &hotkeys.prev_tab) {
            self.state.update(cx, |state, cx| {
                state.cycle_channel_tab(-1);
                cx.notify();
            });
            cx.stop_propagation();
            return;
        }

        if matches_hotkey(&event.keystroke, &hotkeys.tab_selector) {
            self.open_tab_selector(window, cx);
            cx.stop_propagation();
        }
    }

    fn close_tab_selector(&mut self, cx: &mut Context<Self>) {
        self.tab_selector_open = false;
        self.tab_selector_selected_index = 0;
        self.last_tab_selector_query.clear();
        self.tab_selector_input
            .update(cx, |input, cx| input.clear(cx));
        cx.notify();
    }

    fn open_tab_selector(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let state = self.state.read(cx).clone();
        let items = fuzzy_filter_tab_items(
            &content::tab_items(&state),
            self.tab_selector_input.read(cx).text(),
        );
        if items.is_empty() {
            return;
        }

        self.tab_selector_input
            .update(cx, |input, cx| input.clear(cx));
        self.last_tab_selector_query.clear();
        self.tab_selector_selected_index = items
            .iter()
            .position(|item| item.id == state.active_channel_tab_id())
            .unwrap_or(0);
        self.tab_selector_open = true;
        window.focus(&self.tab_selector_focus, cx);
        let input_focus = self.tab_selector_input.read(cx).focus_handle(cx);
        window.focus(&input_focus, cx);
        cx.notify();
    }

    fn handle_tab_selector_keystroke(&mut self, event: &KeystrokeEvent, cx: &mut Context<Self>) {
        let items = fuzzy_filter_tab_items(
            content::tab_items(self.state.read(cx)).as_slice(),
            self.tab_selector_input.read(cx).text(),
        );

        match event.keystroke.key.as_str() {
            "escape" => {
                self.close_tab_selector(cx);
                cx.stop_propagation();
            }
            "down" | "arrowdown" if !items.is_empty() => {
                self.tab_selector_selected_index =
                    (self.tab_selector_selected_index + 1).min(items.len().saturating_sub(1));
                cx.stop_propagation();
                cx.notify();
            }
            "up" | "arrowup" if !items.is_empty() => {
                self.tab_selector_selected_index =
                    self.tab_selector_selected_index.saturating_sub(1);
                cx.stop_propagation();
                cx.notify();
            }
            "enter" if !items.is_empty() => {
                let selected = self
                    .tab_selector_selected_index
                    .min(items.len().saturating_sub(1));
                let tab_id = items[selected].id.clone();
                self.state.update(cx, |state, cx| {
                    state.select_section(MainSection::Chat);
                    state.select_channel_tab(tab_id);
                    cx.notify();
                });
                self.close_tab_selector(cx);
                cx.stop_propagation();
            }
            _ => {}
        }
    }

    fn render_user_card_modal(&self, state: &AppState, cx: &mut Context<Self>) -> gpui::AnyElement {
        let Some(target) = &state.user_card.target else {
            return div().into_any_element();
        };

        let app_entity = cx.entity();
        let close_entity = app_entity.clone();
        let refresh_metadata_entity = app_entity.clone();
        let refresh_history_entity = app_entity.clone();
        let load_older_entity = app_entity.clone();
        let save_alias_entity = app_entity.clone();
        let remove_alias_entity = app_entity;

        let mut card = UserCard::new(
            user_card_platform(target.platform),
            target.platform_user_id.clone(),
            target.display_name.clone(),
        )
        .metadata_state(metadata_state_from_app_state(&state.user_card.metadata))
        .history_state(history_state_from_app_state(state))
        .body_scroll_handle(&self.user_card_scroll_handle);

        if let Some(username) = &target.username {
            card = card.username(username.clone());
        }
        if let Some(avatar_url) = &target.avatar_url {
            card = card.avatar_url(avatar_url.clone());
        }
        if let Some(current_alias) = &target.current_alias {
            card = card.current_alias(current_alias.clone());
        }

        let alias_platform = target.platform;
        let save_alias_user_id = target.platform_user_id.clone();
        let remove_alias_user_id = target.platform_user_id.clone();

        card = card
            .alias_input(self.user_card_alias_input.clone())
            .on_save_alias(move |alias, _window, app| {
                let user_id = save_alias_user_id.clone();
                save_alias_entity.update(app, |this, cx| {
                    this.save_user_alias(alias_platform, user_id, alias, cx);
                });
            })
            .on_remove_alias(move |_window, app| {
                let user_id = remove_alias_user_id.clone();
                remove_alias_entity.update(app, |this, cx| {
                    this.remove_user_alias(alias_platform, user_id, cx);
                });
            })
            .on_refresh_metadata(move |_window, app| {
                refresh_metadata_entity.update(app, |this, cx| {
                    this.refresh_user_card_metadata(cx);
                });
            })
            .on_refresh_history(move |_window, app| {
                refresh_history_entity.update(app, |this, cx| {
                    this.refresh_user_card_history(cx);
                });
            })
            .on_load_older(move |_window, app| {
                load_older_entity.update(app, |this, cx| {
                    this.load_older_user_card_history(cx);
                });
            });

        div()
            .id("user-card-modal-overlay")
            .absolute()
            .top(px(0.0))
            .right(px(0.0))
            .bottom(px(0.0))
            .left(px(0.0))
            .occlude()
            .bg(gpui::rgba(0x00000099))
            .p(px(24.0))
            .flex()
            .items_center()
            .justify_center()
            .on_scroll_wheel(|_event, _window, cx| {
                cx.stop_propagation();
            })
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .w_full()
                    .h_full()
                    .max_w(px(760.0))
                    .max_h(px(820.0))
                    .overflow_hidden()
                    .child(card)
                    .child(
                        div()
                            .id("user-card-close")
                            .absolute()
                            .top(px(12.0))
                            .right(px(12.0))
                            .cursor_pointer()
                            .rounded(px(14.0))
                            .bg(gpui::rgba(0x00000066))
                            .text_color(crate::ui::theme::text_primary())
                            .text_size(px(14.0))
                            .px(px(9.0))
                            .py(px(5.0))
                            .child("Close")
                            .on_click(move |_event, _window, app| {
                                close_entity.update(app, |this, cx| {
                                    this.close_user_card(cx);
                                });
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_tab_selector_modal(
        &self,
        state: &AppState,
        cx: &mut Context<Self>,
    ) -> impl gpui::IntoElement {
        let items = fuzzy_filter_tab_items(
            &content::tab_items(state),
            self.tab_selector_input.read(cx).text(),
        );
        let selected_index = self
            .tab_selector_selected_index
            .min(items.len().saturating_sub(1));

        div()
            .absolute()
            .top(px(0.0))
            .right(px(0.0))
            .bottom(px(0.0))
            .left(px(0.0))
            .bg(gpui::rgba(0x00000080))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .track_focus(&self.tab_selector_focus)
                    .w(px(400.0))
                    .max_w(px(640.0))
                    .max_h(px(360.0))
                    .bg(rgb(0x18181b))
                    .border_1()
                    .border_color(rgb(0x2a2a33))
                    .rounded_lg()
                    .shadow_md()
                    .overflow_hidden()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .px(px(16.0))
                            .py(px(12.0))
                            .border_b_1()
                            .border_color(rgb(0x2a2a33))
                            .flex()
                            .flex_col()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .text_color(crate::ui::theme::text_primary())
                                    .child("Switch to tab"),
                            )
                            .child(self.tab_selector_input.clone()),
                    )
                    .child(if items.is_empty() {
                        div()
                            .px(px(16.0))
                            .py(px(18.0))
                            .text_size(px(13.0))
                            .text_color(crate::ui::theme::text_muted())
                            .child("No tabs match the current query")
                            .into_any_element()
                    } else {
                        div()
                            .flex()
                            .flex_col()
                            .children(items.into_iter().enumerate().map(move |(index, item)| {
                                let is_selected = index == selected_index;
                                let is_active = item.id == state.active_channel_tab_id();

                                div()
                                    .cursor_pointer()
                                    .px(px(16.0))
                                    .py(px(10.0))
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .gap(px(8.0))
                                    .bg(if is_selected {
                                        gpui::rgba(0xa78bfa26)
                                    } else {
                                        gpui::rgba(0x00000000)
                                    })
                                    .text_color(crate::ui::theme::text_primary())
                                    .hover(|style| style.bg(crate::ui::theme::surface()))
                                    .on_mouse_down(gpui::MouseButton::Left, {
                                        let tab_id = item.id.clone();
                                        cx.listener(move |this, _event, _window, cx| {
                                            this.state.update(cx, |state, cx| {
                                                state.select_section(MainSection::Chat);
                                                state.select_channel_tab(tab_id.clone());
                                                cx.notify();
                                            });
                                            this.close_tab_selector(cx);
                                        })
                                    })
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(crate::ui::theme::text_muted())
                                            .child(match item.platform {
                                                Some(Platform::Twitch) => "[twitch]",
                                                Some(Platform::Youtube) => "[youtube]",
                                                Some(Platform::Kick) => "[kick]",
                                                None => "[home]",
                                            }),
                                    )
                                    .child(div().flex_1().child(item.label))
                                    .when(is_active, |el| {
                                        el.child(
                                            div()
                                                .text_size(px(11.0))
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(crate::ui::theme::accent())
                                                .child("active"),
                                        )
                                    })
                            }))
                            .into_any_element()
                    })
                    .child(
                        div()
                            .px(px(16.0))
                            .py(px(10.0))
                            .border_t_1()
                            .border_color(rgb(0x2a2a33))
                            .text_size(px(11.0))
                            .text_color(crate::ui::theme::text_muted())
                            .child("Up/Down to navigate, Enter to switch, Escape to close"),
                    ),
            )
    }
}

fn fuzzy_filter_tab_items(
    items: &[crate::ui::shell::tabs::TabItem],
    query: &str,
) -> Vec<crate::ui::shell::tabs::TabItem> {
    if query.is_empty() {
        return items.to_vec();
    }

    let query = query.to_ascii_lowercase();
    let Some(first_char) = query.chars().next() else {
        return items.to_vec();
    };

    let mut matches = items
        .iter()
        .filter_map(|item| {
            let label = item.label.to_ascii_lowercase();
            let mut query_chars = query.chars();
            let mut current = query_chars.next()?;

            for ch in label.chars() {
                if ch == current {
                    match query_chars.next() {
                        Some(next) => current = next,
                        None => {
                            let rank = label.find(first_char).unwrap_or(usize::MAX);
                            return Some((rank, item.clone()));
                        }
                    }
                }
            }

            None
        })
        .collect::<Vec<_>>();

    matches.sort_by_key(|(rank, item)| (*rank, item.label.to_ascii_lowercase()));
    matches.into_iter().map(|(_, item)| item).collect()
}

impl Render for TwirChatApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        self.drain_runtime_events(cx);
        self.flush_composer_submit(cx);
        self.flush_font_size_submit(cx);
        self.flush_watched_composer_submits(cx);
        self.flush_pending_watched_channel_adds(cx);
        self.flush_pending_watched_channel_messages(cx);
        self.flush_pending_watched_channel_removals(cx);
        self.flush_pending_backend_messages(cx);
        let state = self.state.read(cx).clone();
        self.sync_font_size_input(&state, window, cx);
        self.sync_watched_composer_inputs(&state, cx);
        let composer_text = self.composer_input.read(cx).text().to_string();
        let tab_selector_query = self.tab_selector_input.read(cx).text().to_string();
        let was_following_tail = self.chat_list_state.is_following_tail();
        self.chat_scroll_paused = !was_following_tail;

        if self.tab_selector_open && tab_selector_query != self.last_tab_selector_query {
            self.last_tab_selector_query = tab_selector_query;
            self.tab_selector_selected_index = 0;
        }

        if state.user_card.open {
            let generation = state.user_card.generation;
            if self.user_card_load_generation != Some(generation) {
                self.user_card_load_generation = Some(generation);
                let alias_text = state
                    .user_card
                    .target
                    .as_ref()
                    .and_then(|target| target.current_alias.clone())
                    .unwrap_or_default();
                self.user_card_alias_input
                    .update(cx, |input, cx| input.set_text(alias_text, cx));
                self.start_user_card_loads(cx);
            }
        } else {
            self.user_card_load_generation = None;
        }

        if state.messages.len() != self.last_chat_message_count {
            self.chat_list_state.reset(state.messages.len());
            if was_following_tail {
                self.chat_list_state.set_follow_mode(FollowMode::Tail);
            }
        }
        self.last_chat_message_count = state.messages.len();

        let active_mention = self.active_mention_autocomplete(&state, window, cx);
        let mut home_mention_autocomplete = None;
        let mut watched_mention_autocomplete = BTreeMap::new();
        if let Some(active) = active_mention {
            self.sync_mention_selection(&active);
            let selected_index = self
                .mention_selected_index
                .min(active.suggestions.len().saturating_sub(1));
            let autocomplete = MentionAutocompleteUi {
                suggestions: active.suggestions,
                selected_index,
            };
            match active.target {
                MentionComposerTarget::Home => home_mention_autocomplete = Some(autocomplete),
                MentionComposerTarget::Watched(channel_id) => {
                    watched_mention_autocomplete.insert(channel_id, autocomplete);
                }
            }
        } else {
            self.mention_last_context.clear();
            self.mention_selected_index = 0;
        }

        div()
            .image_cache(retain_all("twirchat-images"))
            .id("app-shell")
            .font(theme::app_font(state.settings().font_family))
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
                            font_size_input: self.font_size_input.clone(),
                            add_channel_input: self.add_channel_input.clone(),
                            watched_composer_inputs: self.watched_composer_inputs.clone(),
                            hotkey_capture_focus: self.hotkey_capture_focus.clone(),
                            composer_text,
                            home_mention_autocomplete,
                            watched_mention_autocomplete,
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
            .when(state.user_card.open, |el| {
                el.child(self.render_user_card_modal(&state, cx))
            })
            .when(self.tab_selector_open, |el| {
                el.child(self.render_tab_selector_modal(&state, cx))
            })
            .child(UpdateToast::new(self.state.clone(), cx.entity()))
    }
}
fn mention_context_id(target: &MentionComposerTarget, query: &str) -> String {
    match target {
        MentionComposerTarget::Home => format!("home:{query}"),
        MentionComposerTarget::Watched(channel_id) => format!("watched:{channel_id}:{query}"),
    }
}

fn mention_source_messages<'a>(
    state: &'a AppState,
    target: &MentionComposerTarget,
) -> Vec<&'a crate::protocol::types::NormalizedChatMessage> {
    match target {
        MentionComposerTarget::Home => state.messages.iter().rev().collect(),
        MentionComposerTarget::Watched(channel_id) => state
            .watched_channel_messages
            .get(channel_id)
            .map(|messages| messages.iter().rev().collect())
            .unwrap_or_else(|| {
                state
                    .watched_channels
                    .iter()
                    .find(|channel| channel.id == *channel_id)
                    .map(|channel| {
                        state
                            .messages
                            .iter()
                            .rev()
                            .filter(|message| {
                                message.platform == channel.platform
                                    && (message.channel_id == channel.id
                                        || message
                                            .channel_id
                                            .eq_ignore_ascii_case(&channel.channel_slug))
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            }),
    }
}

fn metadata_platform(platform: Platform) -> Option<UserCardMetadataPlatform> {
    match platform {
        Platform::Twitch => Some(UserCardMetadataPlatform::Twitch),
        Platform::Kick => Some(UserCardMetadataPlatform::Kick),
        Platform::Youtube => None,
    }
}

fn user_card_platform(platform: Platform) -> UiPlatform {
    match platform {
        Platform::Twitch => UiPlatform::Twitch,
        Platform::Youtube => UiPlatform::YouTube,
        Platform::Kick => UiPlatform::Kick,
    }
}

fn user_card_history_page_from_protocol(page: UserChatHistoryPage) -> UserCardHistoryPage {
    UserCardHistoryPage {
        messages: page.messages,
        has_more: page.has_more,
        next_cursor: page.next_cursor,
    }
}

pub fn metadata_state_from_app_state(
    state: &UserCardLoadState<UserCardMetadataResponse>,
) -> MetadataState {
    match state {
        UserCardLoadState::Idle => MetadataState::Unsupported,
        UserCardLoadState::Loading { .. } => MetadataState::Loading,
        UserCardLoadState::Error { error, .. } => MetadataState::Error(error.clone().into()),
        UserCardLoadState::Loaded { value, .. } => MetadataState::Loaded(UserCardMetadata {
            account_age: account_age_text(value).into(),
            follow_age: follow_age_text(value).into(),
            subscription_duration: subscription_duration_text(value).into(),
            sub_age: sub_age_text(value).into(),
        }),
    }
}

pub fn history_state_from_app_state(state: &AppState) -> HistoryState {
    match &state.user_card.history {
        UserCardLoadState::Idle => HistoryState::Empty,
        UserCardLoadState::Loading { .. } => HistoryState::LoadingInitial,
        UserCardLoadState::Error { error, .. } => HistoryState::Error(error.clone().into()),
        UserCardLoadState::Loaded { value, .. } if value.is_empty() => HistoryState::Empty,
        UserCardLoadState::Loaded { value, .. } => HistoryState::Loaded {
            messages: value
                .iter()
                .map(|message| HistoryMessage {
                    content: message.text.clone().into(),
                })
                .collect(),
            loading_older: state.user_card.loading_older,
            has_more: state.user_card.has_more,
        },
    }
}

pub fn account_age_text(metadata: &UserCardMetadataResponse) -> String {
    if let Some(created_at) = metadata.account_age.created_at.as_deref() {
        return format!("Created {}", created_at);
    }
    metadata_field_text(
        metadata.account_age.status,
        None,
        metadata.account_age.message.as_deref(),
    )
}

pub fn follow_age_text(metadata: &UserCardMetadataResponse) -> String {
    if let Some(followed_at) = metadata.follow_age.followed_at.as_deref() {
        if let Some(msg) = metadata.follow_age.message.as_deref() {
            return format!("Following since {} · {}", followed_at, msg);
        } else {
            return format!("Following since {}", followed_at);
        }
    }
    metadata_field_text(
        metadata.follow_age.status,
        None,
        metadata.follow_age.message.as_deref(),
    )
}

pub fn subscription_duration_text(metadata: &UserCardMetadataResponse) -> String {
    match metadata.subscription_duration.status {
        UserCardFieldStatus::Available => match metadata.subscription_duration.currently_subscribed
        {
            Some(true) => {
                let mut text = "Currently subscribed".to_string();
                if let Some(tier) = metadata.subscription_duration.tier.as_deref() {
                    text = format!("{} · Tier {}", text, tier);
                }
                if let Some(true) = metadata.subscription_duration.is_gift {
                    if let Some(gifter) = metadata
                        .subscription_duration
                        .gifter_display_name
                        .as_deref()
                    {
                        text = format!("{} · Gifted by {}", text, gifter);
                    } else {
                        text = format!("{} · Gifted", text);
                    }
                }
                if let Some(msg) = metadata.subscription_duration.message.as_deref() {
                    text = format!("{} · {}", text, msg);
                }
                text
            }
            Some(false) => {
                if let Some(msg) = metadata.subscription_duration.message.as_deref() {
                    msg.to_string()
                } else {
                    "Not currently subscribed".to_string()
                }
            }
            None => metadata
                .subscription_duration
                .message
                .clone()
                .unwrap_or_else(|| "Available".to_string()),
        },
        status => metadata_field_text(
            status,
            None,
            metadata.subscription_duration.message.as_deref(),
        ),
    }
}

pub fn sub_age_text(metadata: &UserCardMetadataResponse) -> String {
    if let Some(months) = metadata.sub_age.months {
        let suffix = if months == 1 { "month" } else { "months" };
        let mut text = format!("{} {}", months, suffix);
        if let Some(msg) = metadata.sub_age.message.as_deref() {
            text = format!("{} · {}", text, msg);
        }
        return text;
    }

    metadata_field_text(
        metadata.sub_age.status,
        None,
        metadata.sub_age.message.as_deref(),
    )
}

pub(crate) fn metadata_field_text(
    status: UserCardFieldStatus,
    value: Option<&str>,
    message: Option<&str>,
) -> String {
    message
        .or(value)
        .map(str::to_string)
        .unwrap_or_else(|| metadata_status_text(status).to_string())
}

fn metadata_status_text(status: UserCardFieldStatus) -> &'static str {
    match status {
        UserCardFieldStatus::Available => "Available",
        UserCardFieldStatus::Unavailable => "Unavailable",
        UserCardFieldStatus::Unsupported => "Unsupported",
        UserCardFieldStatus::MissingPermission => "Missing permission",
    }
}
