use crate::app_state::{AppState, AppStateActions, OutgoingChatMessageStatus};
use crate::chat::apply_alias;
use crate::protocol::types::{
    Account, AppSettings, ChatMessageType, ChatTheme, Emote, FontFamilyChoice,
    NormalizedChatMessage, Platform, PlatformStatus, SelfPingConfig,
};
use crate::ui::components::autocomplete_popup::{AutocompletePopup, AutocompleteSuggestion};
use crate::ui::components::emote_tooltip;
use crate::ui::components::input::Input;
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::components::selectable_message::{SelectableMessage, SelectableMessagePart};
use crate::ui::components::slider::Slider;
use crate::ui::components::switch::Switch;
use crate::ui::shared::{format_compact_viewers, format_exact_viewers};
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{
    AnyElement, App, ClipboardItem, Context, Div, Entity, Focusable, FollowMode, ImageSource,
    ListSizingBehavior, ListState, ObjectFit, Render, Stateful, Window, div, img, list, prelude::*,
    px, relative, rgb, rgba,
};
use std::path::Path;
use ui::WithScrollbar;
use url::Url;

fn parse_timestamp(ts: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return Some(dt.with_timezone(&chrono::Utc));
    }

    if let Ok(num) = ts.parse::<i64>() {
        let timestamp = if num >= 20000000000 { num / 1000 } else { num };

        if let Some(dt) = chrono::DateTime::from_timestamp(timestamp, 0) {
            return Some(dt.with_timezone(&chrono::Utc));
        }
    }

    None
}

fn format_timestamp(ts: &str) -> String {
    if let Some(dt) = parse_timestamp(ts) {
        dt.with_timezone(&chrono::Local)
            .format("%H:%M:%S")
            .to_string()
    } else {
        ts.to_string()
    }
}

pub(crate) struct ChatScrollUi<'a> {
    pub list_state: &'a ListState,
    pub paused: bool,
}

#[derive(Clone)]
pub(crate) struct AutocompleteUi {
    pub suggestions: Vec<AutocompleteSuggestion>,
    pub selected_index: usize,
}
pub(crate) struct ChatPanelProps<'a> {
    pub state_entity: Entity<AppState>,
    pub composer_input: Entity<Input>,
    pub font_size_input: Entity<Input>,
    pub composer_text: String,
    pub autocomplete: Option<AutocompleteUi>,
    pub scroll_ui: ChatScrollUi<'a>,
}

pub(crate) const CHAT_FONT_SIZE_MIN: f64 = 10.0;
pub(crate) const CHAT_FONT_SIZE_MAX: f64 = 30.0;
pub(crate) const CHAT_FONT_SIZE_STEP: f64 = 1.0;

pub(crate) fn panel(
    state: &AppState,
    props: ChatPanelProps<'_>,
    window: &mut Window,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    let settings = state.settings().clone();
    let accounts = state.platforms_panel.accounts.clone();
    let messages = state.messages.clone();

    div()
        .relative()
        .flex_1()
        .min_w(px(0.0))
        .min_h(px(0.0))
        .flex()
        .flex_col()
        .bg(theme::background())
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .min_h(px(0.0))
                .mt(px(40.0))
                .vertical_scrollbar_for(props.scroll_ui.list_state, window, cx)
                .child({
                    let state_entity = props.state_entity.clone();
                    let composer_input = props.composer_input.clone();
                    list(props.scroll_ui.list_state.clone(), move |ix, window, cx| {
                        outgoing_message_row(
                            &messages[ix],
                            &settings,
                            &accounts,
                            window,
                            cx,
                            MessageRowContext::home(
                                state_entity.clone(),
                                Some(composer_input.clone()),
                            ),
                        )
                        .into_any_element()
                    })
                    .with_sizing_behavior(ListSizingBehavior::Auto)
                    .size_full()
                }),
        )
        .child(composer(
            state,
            props.state_entity.clone(),
            props.composer_input,
            props.composer_text,
            props.autocomplete,
            cx.entity(),
        ))
        .when(props.scroll_ui.paused, |el| {
            let list_state = props.scroll_ui.list_state.clone();
            el.child(
                div()
                    .absolute()
                    .right(px(16.0))
                    .bottom(px(132.0))
                    .rounded_lg()
                    .px(px(10.0))
                    .py(px(6.0))
                    .bg(rgb(0x18181b))
                    .border_1()
                    .border_color(rgb(0x3f3f46))
                    .text_size(px(12.0))
                    .text_color(theme::text_primary())
                    .cursor_pointer()
                    .on_mouse_down(gpui::MouseButton::Left, move |_event, _window, _cx| {
                        list_state.scroll_to_end();
                        list_state.set_follow_mode(FollowMode::Tail);
                    })
                    .child("scroll paused"),
            )
        })
        .child(
            div()
                .absolute()
                .top(px(0.0))
                .left(px(0.0))
                .right(px(0.0))
                .child(header(
                    state.messages.len(),
                    state,
                    props.state_entity.clone(),
                    props.font_size_input,
                )),
        )
}

fn header(
    message_count: usize,
    state: &AppState,
    state_entity: Entity<AppState>,
    font_size_input: Entity<Input>,
) -> Div {
    let message_count_text = format!("{} messages", message_count);
    let home_targets = stream_status_header_targets(state);

    div()
        .w_full()
        .min_h(px(40.0))
        .border_b_1()
        .border_color(theme::border())
        .px(px(16.0))
        .py(px(6.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .text_color(theme::text_muted())
                .text_size(px(13.0))
                .font_weight(gpui::FontWeight::BOLD)
                .child("LIVE CHAT"),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_row()
                .items_center()
                .gap(px(6.0))
                .overflow_x_hidden()
                .children(home_targets.iter().map(header_chip)),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .text_size(px(11.0))
                        .mr(px(8.0))
                        .child(message_count_text),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(2.0))
                        .child(
                            div()
                                .relative()
                                .child(
                                    panel_action_btn("⚙", true)
                                        .bg(
                                            if state.chat_appearance_popover_open.as_deref()
                                                == Some("home")
                                            {
                                                gpui::rgba(0x2a2a33ff)
                                            } else {
                                                gpui::rgba(0x00000000)
                                            },
                                        )
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, cx| {
                                                eprintln!("[ui/chat] appearance popover clicked");
                                                state_entity.update(cx, |state, cx| {
                                                    state.toggle_chat_appearance_popover("home");
                                                    cx.notify();
                                                });
                                            }
                                        }),
                                )
                                .when(
                                    state.chat_appearance_popover_open.as_deref() == Some("home"),
                                    |el| {
                                        el.child(render_appearance_popover(
                                            state_entity.clone(),
                                            font_size_input.clone(),
                                            state.settings().clone(),
                                        ))
                                    },
                                ),
                        )
                        .child(
                            div()
                                .relative()
                                .child(
                                    panel_action_btn("⋮", true)
                                        .bg(if state.chat_options_menu_open {
                                            gpui::rgba(0x2a2a33ff)
                                        } else {
                                            gpui::rgba(0x00000000)
                                        })
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, cx| {
                                                eprintln!("[ui/chat] options menu clicked");
                                                state_entity.update(cx, |state, cx| {
                                                    state.toggle_chat_options_menu();
                                                    cx.notify();
                                                });
                                            }
                                        }),
                                )
                                .when(state.chat_options_menu_open, |el| {
                                    el.child(
                                        div()
                                            .absolute()
                                            .top(px(32.0))
                                            .right(px(0.0))
                                            .w(px(200.0))
                                            .bg(theme::surface())
                                            .border_1()
                                            .border_color(theme::border())
                                            .rounded_lg()
                                            .shadow_md()
                                            .p(px(4.0))
                                            .child(popover_btn("Clear chat history", {
                                                let state_entity = state_entity.clone();
                                                move |_event, _window, cx| {
                                                    state_entity.update(cx, |state, cx| {
                                                        state.toggle_chat_options_menu();
                                                        state.messages.clear();
                                                        cx.notify();
                                                    });
                                                }
                                            })),
                                    )
                                }),
                        ),
                ),
        )
}

fn panel_action_btn(icon: &'static str, active: bool) -> Stateful<Div> {
    let base = div()
        .id(icon)
        .w(px(26.0))
        .h(px(26.0))
        .rounded_md()
        .flex()
        .items_center()
        .justify_center();

    if active {
        base.text_color(theme::text_muted())
            .cursor_pointer()
            .hover(|s| s.bg(rgb(0x2a2a33)).text_color(theme::text_primary()))
            .child(icon)
    } else {
        base.text_color(rgba(0xffffff26)).child(icon)
    }
}

fn composer(
    state: &AppState,
    state_entity: Entity<AppState>,
    composer_input: Entity<Input>,
    composer_text: String,
    autocomplete: Option<AutocompleteUi>,
    app_entity: Entity<TwirChatApp>,
) -> Div {
    let home_targets = home_chat_targets(state);
    let can_send = !composer_text.trim().is_empty()
        && home_targets
            .iter()
            .any(|channel| !state.composer_disabled_channel_ids.contains(&channel.id));
    let reply_target = state.home_reply_target().cloned();

    div()
        .w_full()
        .h(px(if reply_target.is_some() { 132.0 } else { 104.0 }))
        .min_h(px(82.0))
        .relative()
        .child(
            div()
                .absolute()
                .size_full()
                .bg(theme::surface())
                .border_t_1()
                .border_color(theme::border()),
        )
        .child(
            div()
                .size_full()
                .pt(px(6.0))
                .px(px(12.0))
                .pb(px(8.0))
                .flex()
                .flex_col()
                .gap(px(6.0))
                .when_some(reply_target, |body, target| {
                    body.child(composer_reply_bar(
                        &target,
                        "home-reply-target-cancel".to_string(),
                        {
                            let state_entity = state_entity.clone();
                            move |_event, _window, cx| {
                                state_entity.update(cx, |state, cx| {
                                    state.cancel_home_reply_target();
                                    cx.notify();
                                });
                            }
                        },
                    ))
                })
                .child(div().flex().flex_row().flex_wrap().gap(px(6.0)).children(
                    home_targets.iter().map({
                        let state_entity = state_entity.clone();
                        move |chip| {
                            let enabled = !state.composer_disabled_channel_ids.contains(&chip.id);
                            status_chip(chip, enabled, state_entity.clone())
                        }
                    }),
                ))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .min_w(px(0.0))
                        .items_end()
                        .gap(px(8.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .max_h(px(120.0))
                                .rounded_lg()
                                .bg(theme::surface_2())
                                .border_1()
                                .border_color(theme::border())
                                .relative()
                                .flex()
                                .items_center()
                                .child(composer_input.clone())
                                .when_some(autocomplete, |input_box, autocomplete| {
                                    input_box.child(
                                        AutocompletePopup::new(
                                            autocomplete.suggestions,
                                            autocomplete.selected_index,
                                        )
                                        .on_select({
                                            let app_entity = app_entity.clone();
                                            move |index, window, app| {
                                                app_entity.update(app, |this, cx| {
                                                    this.select_autocomplete_suggestion(
                                                        index, window, cx,
                                                    );
                                                });
                                            }
                                        }),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .w(px(32.0))
                                .h(px(32.0))
                                .rounded_lg()
                                .text_color(theme::text_muted())
                                .flex()
                                .items_center()
                                .justify_center()
                                .hover(|s| s.bg(rgb(0x2a2a33)).text_color(theme::text_primary()))
                                .child("☺"),
                        )
                        .child(
                            div()
                                .w(px(36.0))
                                .h(px(36.0))
                                .rounded_lg()
                                .bg(if can_send {
                                    theme::accent_strong()
                                } else {
                                    theme::surface_2()
                                })
                                .text_color(if can_send {
                                    theme::text_primary()
                                } else {
                                    theme::text_muted()
                                })
                                .flex()
                                .items_center()
                                .justify_center()
                                .when(can_send, |button| {
                                    button.cursor_pointer().hover(|s| s.bg(rgb(0x6d28d9)))
                                })
                                .child("➤")
                                .on_mouse_down(gpui::MouseButton::Left, {
                                    let state_entity = state_entity.clone();
                                    let composer_input = composer_input.clone();
                                    move |_, _, app| {
                                        let text = composer_input.read(app).text().to_string();
                                        if state_entity.queue_composer_send(app, &text) {
                                            composer_input.update(app, |input, cx| input.clear(cx));
                                        }
                                    }
                                }),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .justify_between()
                        .text_size(px(11.0))
                        .text_color(theme::text_muted())
                        .child("Enter ↵ to send")
                        .child("Shift+Enter for newline"),
                ),
        )
}

pub(crate) fn composer_reply_bar(
    target: &NormalizedChatMessage,
    cancel_id: String,
    on_cancel: impl Fn(&gpui::MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> Stateful<Div> {
    div()
        .id("composer-reply-target")
        .w_full()
        .min_h(px(24.0))
        .rounded_md()
        .bg(rgba(0xa78bfa1f))
        .border_1()
        .border_color(rgba(0xa78bfa55))
        .px(px(8.0))
        .py(px(4.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(6.0))
        .text_size(px(11.0))
        .text_color(theme::text_muted())
        .child("↩")
        .child(
            div()
                .min_w(px(0.0))
                .flex_1()
                .overflow_hidden()
                .child(format!(
                    "Replying to {}: {}",
                    target.author.display_name,
                    trimmed_reply_text(&target.text)
                )),
        )
        .child(
            div()
                .id(cancel_id)
                .rounded_sm()
                .px(px(6.0))
                .py(px(2.0))
                .text_color(theme::text_muted())
                .cursor_pointer()
                .hover(|s| s.bg(theme::surface()).text_color(theme::text_primary()))
                .child("×")
                .on_mouse_down(gpui::MouseButton::Left, on_cancel),
        )
}

fn trimmed_reply_text(text: &str) -> String {
    if text.chars().count() > 72 {
        format!("{}…", text.chars().take(72).collect::<String>())
    } else {
        text.to_string()
    }
}

fn status_chip(
    chip: &HomeChatTarget,
    active: bool,
    state_entity: Entity<AppState>,
) -> impl IntoElement {
    let color = theme::platform_color(to_model_platform(chip.platform));
    let foreground = if chip.platform == Platform::Kick {
        theme::text_primary()
    } else {
        color
    };
    let channel_id = chip.id.clone();

    div()
        .id(format!("composer-chip-{channel_id}"))
        .rounded_full()
        .px(px(9.0))
        .py(px(3.0))
        .bg(if active {
            rgb(0x1c1b22) // Should be color-mix, but prototyping for now
        } else {
            theme::surface_2()
        })
        .border_1()
        .border_color(if active { color } else { theme::border() })
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .text_color(if active {
            foreground
        } else {
            theme::text_muted()
        })
        .cursor_pointer()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(5.0))
        .on_click(move |_event, _window, cx| {
            state_entity.toggle_composer_channel(cx, &channel_id);
        })
        .child(
            div().text_color(foreground).child(
                PlatformIcon::new(to_model_platform(chip.platform))
                    .size(px(13.0))
                    .color(foreground),
            ),
        )
        .child(div().whitespace_nowrap().child(chip.display_name.clone()))
}

fn header_chip(chip: &HomeChatTarget) -> impl IntoElement {
    let is_live = chip.is_live;
    let color = theme::platform_color(to_model_platform(chip.platform));
    let tooltip_chip = chip.clone();

    div()
        .id(format!("home-header-chip-{}", chip.id))
        .rounded_full()
        .px(px(8.0))
        .py(px(3.0))
        .bg(theme::surface_2())
        .border_1()
        .border_color(if is_live { color } else { theme::border() })
        .text_color(if is_live {
            theme::text_primary()
        } else {
            theme::text_muted()
        })
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .flex()
        .flex_row()
        .items_center()
        .gap(px(5.0))
        .child(div().w(px(6.0)).h(px(6.0)).rounded_full().bg(if is_live {
            color
        } else {
            rgb(0x666666)
        }))
        .child(
            div()
                .max_w(px(100.0))
                .overflow_hidden()
                .child(chip.channel_login.clone()),
        )
        .when_some(
            chip.viewer_count.filter(|_| is_live),
            |chip, viewer_count| {
                chip.child(
                    div()
                        .px(px(5.0))
                        .py(px(1.0))
                        .rounded_full()
                        .bg(rgba(0xffffff14))
                        .text_color(theme::text_primary())
                        .text_size(px(10.0))
                        .child(format_compact_viewers(viewer_count)),
                )
            },
        )
        .tooltip(move |_window, cx| {
            cx.new(|_| HomeChipTooltip {
                chip: tooltip_chip.clone(),
            })
            .into()
        })
}

struct HomeChipTooltip {
    chip: HomeChatTarget,
}

impl Render for HomeChipTooltip {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        header_chip_tooltip(&self.chip)
    }
}

fn header_chip_tooltip(chip: &HomeChatTarget) -> Div {
    let color = theme::platform_color(to_model_platform(chip.platform));
    div()
        .min_w(px(190.0))
        .max_w(px(270.0))
        .rounded_lg()
        .border_1()
        .border_color(theme::border())
        .bg(theme::surface())
        .shadow_lg()
        .p(px(10.0))
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .justify_between()
                .gap(px(16.0))
                .child(
                    div()
                        .text_color(color)
                        .text_size(px(11.0))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .child(platform_label(chip.platform)),
                )
                .child(
                    div()
                        .text_color(if chip.is_live {
                            rgb(0x4ade80)
                        } else {
                            theme::text_muted()
                        })
                        .text_size(px(10.0))
                        .font_weight(gpui::FontWeight::BOLD)
                        .child(if chip.is_live { "LIVE" } else { "Offline" }),
                ),
        )
        .when(!chip.title.is_empty(), |tooltip| {
            tooltip.child(
                div()
                    .text_color(theme::text_primary())
                    .text_size(px(13.0))
                    .line_height(relative(1.4))
                    .child(chip.title.clone()),
            )
        })
        .when_some(chip.category_name.clone(), |tooltip, category_name| {
            tooltip.child(header_chip_tooltip_row("Category", category_name))
        })
        .when_some(
            chip.viewer_count.filter(|_| chip.is_live),
            |tooltip, viewer_count| {
                tooltip.child(header_chip_tooltip_row(
                    "Viewers",
                    format_exact_viewers(viewer_count),
                ))
            },
        )
}

fn header_chip_tooltip_row(label: &'static str, value: String) -> Div {
    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(6.0))
        .text_size(px(11.0))
        .text_color(theme::text_muted())
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child(label),
        )
        .child(value)
}

#[derive(Clone)]
struct HomeChatTarget {
    id: String,
    platform: Platform,
    channel_login: String,
    display_name: String,
    is_live: bool,
    title: String,
    category_name: Option<String>,
    viewer_count: Option<u64>,
}

fn home_chat_targets(state: &AppState) -> Vec<HomeChatTarget> {
    let mut targets = Vec::new();

    for status in state.platforms_panel.statuses.values() {
        let Some(channel_login) = status.channel_login.as_ref() else {
            continue;
        };
        if !matches!(
            status.status,
            PlatformStatus::Connected | PlatformStatus::Connecting
        ) {
            continue;
        }

        let display_name = state
            .platforms_panel
            .accounts
            .iter()
            .find(|account| {
                account.platform == status.platform
                    && account.username.eq_ignore_ascii_case(channel_login)
            })
            .map(|account| account.display_name.clone())
            .unwrap_or_else(|| channel_login.clone());

        let stream_status = state.home_channel_status(status.platform, channel_login);

        targets.push(HomeChatTarget {
            id: format!("{:?}:{}", status.platform, channel_login.to_lowercase()),
            platform: status.platform,
            channel_login: channel_login.clone(),
            display_name,
            is_live: stream_status.is_some_and(|status| status.is_live),
            title: stream_status
                .map(|status| status.title.clone())
                .unwrap_or_default(),
            category_name: stream_status.and_then(|status| status.category_name.clone()),
            viewer_count: stream_status.and_then(|status| status.viewer_count),
        });
    }

    targets
}

fn stream_status_header_targets(state: &AppState) -> Vec<HomeChatTarget> {
    home_chat_targets(state)
        .into_iter()
        .filter(|target| matches!(target.platform, Platform::Twitch | Platform::Kick))
        .collect()
}

pub(crate) fn add_channel_modal(
    state: &AppState,
    state_entity: Entity<AppState>,
    add_channel_input: Entity<Input>,
) -> Div {
    let active_platform = state.add_channel_platform;
    let youtube_authenticated = state.is_youtube_authenticated();

    div()
        .absolute()
        .top(px(0.0))
        .left(px(0.0))
        .right(px(0.0))
        .bottom(px(0.0))
        .bg(rgba(0x00000099))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(320.0))
                .rounded_xl()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .shadow_lg()
                .p(px(20.0))
                .flex()
                .flex_col()
                .gap(px(14.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(gpui::FontWeight::BOLD)
                                .text_color(theme::text_primary())
                                .child("Add Channel"),
                        )
                        .child(
                            div()
                                .p(px(4.0))
                                .rounded_sm()
                                .cursor_pointer()
                                .text_color(theme::text_muted())
                                .hover(|s| s.text_color(theme::text_primary()))
                                .child("×")
                                .on_mouse_down(gpui::MouseButton::Left, {
                                    let state_entity = state_entity.clone();
                                    let add_channel_input = add_channel_input.clone();
                                    move |_, _, app| {
                                        add_channel_input.update(app, |input, cx| {
                                            input.clear(cx);
                                            input.set_placeholder("Twitch channel name", cx);
                                        });
                                        state_entity.close_add_channel_modal(app);
                                    }
                                }),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .gap(px(8.0))
                        .child(add_channel_platform_button(
                            Platform::Twitch,
                            active_platform,
                            true,
                            state_entity.clone(),
                            add_channel_input.clone(),
                        ))
                        .child(add_channel_platform_button(
                            Platform::Kick,
                            active_platform,
                            true,
                            state_entity.clone(),
                            add_channel_input.clone(),
                        ))
                        .child(add_channel_platform_button(
                            Platform::Youtube,
                            active_platform,
                            youtube_authenticated,
                            state_entity.clone(),
                            add_channel_input.clone(),
                        )),
                )
                .child(add_channel_input.clone())
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.0))
                        .child(
                            div()
                                .px(px(14.0))
                                .py(px(7.0))
                                .rounded_md()
                                .border_1()
                                .border_color(rgba(0xffffff1a))
                                .text_color(theme::text_muted())
                                .text_size(px(13.0))
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgba(0xffffff0f)).text_color(theme::text_primary()))
                                .child("Cancel")
                                .on_mouse_down(gpui::MouseButton::Left, {
                                    let state_entity = state_entity.clone();
                                    let add_channel_input = add_channel_input.clone();
                                    move |_, _, app| {
                                        add_channel_input.update(app, |input, cx| {
                                            input.clear(cx);
                                            input.set_placeholder("Twitch channel name", cx);
                                        });
                                        state_entity.close_add_channel_modal(app);
                                    }
                                }),
                        )
                        .child(
                            div()
                                .px(px(16.0))
                                .py(px(7.0))
                                .rounded_md()
                                .bg(rgb(0x7c3aed))
                                .text_color(rgb(0xffffff))
                                .text_size(px(13.0))
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(0x6d28d9)))
                                .child("Add")
                                .on_mouse_down(gpui::MouseButton::Left, {
                                    let state_entity = state_entity.clone();
                                    let add_channel_input = add_channel_input.clone();
                                    move |_, _, app| {
                                        let channel_slug = add_channel_input
                                            .read(app)
                                            .text()
                                            .trim()
                                            .to_lowercase();
                                        if channel_slug.is_empty() {
                                            return;
                                        }
                                        state_entity.submit_add_channel_modal(
                                            app,
                                            active_platform,
                                            &channel_slug,
                                        );
                                        add_channel_input.update(app, |input, cx| {
                                            input.clear(cx);
                                            input.set_placeholder("Twitch channel name", cx);
                                        });
                                    }
                                }),
                        ),
                ),
        )
}

fn add_channel_platform_button(
    platform: Platform,
    active_platform: Platform,
    enabled: bool,
    state_entity: Entity<AppState>,
    add_channel_input: Entity<Input>,
) -> Div {
    let active = platform == active_platform;
    let color = theme::platform_color(to_model_platform(platform));

    div()
        .flex_1()
        .px(px(12.0))
        .py(px(7.0))
        .rounded_md()
        .border_1()
        .border_color(if active { color } else { rgba(0xffffff1a) })
        .bg(if active {
            rgba(0x7c3aed26)
        } else {
            rgba(0xffffff0a)
        })
        .text_color(if active { color } else { theme::text_muted() })
        .text_size(px(13.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .flex()
        .items_center()
        .justify_center()
        .gap(px(6.0))
        .when(enabled, |button| button.cursor_pointer())
        .when(!enabled, |button| button.opacity(0.35))
        .child(
            PlatformIcon::new(to_model_platform(platform))
                .size(px(14.0))
                .color(if active { color } else { theme::text_muted() }),
        )
        .child(platform_label(platform))
        .when(platform == Platform::Youtube && !enabled, |button| {
            button.child("⌕")
        })
        .on_mouse_down(gpui::MouseButton::Left, move |_, _, app| {
            if !enabled {
                return;
            }
            state_entity.select_add_channel_platform(app, platform);
            add_channel_input.update(app, |input, cx| {
                input.set_placeholder(add_channel_placeholder(platform), cx)
            });
        })
}

fn platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "Twitch",
        Platform::Youtube => "YouTube",
        Platform::Kick => "Kick",
    }
}

fn add_channel_placeholder(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "Twitch channel name",
        Platform::Youtube => "YouTube channel handle or ID",
        Platform::Kick => "Kick channel name",
    }
}

#[derive(Clone, Copy)]
pub(crate) struct MessageRowOptions {
    surface_scope: &'static str,
    use_account_avatar_fallback: bool,
    use_author_fallback: bool,
}

#[derive(Clone)]
pub(crate) struct MessageRowContext {
    state_entity: Entity<AppState>,
    reply_focus_input: Option<Entity<Input>>,
    options: MessageRowOptions,
}

impl MessageRowContext {
    pub(crate) fn home(
        state_entity: Entity<AppState>,
        reply_focus_input: Option<Entity<Input>>,
    ) -> Self {
        Self {
            state_entity,
            reply_focus_input,
            options: MessageRowOptions::home(),
        }
    }

    pub(crate) fn watched(
        state_entity: Entity<AppState>,
        reply_focus_input: Option<Entity<Input>>,
    ) -> Self {
        Self {
            state_entity,
            reply_focus_input,
            options: MessageRowOptions::watched(),
        }
    }
}

impl MessageRowOptions {
    pub(crate) const fn home() -> Self {
        Self {
            surface_scope: "home",
            use_account_avatar_fallback: true,
            use_author_fallback: true,
        }
    }

    pub(crate) const fn watched() -> Self {
        Self {
            surface_scope: "watched",
            use_account_avatar_fallback: false,
            use_author_fallback: false,
        }
    }

    fn message_row_id(self, message_id: &str) -> String {
        format!("{}-message-row-{}", self.surface_scope, message_id)
    }

    fn selectable_key(self, message_id: &str) -> String {
        format!("{}-message-{}", self.surface_scope, message_id)
    }

    fn avatar_id(self, message_id: &str) -> String {
        format!("{}-avatar-{}", self.surface_scope, message_id)
    }

    fn badge_id(self, message_id: &str, badge_id: &str, index: usize) -> String {
        format!(
            "{}-badge-{}-{}-{}",
            self.surface_scope, message_id, badge_id, index
        )
    }
}

struct RowMessages {
    display: NormalizedChatMessage,
    target: NormalizedChatMessage,
}

#[derive(Clone, Copy)]
struct MessageTypography {
    font_size: f32,
    font_family: FontFamilyChoice,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SystemMessageAction {
    Added,
    Removed,
    Updated,
    Neutral,
}

struct SystemMessageRenderParts {
    action: SystemMessageAction,
    text_parts: Vec<SelectableMessagePart>,
}

fn system_message_action(text: &str) -> SystemMessageAction {
    if text.contains(" added ") {
        SystemMessageAction::Added
    } else if text.contains(" removed ") {
        SystemMessageAction::Removed
    } else if text.contains(" updated ") {
        SystemMessageAction::Updated
    } else {
        SystemMessageAction::Neutral
    }
}

fn system_action_icon(action: SystemMessageAction) -> &'static str {
    match action {
        SystemMessageAction::Added => "+",
        SystemMessageAction::Removed => "−",
        SystemMessageAction::Updated | SystemMessageAction::Neutral => "~",
    }
}

fn system_message_render_parts(message: &NormalizedChatMessage) -> SystemMessageRenderParts {
    let preview_emote = message
        .emotes
        .iter()
        .find(|emote| emote.positions.is_empty())
        .cloned();

    let Some(preview_emote) = preview_emote else {
        return SystemMessageRenderParts {
            action: system_message_action(&message.text),
            text_parts: vec![SelectableMessagePart::Text {
                text: message.text.clone().into(),
                source_range: 0..message.text.len(),
                is_link: false,
            }],
        };
    };

    let alias_start = message.text.find(&preview_emote.name);
    let mut text_parts = Vec::new();

    if let Some(start) = alias_start {
        if start > 0
            && let Some(prefix) = message.text.get(0..start)
        {
            text_parts.push(SelectableMessagePart::Text {
                text: prefix.to_string().into(),
                source_range: 0..start,
                is_link: false,
            });
        }

        text_parts.push(preview_emote_part(message, preview_emote, 0));

        if let Some(rest) = message.text.get(start..message.text.len()) {
            text_parts.push(SelectableMessagePart::Text {
                text: rest.to_string().into(),
                source_range: start..message.text.len(),
                is_link: false,
            });
        }
    } else {
        text_parts.push(SelectableMessagePart::Text {
            text: message.text.clone().into(),
            source_range: 0..message.text.len(),
            is_link: false,
        });
        text_parts.push(preview_emote_part(message, preview_emote, 0));
    }

    SystemMessageRenderParts {
        action: system_message_action(&message.text),
        text_parts,
    }
}

fn preview_emote_part(
    message: &NormalizedChatMessage,
    emote: Emote,
    part_index: usize,
) -> SelectableMessagePart {
    let message_id = message.id.clone();
    SelectableMessagePart::Custom(std::sync::Arc::new(move |window, cx| {
        let size = 24.0;
        let element_id = format!("sys-emote-{message_id}-{}-{part_index}", emote.id);
        div()
            .id(format!(
                "sys-emote-tooltip-target-{message_id}-{}-{part_index}",
                emote.id
            ))
            .mx(px(2.0))
            .h(px(size))
            .min_w(px(size))
            .max_w(px(size * emote.aspect_ratio.unwrap_or(1.0) as f32))
            .hoverable_tooltip(emote_tooltip(emote.clone(), element_id.clone()))
            .child(crate::ui::components::animated_emote(
                element_id,
                emote.image_url.clone(),
                emote.name.clone(),
                window,
                cx,
            ))
            .into_any_element()
    }))
}

impl MessageTypography {
    fn from_settings(settings: &AppSettings) -> Self {
        Self {
            font_size: settings.font_size as f32,
            font_family: settings.font_family,
        }
    }

    fn author_font_size(self) -> f32 {
        self.font_size
    }

    fn badge_size(self) -> f32 {
        self.font_size
    }

    fn text_badge_font_size(self) -> f32 {
        self.font_size * 0.72
    }

    fn platform_icon_size(self) -> f32 {
        self.font_size
    }
}

fn author_label_text(message: &NormalizedChatMessage, use_fallback: bool) -> String {
    let display_name = message.author.display_name.trim();
    if !display_name.is_empty() {
        return display_name.to_string();
    }

    if use_fallback {
        if let Some(username) = &message.author.username {
            let username = username.trim();
            if !username.is_empty() {
                return username.to_string();
            }
        }

        return message.author.id.clone();
    }

    display_name.to_string()
}

fn author_name_color(message: &NormalizedChatMessage) -> gpui::Rgba {
    if let Some(hex) = message
        .author
        .color
        .as_deref()
        .and_then(|color| color.strip_prefix('#'))
        .filter(|hex| hex.len() == 6)
        && let Ok(value) = u32::from_str_radix(hex, 16)
    {
        return rgb(value);
    }

    theme::accent()
}

fn shows_reply_preview(message: &NormalizedChatMessage) -> bool {
    matches!(message.platform, Platform::Twitch | Platform::Kick) && message.reply.is_some()
}

fn is_self_ping_message(
    message: &NormalizedChatMessage,
    settings: &AppSettings,
    accounts: &[Account],
) -> bool {
    let Some(self_ping) = settings.self_ping.as_ref().filter(|config| config.enabled) else {
        return false;
    };
    if !matches!(message.platform, Platform::Twitch | Platform::Kick) {
        return false;
    }
    if self_ping.color.trim().is_empty() {
        return false;
    }

    let Some(account) = accounts
        .iter()
        .find(|account| account.platform == message.platform)
    else {
        return false;
    };

    message
        .text
        .split(|ch: char| !is_mention_token_char(ch) && ch != '@')
        .filter_map(|token| token.strip_prefix('@'))
        .any(|mention| {
            !mention.is_empty()
                && (mention.eq_ignore_ascii_case(&account.username)
                    || mention.eq_ignore_ascii_case(&account.display_name))
        })
}

fn is_mention_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn self_ping_row_background(settings: &AppSettings) -> Option<gpui::Rgba> {
    settings
        .self_ping
        .as_ref()
        .filter(|config| config.enabled)
        .and_then(parse_self_ping_color)
}

fn parse_self_ping_color(config: &SelfPingConfig) -> Option<gpui::Rgba> {
    let value = config.color.trim();
    if let Some(hex) = value.strip_prefix('#') {
        return parse_hex_color(hex);
    }
    parse_rgba_color(value)
}

fn parse_hex_color(hex: &str) -> Option<gpui::Rgba> {
    let value = u32::from_str_radix(hex, 16).ok()?;
    match hex.len() {
        6 => Some(rgb(value)),
        8 => {
            let r = ((value >> 24) & 0xff) as f32 / 255.0;
            let g = ((value >> 16) & 0xff) as f32 / 255.0;
            let b = ((value >> 8) & 0xff) as f32 / 255.0;
            let a = (value & 0xff) as f32 / 255.0;
            Some(gpui::Rgba { r, g, b, a })
        }
        _ => None,
    }
}

fn parse_rgba_color(value: &str) -> Option<gpui::Rgba> {
    let inner = value
        .strip_prefix("rgba(")
        .and_then(|value| value.strip_suffix(')'))?;
    let mut parts = inner.split(',').map(str::trim);
    let r = parts.next()?.parse::<f32>().ok()? / 255.0;
    let g = parts.next()?.parse::<f32>().ok()? / 255.0;
    let b = parts.next()?.parse::<f32>().ok()? / 255.0;
    let a = parts.next()?.parse::<f32>().ok()?;
    if parts.next().is_some() || [r, g, b, a].iter().any(|value| !value.is_finite()) {
        return None;
    }
    Some(gpui::Rgba {
        r: r.clamp(0.0, 1.0),
        g: g.clamp(0.0, 1.0),
        b: b.clamp(0.0, 1.0),
        a: a.clamp(0.0, 1.0),
    })
}

fn message_row_background(
    message: &NormalizedChatMessage,
    settings: &AppSettings,
    accounts: &[Account],
) -> Option<gpui::Rgba> {
    if is_self_ping_message(message, settings, accounts) {
        return self_ping_row_background(settings);
    }
    shows_reply_preview(message).then(|| rgba(0xa78bfa1f))
}

fn can_start_reply_from_message(message: &NormalizedChatMessage) -> bool {
    matches!(message.platform, Platform::Twitch | Platform::Kick)
}

fn reply_preview(
    message: &NormalizedChatMessage,
    typography: MessageTypography,
) -> Option<AnyElement> {
    if !shows_reply_preview(message) {
        return None;
    }
    let reply = message.reply.as_ref()?;
    let preview_text = if reply.parent_message_text.chars().count() > 80 {
        format!(
            "{}…",
            reply
                .parent_message_text
                .chars()
                .take(80)
                .collect::<String>()
        )
    } else {
        reply.parent_message_text.clone()
    };

    Some(
        div()
            .id(format!("reply-preview-{}", message.id))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(4.0))
            .overflow_hidden()
            .text_size(px((typography.font_size * 0.82).max(10.0)))
            .text_color(theme::text_muted())
            .child("↩")
            .child(
                div()
                    .id(format!("reply-preview-author-{}", message.id))
                    .text_color(theme::text_primary())
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child(reply.parent_author.display_name.clone()),
            )
            .child(":")
            .child(
                div()
                    .id(format!("reply-preview-text-{}", message.id))
                    .overflow_hidden()
                    .child(preview_text),
            )
            .into_any_element(),
    )
}

fn aliased_row_message(
    message: &NormalizedChatMessage,
    state_entity: &Entity<AppState>,
    cx: &mut App,
) -> NormalizedChatMessage {
    let alias = state_entity
        .read(cx)
        .alias_for_message(message)
        .map(str::to_string);
    apply_alias(message, alias.as_deref()).message
}

fn message_row_actions(
    message: NormalizedChatMessage,
    state_entity: Entity<AppState>,
    reply_focus_input: Option<Entity<Input>>,
    options: MessageRowOptions,
    can_reply: bool,
) -> Stateful<Div> {
    let reply_message = message.clone();
    let reply_channel_id = message.channel_id.clone();
    let copy_text = message.text.clone();

    div()
        .id(format!(
            "message-row-actions-{}-{}",
            options.surface_scope, message.id
        ))
        .absolute()
        .top(px(3.0))
        .right(px(8.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(3.0))
        .rounded_md()
        .bg(rgba(0x18181bcc))
        .border_1()
        .border_color(theme::border())
        .px(px(3.0))
        .py(px(2.0))
        .when(can_reply, |actions| {
            actions.child(
                message_action_button("message-reply-action", "↩").on_mouse_down(
                    gpui::MouseButton::Left,
                    move |_event, window, cx| {
                        let message = reply_message.clone();
                        let channel_id = reply_channel_id.clone();
                        state_entity.update(cx, |state, cx| {
                            if options.surface_scope == "watched" {
                                state.set_watched_reply_target(channel_id, message);
                            } else {
                                state.set_home_reply_target(message);
                            }
                            cx.notify();
                        });
                        if let Some(input) = reply_focus_input.as_ref() {
                            let focus_handle = input.read(cx).focus_handle(cx);
                            window.focus(&focus_handle, cx);
                        }
                    },
                ),
            )
        })
        .child(
            message_action_button("message-copy-action", "⧉").on_mouse_down(
                gpui::MouseButton::Left,
                move |_event, _window, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()));
                },
            ),
        )
}

fn message_action_button(id: &'static str, label: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .w(px(22.0))
        .h(px(20.0))
        .rounded_sm()
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(11.0))
        .text_color(theme::text_muted())
        .cursor_pointer()
        .hover(|s| s.bg(theme::surface_2()).text_color(theme::text_primary()))
        .child(label)
}

fn compact_message_row(
    messages: &RowMessages,
    settings: &AppSettings,
    accounts: &[Account],
    window: &mut Window,
    cx: &mut App,
    row_context: MessageRowContext,
) -> AnyElement {
    let message = &messages.display;
    let target_message = messages.target.clone();
    let state_entity = row_context.state_entity.clone();
    let options = row_context.options;
    let typography = MessageTypography::from_settings(settings);
    let row_background = message_row_background(message, settings, accounts);
    let row_id = options.message_row_id(&message.id);
    let row_actions_visible = state_entity.read(cx).message_actions_visible_for(&row_id);
    let can_reply = can_start_reply_from_message(&target_message);
    let mut custom_parts = Vec::new();

    if settings.show_timestamp {
        let ts = format_timestamp(&message.timestamp);
        custom_parts.push(SelectableMessagePart::Custom(std::sync::Arc::new(
            move |_win, _cx| {
                div()
                    .w(px(50.0))
                    .flex_shrink_0()
                    .flex()
                    .justify_end()
                    .items_center()
                    .mr(px(4.0))
                    .text_size(px(10.0))
                    .text_color(theme::text_muted())
                    .child(ts.clone())
                    .into_any_element()
            },
        )));
    }

    if settings.show_platform_icon {
        let platform = message.platform;
        custom_parts.push(SelectableMessagePart::Custom(std::sync::Arc::new(
            move |_win, _cx| {
                div()
                    .mr(px(4.0))
                    .child(
                        PlatformIcon::new(to_model_platform(platform))
                            .size(px(typography.platform_icon_size()))
                            .color(theme::platform_color(to_model_platform(platform))),
                    )
                    .into_any_element()
            },
        )));
    }

    if settings.show_badges {
        for (index, badge) in message.author.badges.iter().enumerate() {
            let badge = badge.clone();
            let msg_id = message.id.clone();
            custom_parts.push(SelectableMessagePart::Custom(std::sync::Arc::new(
                move |_win, _cx| {
                    if let Some(path) = badge
                        .image_url
                        .as_ref()
                        .filter(|url| Path::new(url).is_absolute())
                    {
                        return div()
                            .mr(px(4.0))
                            .w(px(typography.badge_size()))
                            .h(px(typography.badge_size()))
                            .rounded_sm()
                            .overflow_hidden()
                            .child(
                                img(ImageSource::from(Path::new(path)))
                                    .id(options.badge_id(&msg_id, &badge.id, index))
                                    .w_full()
                                    .h_full()
                                    .object_fit(ObjectFit::Contain),
                            )
                            .into_any_element();
                    }

                    if let Some(url) = badge
                        .image_url
                        .as_ref()
                        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
                    {
                        div()
                            .mr(px(4.0))
                            .w(px(typography.badge_size()))
                            .h(px(typography.badge_size()))
                            .rounded_sm()
                            .overflow_hidden()
                            .child(
                                img(ImageSource::from(url.clone()))
                                    .id(options.badge_id(&msg_id, &badge.id, index))
                                    .w_full()
                                    .h_full()
                                    .object_fit(ObjectFit::Contain),
                            )
                            .into_any_element()
                    } else {
                        div()
                            .mr(px(4.0))
                            .rounded_sm()
                            .px(px(4.0))
                            .py(px(1.0))
                            .bg(rgba(0xffffff1a))
                            .text_color(theme::text_primary())
                            .text_size(px(typography.text_badge_font_size()))
                            .child(badge.text.clone())
                            .into_any_element()
                    }
                },
            )));
        }
    }

    let author_text = format!(
        "{}:",
        author_label_text(message, options.use_author_fallback)
    );
    let author_color = author_name_color(message);
    let state_entity_for_compact = state_entity.clone();
    let message_for_compact = target_message.clone();
    custom_parts.push(SelectableMessagePart::Custom(std::sync::Arc::new(
        move |_win, _cx| {
            let state_entity = state_entity_for_compact.clone();
            let message = message_for_compact.clone();
            div()
                .mr(px(4.0))
                .text_color(author_color)
                .text_size(px(typography.author_font_size()))
                .font_weight(gpui::FontWeight::BOLD)
                .on_mouse_down(gpui::MouseButton::Right, move |_, _window, cx| {
                    state_entity.update(cx, |state, cx| {
                        let target = state.user_card_target_for_message(&message);
                        state.open_user_card(target);
                        cx.notify();
                    });
                })
                .child(author_text.clone())
                .into_any_element()
        },
    )));

    let scoped_message_id = format!(
        "{}-compact-{}-{}-{}",
        options.selectable_key(&message.id),
        settings.show_timestamp,
        settings.show_platform_icon,
        settings.show_badges,
    );
    let mut parts = custom_parts;

    parts.extend(
        build_message_segments(message, true)
            .into_iter()
            .map(|part| match part {
                SelectableMessagePart::Emote {
                    emote,
                    source_range,
                    part_index,
                    is_compact,
                    ..
                } => SelectableMessagePart::Emote {
                    emote,
                    source_range,
                    message_id: scoped_message_id.clone().into(),
                    part_index,
                    is_compact,
                },
                part => part,
            }),
    );

    div()
        .id(row_id.clone())
        .w_full()
        .px(px(8.0))
        .py(px(1.0))
        .relative()
        .on_hover({
            let state_entity = state_entity.clone();
            let row_id = row_id.clone();
            move |hovered, _window, cx| {
                state_entity.update(cx, |state, cx| {
                    state.set_message_actions_hovered(row_id.clone(), *hovered);
                    cx.notify();
                });
            }
        })
        .when_some(row_background, |row, bg| row.bg(bg))
        .hover(|s| s.bg(rgba(0xffffff06)))
        .when(settings.show_platform_color_stripe, |el| {
            el.child(
                div()
                    .absolute()
                    .left(px(0.0))
                    .top(px(4.0))
                    .bottom(px(4.0))
                    .w(px(2.0))
                    .rounded_sm()
                    .bg(theme::platform_color(to_model_platform(message.platform))),
            )
        })
        .when_some(reply_preview(message, typography), |row, preview| {
            row.child(div().w_full().min_w(px(0.0)).mb(px(1.0)).child(preview))
        })
        .when(row_actions_visible, |row| {
            row.child(message_row_actions(
                target_message,
                state_entity.clone(),
                row_context.reply_focus_input.clone(),
                options,
                can_reply,
            ))
        })
        .child(
            div()
                .flex_1()
                .w_full()
                .min_w(px(0.0))
                .text_size(px(typography.font_size))
                .text_color(theme::text_primary())
                .flex()
                .flex_row()
                .flex_wrap()
                .items_center()
                .whitespace_normal()
                .font(theme::app_font(typography.font_family))
                .child(selectable_message(
                    scoped_message_id.clone(),
                    scoped_message_id,
                    message,
                    parts,
                    typography,
                    window,
                    cx,
                )),
        )
        .into_any_element()
}

pub(crate) fn message_row(
    message: &NormalizedChatMessage,
    settings: &AppSettings,
    accounts: &[Account],
    window: &mut Window,
    cx: &mut App,
    row_context: MessageRowContext,
) -> AnyElement {
    let state_entity = row_context.state_entity.clone();
    let options = row_context.options;
    let is_compact = settings.chat_theme == ChatTheme::Compact;
    let _is_modern = settings.chat_theme == ChatTheme::Modern;
    let typography = MessageTypography::from_settings(settings);
    let v_pad = if is_compact { 1.0 } else { 2.0 };

    if message.message_type == ChatMessageType::System {
        let system_parts = system_message_render_parts(message);
        let (row_bg, icon_bg, icon_color) = match system_parts.action {
            SystemMessageAction::Added => (0x22c55e12, 0x22c55e33, 0x22c55e),
            SystemMessageAction::Removed => (0xef444414, 0xef444433, 0xef4444),
            SystemMessageAction::Updated => (0xf59e0b12, 0xf59e0b33, 0xf59e0b),
            SystemMessageAction::Neutral => (0x00000000, 0x4ade8026, 0x4ade80),
        };

        return div()
            .id(options.message_row_id(&message.id))
            .w_full()
            .px(px(14.0))
            .py(px(v_pad))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .when(row_bg != 0, |row| row.bg(rgba(row_bg)))
            .child(
                div()
                    .w(px(17.0))
                    .h(px(17.0))
                    .rounded_full()
                    .bg(rgba(icon_bg))
                    .text_color(rgb(icon_color))
                    .text_size(px(12.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .font_weight(gpui::FontWeight::BOLD)
                    .child(system_action_icon(system_parts.action)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_size(px(typography.font_size))
                    .text_color(theme::text_muted())
                    .font(theme::app_font(typography.font_family))
                    .flex()
                    .flex_row()
                    .flex_wrap()
                    .items_center()
                    .child(selectable_message(
                        options.selectable_key(&message.id),
                        options.selectable_key(&message.id),
                        message,
                        system_parts.text_parts,
                        typography,
                        window,
                        cx,
                    )),
            )
            .when(settings.show_timestamp, |el| {
                el.child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme::text_muted())
                        .child(format_timestamp(&message.timestamp)),
                )
            })
            .into_any_element();
    }

    let row_messages = RowMessages {
        display: aliased_row_message(message, &state_entity, cx),
        target: message.clone(),
    };
    let message = &row_messages.display;
    let row_background = message_row_background(message, settings, accounts);
    let row_id = options.message_row_id(&message.id);
    let row_actions_visible = state_entity.read(cx).message_actions_visible_for(&row_id);
    let can_reply = can_start_reply_from_message(&row_messages.target);

    if is_compact {
        return compact_message_row(&row_messages, settings, accounts, window, cx, row_context);
    }

    div()
        .id(row_id.clone())
        .w_full()
        .px(px(14.0))
        .py(px(v_pad))
        .flex()
        .flex_row()
        .items_start()
        .gap(px(8.0))
        .relative()
        .on_hover({
            let state_entity = state_entity.clone();
            let row_id = row_id.clone();
            move |hovered, _window, cx| {
                state_entity.update(cx, |state, cx| {
                    state.set_message_actions_hovered(row_id.clone(), *hovered);
                    cx.notify();
                });
            }
        })
        .when_some(row_background, |row, bg| row.bg(bg))
        .hover(|s| s.bg(rgba(0xffffff06))) // 0.025 * 255 = 6.375
        .when(settings.show_platform_color_stripe, |el| {
            el.child(
                div()
                    .absolute()
                    .left(px(0.0))
                    .top(px(4.0))
                    .bottom(px(4.0))
                    .w(px(2.0))
                    .rounded_sm()
                    .bg(theme::platform_color(to_model_platform(message.platform))),
            )
        })
        .when(row_actions_visible, |row| {
            row.child(message_row_actions(
                row_messages.target.clone(),
                state_entity.clone(),
                row_context.reply_focus_input.clone(),
                options,
                can_reply,
            ))
        })
        .when(settings.show_avatars, |el| {
            let avatar_url = message.author.avatar_url.clone().or_else(|| {
                if options.use_account_avatar_fallback {
                    account_avatar_for_message(message, accounts)
                } else {
                    None
                }
            });
            let fallback = author_label_text(message, options.use_author_fallback)
                .chars()
                .next()
                .unwrap_or('?')
                .to_uppercase()
                .to_string();
            el.child(
                div()
                    .w(px(if is_compact { 22.0 } else { 26.0 }))
                    .h(px(if is_compact { 22.0 } else { 26.0 }))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(rgb(0x8b8b99))
                    .text_color(theme::text_primary())
                    .text_size(px(if is_compact { 9.0 } else { 10.0 }))
                    .font_weight(gpui::FontWeight::BOLD)
                    .overflow_hidden()
                    .on_mouse_down(gpui::MouseButton::Right, {
                        let state_entity = state_entity.clone();
                        let message = row_messages.target.clone();
                        move |_, _window, cx| {
                            state_entity.update(cx, |state, cx| {
                                let target = state.user_card_target_for_message(&message);
                                state.open_user_card(target);
                                cx.notify();
                            });
                        }
                    })
                    .when_some(avatar_url.clone(), |avatar, url| {
                        avatar.child(
                            img(ImageSource::from(url))
                                .id(options.avatar_id(&message.id))
                                .w_full()
                                .h_full()
                                .rounded_full()
                                .object_fit(ObjectFit::Cover)
                                .with_loading({
                                    let fallback = fallback.clone();
                                    move || fallback.clone().into_any_element()
                                })
                                .with_fallback({
                                    let fallback = fallback.clone();
                                    move || fallback.clone().into_any_element()
                                }),
                        )
                    })
                    .when(avatar_url.is_none(), |avatar| {
                        avatar.child(fallback.clone())
                    }),
            )
        })
        .child(
            div()
                .flex_1()
                .w_full()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                .when_some(reply_preview(message, typography), |body, preview| {
                    body.child(preview)
                })
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(5.0))
                        .flex_wrap()
                        .when(settings.show_platform_icon, |el| {
                            el.child(
                                PlatformIcon::new(to_model_platform(message.platform))
                                    .size(px(typography.platform_icon_size()))
                                    .color(theme::platform_color(to_model_platform(
                                        message.platform,
                                    ))),
                            )
                        })
                        .when(settings.show_badges, |el| {
                            el.children(message.author.badges.iter().enumerate().map(
                                |(index, badge)| {
                                    if let Some(path) = badge
                                        .image_url
                                        .as_ref()
                                        .filter(|url| Path::new(url).is_absolute())
                                    {
                                        return div()
                                            .w(px(typography.badge_size()))
                                            .h(px(typography.badge_size()))
                                            .rounded_sm()
                                            .overflow_hidden()
                                            .child(
                                                img(ImageSource::from(Path::new(path)))
                                                    .id(options.badge_id(
                                                        &message.id,
                                                        &badge.id,
                                                        index,
                                                    ))
                                                    .w_full()
                                                    .h_full()
                                                    .object_fit(ObjectFit::Contain),
                                            );
                                    }

                                    if let Some(url) = badge.image_url.as_ref().filter(|url| {
                                        url.starts_with("http://") || url.starts_with("https://")
                                    }) {
                                        div()
                                            .w(px(typography.badge_size()))
                                            .h(px(typography.badge_size()))
                                            .rounded_sm()
                                            .overflow_hidden()
                                            .child(
                                                img(ImageSource::from(url.clone()))
                                                    .id(options.badge_id(
                                                        &message.id,
                                                        &badge.id,
                                                        index,
                                                    ))
                                                    .w_full()
                                                    .h_full()
                                                    .object_fit(ObjectFit::Contain),
                                            )
                                    } else {
                                        div()
                                            .rounded_sm()
                                            .px(px(4.0))
                                            .py(px(1.0))
                                            .bg(rgba(0xffffff1a))
                                            .text_color(theme::text_primary())
                                            .text_size(px(typography.text_badge_font_size()))
                                            .child(badge.text.clone())
                                    }
                                },
                            ))
                        })
                        .child(
                            div()
                                .text_color(author_name_color(message))
                                .text_size(px(typography.author_font_size()))
                                .font_weight(gpui::FontWeight::BOLD)
                                .on_mouse_down(gpui::MouseButton::Right, {
                                    let state_entity = state_entity.clone();
                                    let message = row_messages.target.clone();
                                    move |_, _window, cx| {
                                        state_entity.update(cx, |state, cx| {
                                            let target =
                                                state.user_card_target_for_message(&message);
                                            state.open_user_card(target);
                                            cx.notify();
                                        });
                                    }
                                })
                                .child(author_label_text(message, options.use_author_fallback)),
                        )
                        .when(settings.show_timestamp, |el| {
                            el.child(
                                div()
                                    .text_size(px(9.0))
                                    .text_color(theme::text_muted())
                                    .child(format_timestamp(&message.timestamp)),
                            )
                        }),
                )
                .child(message_text_with_emotes(
                    message, typography, is_compact, options, window, cx,
                )),
        )
        .into_any_element()
}

fn outgoing_message_row(
    message: &NormalizedChatMessage,
    settings: &AppSettings,
    accounts: &[Account],
    window: &mut Window,
    cx: &mut App,
    row_context: MessageRowContext,
) -> AnyElement {
    let status = row_context
        .state_entity
        .read(cx)
        .outgoing_message_status(&message.id);
    let row = message_row(message, settings, accounts, window, cx, row_context);

    match status {
        Some(OutgoingChatMessageStatus::Pending) => div()
            .w_full()
            .opacity(0.58)
            .child(row)
            .child(outgoing_status_label(
                "sending...",
                rgba(0xffffff14),
                theme::text_muted(),
            ))
            .into_any_element(),
        Some(OutgoingChatMessageStatus::Error) => div()
            .w_full()
            .child(row)
            .child(outgoing_status_label(
                "failed",
                rgba(0xef44442a),
                rgb(0xef4444),
            ))
            .into_any_element(),
        Some(OutgoingChatMessageStatus::Sent) | None => row,
    }
}

fn outgoing_status_label(label: &'static str, bg: gpui::Rgba, color: gpui::Rgba) -> Div {
    div()
        .ml(px(14.0))
        .mt(px(-2.0))
        .mb(px(4.0))
        .rounded_sm()
        .px(px(6.0))
        .py(px(1.0))
        .bg(bg)
        .text_color(color)
        .text_size(px(10.0))
        .child(label)
}

fn message_text_with_emotes(
    message: &NormalizedChatMessage,
    typography: MessageTypography,
    is_compact: bool,
    options: MessageRowOptions,
    window: &mut Window,
    cx: &mut App,
) -> Div {
    let scoped_message_id = options.selectable_key(&message.id);
    let segments = build_message_segments(message, is_compact)
        .into_iter()
        .map(|part| match part {
            SelectableMessagePart::Emote {
                emote,
                source_range,
                part_index,
                is_compact,
                ..
            } => SelectableMessagePart::Emote {
                emote,
                source_range,
                message_id: scoped_message_id.clone().into(),
                part_index,
                is_compact,
            },
            part => part,
        })
        .collect();

    div()
        .w_full()
        .min_w(px(0.0))
        .text_size(px(typography.font_size))
        .text_color(theme::text_primary())
        .flex()
        .flex_row()
        .flex_wrap()
        .items_center()
        .whitespace_normal()
        .font(theme::app_font(typography.font_family))
        .child(selectable_message(
            scoped_message_id.clone(),
            scoped_message_id,
            message,
            segments,
            typography,
            window,
            cx,
        ))
}

fn selectable_message(
    id: String,
    selection_id: String,
    message: &NormalizedChatMessage,
    parts: Vec<SelectableMessagePart>,
    typography: MessageTypography,
    window: &mut Window,
    cx: &mut App,
) -> Entity<SelectableMessage> {
    let font = theme::app_font(typography.font_family);
    let selectable = window.use_keyed_state(id, cx, {
        let message_id = selection_id;
        let text = message.text.clone();
        let parts = parts.clone();
        let font = font.clone();
        let font_size = typography.font_size;
        move |_, cx| {
            SelectableMessage::new(
                message_id.clone(),
                text.clone(),
                parts.clone(),
                font_size,
                font.clone(),
                cx,
            )
        }
    });

    selectable.update(cx, |selectable, cx| {
        selectable.set_content(message.text.clone(), parts, typography.font_size, font, cx)
    });

    selectable
}

#[derive(Clone)]
struct TextSegmentWithRange {
    text: String,
    is_link: bool,
}

pub(crate) fn build_message_segments(
    message: &NormalizedChatMessage,
    is_compact: bool,
) -> Vec<SelectableMessagePart> {
    if message.emotes.is_empty() {
        let mut parts = Vec::new();
        append_selectable_text_parts(&mut parts, &message.text, 0);
        return parts;
    }

    let mut ranges = Vec::new();
    for emote in &message.emotes {
        for position in &emote.positions {
            let Some((start, end)) = normalize_emote_range(
                &message.text,
                position.start as usize,
                position.end as usize,
            ) else {
                continue;
            };
            ranges.push((start, end, emote.clone()));
        }
    }
    ranges.sort_by_key(|(start, _, _)| *start);

    let mut parts = Vec::new();
    let mut index = 0;
    for (part_index, (start, end, emote)) in ranges.into_iter().enumerate() {
        if start < index || start > message.text.len() {
            continue;
        }
        let end = end.min(message.text.len());
        if !message.text.is_char_boundary(start) || !message.text.is_char_boundary(end) {
            continue;
        }
        if index < start
            && let Some(text) = message.text.get(index..start)
        {
            append_selectable_text_parts(&mut parts, text, index);
        }
        parts.push(SelectableMessagePart::Emote {
            emote,
            source_range: start..end,
            message_id: message.id.clone().into(),
            part_index,
            is_compact,
        });
        index = end;
    }

    if index < message.text.len()
        && let Some(text) = message.text.get(index..)
    {
        append_selectable_text_parts(&mut parts, text, index);
    }

    if parts.is_empty() {
        append_selectable_text_parts(&mut parts, &message.text, 0);
    }

    parts
}

fn append_selectable_text_parts(
    parts: &mut Vec<SelectableMessagePart>,
    text: &str,
    base_offset: usize,
) {
    let mut cursor = 0;
    for segment in build_text_segments_with_ranges(text) {
        let len = segment.text.len();
        parts.push(SelectableMessagePart::Text {
            text: segment.text.into(),
            source_range: base_offset + cursor..base_offset + cursor + len,
            is_link: segment.is_link,
        });
        cursor += len;
    }
}

fn build_text_segments_with_ranges(text: &str) -> Vec<TextSegmentWithRange> {
    let mut parts = Vec::new();
    let mut cursor = 0;

    while let Some(start) = find_next_url_start(text, cursor) {
        let end = find_url_end(text, start);
        let candidate = &text[start..end];
        let trimmed_len = trim_trailing_link_punctuation(candidate);

        if cursor < start {
            push_text_segment_with_range(&mut parts, text[cursor..start].to_string(), false);
        }

        let link_text = &candidate[..trimmed_len];
        if is_valid_http_link(link_text) {
            parts.push(TextSegmentWithRange {
                text: link_text.to_string(),
                is_link: true,
            });
        } else {
            push_text_segment_with_range(&mut parts, link_text.to_string(), false);
        }

        if trimmed_len < candidate.len() {
            push_text_segment_with_range(&mut parts, candidate[trimmed_len..].to_string(), false);
        }

        cursor = end;
    }

    if cursor < text.len() {
        push_text_segment_with_range(&mut parts, text[cursor..].to_string(), false);
    }

    if parts.is_empty() {
        parts.push(TextSegmentWithRange {
            text: text.to_string(),
            is_link: false,
        });
    }

    parts
}

fn push_text_segment_with_range(
    parts: &mut Vec<TextSegmentWithRange>,
    text: String,
    is_link: bool,
) {
    if text.is_empty() {
        return;
    }

    if is_link {
        parts.push(TextSegmentWithRange { text, is_link });
        return;
    }

    let mut segment_start = 0;
    let mut previous_is_whitespace = text.chars().next().is_some_and(char::is_whitespace);

    for (index, ch) in text.char_indices().skip(1) {
        let is_whitespace = ch.is_whitespace();
        if previous_is_whitespace && !is_whitespace {
            parts.push(TextSegmentWithRange {
                text: text[segment_start..index].to_string(),
                is_link: false,
            });
            segment_start = index;
        }

        previous_is_whitespace = is_whitespace;
    }

    parts.push(TextSegmentWithRange {
        text: text[segment_start..].to_string(),
        is_link: false,
    });
}

fn char_index_to_byte_offset(text: &str, char_index: usize) -> Option<usize> {
    if char_index == 0 {
        return Some(0);
    }

    let char_count = text.chars().count();
    if char_index == char_count {
        return Some(text.len());
    }
    if char_index > char_count {
        return None;
    }

    text.char_indices()
        .nth(char_index)
        .map(|(byte_index, _)| byte_index)
}

fn normalize_emote_range(text: &str, start: usize, inclusive_end: usize) -> Option<(usize, usize)> {
    let byte_candidate = inclusive_end
        .checked_add(1)
        .and_then(|end| validate_emote_range(text, start, end));
    let char_candidate = inclusive_end
        .checked_add(1)
        .and_then(|end| {
            Some((
                char_index_to_byte_offset(text, start)?,
                char_index_to_byte_offset(text, end)?,
            ))
        })
        .and_then(|(start, end)| validate_emote_range(text, start, end));

    match (byte_candidate, char_candidate) {
        (Some(byte_range), Some(char_range)) => {
            let byte_score = emote_range_score(text, byte_range);
            let char_score = emote_range_score(text, char_range);
            if byte_score >= char_score {
                Some(byte_range)
            } else {
                Some(char_range)
            }
        }
        (Some(range), None) | (None, Some(range)) => Some(range),
        (None, None) => None,
    }
}

fn validate_emote_range(text: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    if start >= end || end > text.len() {
        return None;
    }
    if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return None;
    }
    Some((start, end))
}

fn emote_range_score(text: &str, range: (usize, usize)) -> i32 {
    let (start, end) = range;
    let Some(content) = text.get(start..end) else {
        return i32::MIN;
    };

    let has_whitespace = content.chars().any(char::is_whitespace);
    let left_boundary = start == 0
        || text[..start]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace);
    let right_boundary =
        end == text.len() || text[end..].chars().next().is_some_and(char::is_whitespace);

    let mut score = 0;
    if !has_whitespace {
        score += 4;
    }
    if left_boundary {
        score += 2;
    }
    if right_boundary {
        score += 2;
    }
    score - i32::try_from(content.chars().count()).unwrap_or(i32::MAX)
}

fn find_next_url_start(text: &str, from: usize) -> Option<usize> {
    let slice = text.get(from..)?;
    let http = slice.find("http://").map(|index| from + index);
    let https = slice.find("https://").map(|index| from + index);

    match (http, https) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(index), None) | (None, Some(index)) => Some(index),
        (None, None) => None,
    }
}

fn find_url_end(text: &str, start: usize) -> usize {
    let slice = &text[start..];

    for (offset, ch) in slice.char_indices() {
        if offset > 0 && is_link_terminator(ch) {
            return start + offset;
        }
    }

    text.len()
}

fn is_link_terminator(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\'')
}

fn trim_trailing_link_punctuation(candidate: &str) -> usize {
    let mut end = candidate.len();

    while end > 0 {
        let Some(ch) = candidate[..end].chars().next_back() else {
            break;
        };

        if matches!(ch, '.' | ',' | '!' | '?' | ':' | ';' | ')' | ']' | '}') {
            end -= ch.len_utf8();
            continue;
        }

        break;
    }

    end
}

fn is_valid_http_link(candidate: &str) -> bool {
    Url::parse(candidate)
        .ok()
        .is_some_and(|url| matches!(url.scheme(), "http" | "https"))
}

fn account_avatar_for_message(
    message: &NormalizedChatMessage,
    accounts: &[Account],
) -> Option<String> {
    accounts
        .iter()
        .find(|account| {
            account.platform == message.platform
                && (account.platform_user_id == message.author.id
                    || account.username.eq_ignore_ascii_case(
                        message.author.username.as_deref().unwrap_or_default(),
                    )
                    || account
                        .display_name
                        .eq_ignore_ascii_case(&message.author.display_name))
        })
        .and_then(|account| normalize_avatar_url(account.avatar_url.as_deref()))
}

fn normalize_avatar_url(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.into())
    }
}

fn to_model_platform(p: Platform) -> crate::models::Platform {
    match p {
        Platform::Twitch => crate::models::Platform::Twitch,
        Platform::Youtube => crate::models::Platform::YouTube,
        Platform::Kick => crate::models::Platform::Kick,
    }
}

fn popover_row(label: &'static str, control: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_row()
        .items_center()
        .justify_between()
        .py(px(6.0))
        .child(
            div()
                .text_color(theme::text_primary())
                .text_size(px(13.0))
                .child(label),
        )
        .child(control)
}

pub(crate) fn normalize_chat_font_size(value: f64) -> f64 {
    value.round().clamp(CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX)
}

pub(crate) fn format_chat_font_size(value: f64) -> String {
    format!("{:.0}", normalize_chat_font_size(value))
}

pub(crate) fn parse_chat_font_size_input(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let numeric_text = trimmed
        .strip_suffix("px")
        .or_else(|| trimmed.strip_suffix("PX"))
        .unwrap_or(trimmed)
        .trim();

    numeric_text
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .map(normalize_chat_font_size)
}

fn popover_btn(
    label: &'static str,
    on_click: impl Fn(&gpui::MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> Div {
    div()
        .bg(theme::surface_2())
        .border_1()
        .border_color(theme::border())
        .rounded_md()
        .px(px(8.0))
        .py(px(4.0))
        .text_color(theme::text_primary())
        .text_size(px(13.0))
        .cursor_pointer()
        .hover(|s| s.bg(gpui::rgb(0x3a3a44)))
        .child(label)
        .on_mouse_down(gpui::MouseButton::Left, on_click)
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TextSegment {
    Text(String),
    Link(String),
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum MessagePart {
    Text(String),
    Link(String),
    Emote(crate::protocol::types::Emote),
}

#[cfg(test)]
pub(crate) fn build_text_segments(text: &str) -> Vec<TextSegment> {
    let mut parts = Vec::new();
    let mut cursor = 0;
    let mut pending_text = String::new();

    while let Some(start) = find_next_url_start(text, cursor) {
        let end = find_url_end(text, start);
        let candidate = &text[start..end];
        let trimmed_len = trim_trailing_link_punctuation(candidate);

        if cursor < start
            && let Some(content) = text.get(cursor..start)
        {
            let mut merged = core::mem::take(&mut pending_text);
            merged.push_str(content);
            parts.push(TextSegment::Text(merged));
        }

        let link_text = &candidate[..trimmed_len];
        if is_valid_http_link(link_text) {
            parts.push(TextSegment::Link(link_text.to_string()));
        } else {
            parts.push(TextSegment::Text(link_text.to_string()));
        }

        if trimmed_len < candidate.len()
            && let Some(content) = candidate.get(trimmed_len..)
        {
            pending_text.push_str(content);
        }

        cursor = end;
    }

    if cursor < text.len()
        && let Some(content) = text.get(cursor..)
    {
        let mut merged = core::mem::take(&mut pending_text);
        merged.push_str(content);
        parts.push(TextSegment::Text(merged));
    }

    if !pending_text.is_empty() {
        parts.push(TextSegment::Text(pending_text));
    }

    if parts.is_empty() {
        parts.push(TextSegment::Text(text.to_string()));
    }

    parts
}

#[cfg(test)]
pub(crate) fn build_message_parts(message: &NormalizedChatMessage) -> Vec<MessagePart> {
    if message.emotes.is_empty() {
        return build_text_segments(&message.text)
            .into_iter()
            .map(|segment| match segment {
                TextSegment::Text(text) => MessagePart::Text(text),
                TextSegment::Link(text) => MessagePart::Link(text),
            })
            .collect();
    }

    let mut ranges = Vec::new();
    for emote in &message.emotes {
        for position in &emote.positions {
            let Some((start, end)) = normalize_emote_range(
                &message.text,
                position.start as usize,
                position.end as usize,
            ) else {
                continue;
            };
            ranges.push((start, end, emote.clone()));
        }
    }
    ranges.sort_by_key(|(start, _, _)| *start);

    let mut parts = Vec::new();
    let mut index = 0;
    for (start, end, emote) in ranges {
        if start < index || start > message.text.len() {
            continue;
        }

        let end = end.min(message.text.len());
        if index < start
            && let Some(text) = message.text.get(index..start)
        {
            parts.extend(
                build_text_segments(text)
                    .into_iter()
                    .map(|segment| match segment {
                        TextSegment::Text(text) => MessagePart::Text(text),
                        TextSegment::Link(text) => MessagePart::Link(text),
                    }),
            );
        }

        parts.push(MessagePart::Emote(emote));
        index = end;
    }

    if index < message.text.len()
        && let Some(text) = message.text.get(index..)
    {
        parts.extend(
            build_text_segments(text)
                .into_iter()
                .map(|segment| match segment {
                    TextSegment::Text(text) => MessagePart::Text(text),
                    TextSegment::Link(text) => MessagePart::Link(text),
                }),
        );
    }

    if parts.is_empty() {
        parts.extend(
            build_text_segments(&message.text)
                .into_iter()
                .map(|segment| match segment {
                    TextSegment::Text(text) => MessagePart::Text(text),
                    TextSegment::Link(text) => MessagePart::Link(text),
                }),
        );
    }

    parts
}

pub fn render_appearance_popover(
    state_entity: Entity<crate::app_state::AppState>,
    font_size_input: Entity<Input>,
    settings: crate::protocol::AppSettings,
) -> impl IntoElement {
    let font_size = normalize_chat_font_size(settings.font_size);

    div()
        .absolute()
        .top(px(32.0))
        .right(px(0.0))
        .w(px(240.0))
        .bg(theme::surface())
        .border_1()
        .border_color(theme::border())
        .rounded_lg()
        .shadow_md()
        .p(px(8.0))
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(gpui::FontWeight::BOLD)
                .text_color(theme::text_primary())
                .child("Appearance")
                .mb(px(4.0)),
        )
        .child(popover_row(
            "Density",
            div()
                .flex()
                .flex_row()
                .border_1()
                .border_color(theme::border())
                .rounded_md()
                .overflow_hidden()
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .text_size(px(12.0))
                        .bg(if settings.chat_theme == ChatTheme::Modern {
                            theme::surface_2()
                        } else {
                            gpui::rgba(0x00000000)
                        })
                        .text_color(if settings.chat_theme == ChatTheme::Modern {
                            theme::text_primary()
                        } else {
                            theme::text_muted()
                        })
                        .cursor_pointer()
                        .child("Modern")
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let state_entity = state_entity.clone();
                            move |_, _, cx| {
                                state_entity.set_chat_theme(cx, ChatTheme::Modern);
                                state_entity.persist_settings(cx);
                            }
                        }),
                )
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .text_size(px(12.0))
                        .bg(if settings.chat_theme == ChatTheme::Compact {
                            theme::surface_2()
                        } else {
                            gpui::rgba(0x00000000)
                        })
                        .text_color(if settings.chat_theme == ChatTheme::Compact {
                            theme::text_primary()
                        } else {
                            theme::text_muted()
                        })
                        .cursor_pointer()
                        .child("Compact")
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let state_entity = state_entity.clone();
                            move |_, _, cx| {
                                state_entity.set_chat_theme(cx, ChatTheme::Compact);
                                state_entity.persist_settings(cx);
                            }
                        }),
                ),
        ))
        .child(div().w_full().h(px(1.0)).bg(theme::border()))
        .child(popover_row(
            "Font Size",
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .w(px(20.0))
                        .h(px(20.0))
                        .rounded_sm()
                        .bg(theme::surface_2())
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme::text_primary())
                        .cursor_pointer()
                        .child("-")
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let state_entity = state_entity.clone();
                            let font_size_input = font_size_input.clone();
                            move |_, _, cx| {
                                let next_font_size =
                                    normalize_chat_font_size(font_size - CHAT_FONT_SIZE_STEP);
                                state_entity.set_font_size(cx, next_font_size);
                                state_entity.persist_settings(cx);
                                font_size_input.update(cx, |input, cx| {
                                    input.set_text(format_chat_font_size(next_font_size), cx);
                                });
                            }
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(3.0))
                        .child(div().w(px(40.0)).child(font_size_input.clone()))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme::text_muted())
                                .child("px"),
                        ),
                )
                .child(
                    div()
                        .w(px(20.0))
                        .h(px(20.0))
                        .rounded_sm()
                        .bg(theme::surface_2())
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme::text_primary())
                        .cursor_pointer()
                        .child("+")
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let state_entity = state_entity.clone();
                            let font_size_input = font_size_input.clone();
                            move |_, _, cx| {
                                let next_font_size =
                                    normalize_chat_font_size(font_size + CHAT_FONT_SIZE_STEP);
                                state_entity.set_font_size(cx, next_font_size);
                                state_entity.persist_settings(cx);
                                font_size_input.update(cx, |input, cx| {
                                    input.set_text(format_chat_font_size(next_font_size), cx);
                                });
                            }
                        }),
                ),
        ))
        .child(
            div().pb(px(6.0)).child(
                Slider::new("chat-font-size-slider", font_size)
                    .range(CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX, CHAT_FONT_SIZE_STEP)
                    .on_change({
                        let state_entity = state_entity.clone();
                        let font_size_input = font_size_input.clone();
                        move |next_font_size, _window, cx| {
                            let next_font_size = normalize_chat_font_size(next_font_size);
                            state_entity.set_font_size(cx, next_font_size);
                            state_entity.persist_settings(cx);
                            font_size_input.update(cx, |input, cx| {
                                input.set_text(format_chat_font_size(next_font_size), cx);
                            });
                        }
                    }),
            ),
        )
        .child(div().w_full().h(px(1.0)).bg(theme::border()))
        .child(popover_row(
            "Show Avatars",
            Switch::new("chat-show-avatars", settings.show_avatars).on_click({
                let state_entity = state_entity.clone();
                let current = settings.show_avatars;
                move |_, _, cx| {
                    state_entity.set_show_avatars(cx, !current);
                    state_entity.persist_settings(cx);
                }
            }),
        ))
        .child(popover_row(
            "Show Badges",
            Switch::new("chat-show-badges", settings.show_badges).on_click({
                let state_entity = state_entity.clone();
                let current = settings.show_badges;
                move |_, _, cx| {
                    state_entity.set_show_badges(cx, !current);
                    state_entity.persist_settings(cx);
                }
            }),
        ))
        .child(popover_row(
            "Platform Icon",
            Switch::new("chat-show-platform-icon", settings.show_platform_icon).on_click({
                let state_entity = state_entity.clone();
                let current = settings.show_platform_icon;
                move |_, _, cx| {
                    state_entity.set_show_platform_icon(cx, !current);
                    state_entity.persist_settings(cx);
                }
            }),
        ))
        .child(popover_row(
            "Timestamp",
            Switch::new("chat-show-timestamp", settings.show_timestamp).on_click({
                let state_entity = state_entity.clone();
                let current = settings.show_timestamp;
                move |_, _, cx| {
                    state_entity.set_show_timestamp(cx, !current);
                    state_entity.persist_settings(cx);
                }
            }),
        ))
        .child(popover_row(
            "Platform Stripe",
            Switch::new(
                "chat-show-platform-stripe",
                settings.show_platform_color_stripe,
            )
            .on_click({
                let state_entity = state_entity.clone();
                let current = settings.show_platform_color_stripe;
                move |_, _, cx| {
                    state_entity.set_show_platform_color_stripe(cx, !current);
                    state_entity.persist_settings(cx);
                }
            }),
        ))
}

#[cfg(test)]
mod tests {
    use super::SelectableMessagePart;
    use crate::app_state::AppState;
    use crate::protocol::types::{
        Account, ChatAuthor, ChatMessageType, ChatReply, Emote, EmotePosition,
        NormalizedChatMessage, Platform, PlatformStatus, PlatformStatusInfo, PlatformStatusMode,
        ReplyAuthor,
    };

    fn chat_message_with_author_color(color: Option<&str>) -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: "message-color".into(),
            platform: Platform::Twitch,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("fixture".into()),
                display_name: "Fixture".into(),
                color: color.map(str::to_string),
                avatar_url: None,
                badges: Vec::new(),
            },
            text: "hello".into(),
            emotes: Vec::new(),
            timestamp: "2026-05-18T21:03:27.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        }
    }

    fn chat_message_with_text(platform: Platform, text: &str) -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: "message-text".into(),
            platform,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("viewer".into()),
                display_name: "Viewer".into(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: text.into(),
            emotes: Vec::new(),
            timestamp: "2026-05-18T21:03:27.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        }
    }

    fn account(platform: Platform) -> Account {
        Account {
            id: "account-1".into(),
            platform,
            platform_user_id: "self-1".into(),
            username: "satont".into(),
            display_name: "Satont".into(),
            avatar_url: None,
            scopes: Vec::new(),
            created_at: 0,
            updated_at: 0,
        }
    }

    fn reply() -> ChatReply {
        ChatReply {
            parent_message_id: "parent-1".into(),
            parent_message_text: "original text".into(),
            parent_author: ReplyAuthor {
                id: "parent-author".into(),
                username: "original".into(),
                display_name: "Original".into(),
            },
        }
    }

    #[test]
    fn stream_status_header_targets_skip_youtube() {
        let mut state = AppState::default();
        for (platform, channel_login) in [
            (Platform::Twitch, "fixturestreamer"),
            (Platform::Youtube, "tubeone"),
            (Platform::Kick, "kickone"),
        ] {
            state.platforms_panel.statuses.insert(
                platform,
                PlatformStatusInfo {
                    platform,
                    status: PlatformStatus::Connected,
                    error: None,
                    mode: PlatformStatusMode::Authenticated,
                    channel_login: Some(channel_login.to_string()),
                },
            );
        }

        let targets = super::stream_status_header_targets(&state);

        assert_eq!(targets.len(), 2);
        assert!(
            targets
                .iter()
                .any(|target| target.platform == Platform::Twitch)
        );
        assert!(
            targets
                .iter()
                .any(|target| target.platform == Platform::Kick)
        );
        assert!(
            !targets
                .iter()
                .any(|target| target.platform == Platform::Youtube)
        );
    }

    #[test]
    fn build_text_segments_extracts_links_without_swallowing_punctuation() {
        let parts = super::build_text_segments("go https://example.com, now");

        assert_eq!(parts.len(), 3);
        assert!(matches!(&parts[0], super::TextSegment::Text(text) if text == "go "));
        assert!(matches!(
            &parts[1],
            super::TextSegment::Link(text) if text == "https://example.com"
        ));
        assert!(matches!(&parts[2], super::TextSegment::Text(text) if text == ", now"));
    }

    #[test]
    fn build_text_segments_keeps_plain_text_without_links() {
        let parts = super::build_text_segments("hello world");

        assert_eq!(parts.len(), 1);
        assert!(matches!(
            &parts[0],
            super::TextSegment::Text(text) if text == "hello world"
        ));
    }

    #[test]
    fn author_name_color_uses_valid_platform_hex_color() {
        let message = chat_message_with_author_color(Some("#12abef"));

        assert_eq!(super::author_name_color(&message), gpui::rgb(0x12abef));
    }

    #[test]
    fn author_name_color_falls_back_when_color_missing() {
        let message = chat_message_with_author_color(None);

        assert_eq!(
            super::author_name_color(&message),
            crate::ui::theme::accent()
        );
    }

    #[test]
    fn author_name_color_falls_back_when_color_invalid() {
        let message = chat_message_with_author_color(Some("#nothex"));

        assert_eq!(
            super::author_name_color(&message),
            crate::ui::theme::accent()
        );
    }

    #[test]
    fn author_name_color_rejects_shorthand_hex_color() {
        let message = chat_message_with_author_color(Some("#abc"));

        assert_eq!(
            super::author_name_color(&message),
            crate::ui::theme::accent()
        );
    }

    #[test]
    fn reply_preview_is_visible_only_for_twitch_and_kick_replies() {
        let mut twitch = chat_message_with_text(Platform::Twitch, "reply body");
        twitch.reply = Some(reply());
        let mut kick = chat_message_with_text(Platform::Kick, "reply body");
        kick.reply = Some(reply());
        let mut youtube = chat_message_with_text(Platform::Youtube, "reply body");
        youtube.reply = Some(reply());

        assert!(super::shows_reply_preview(&twitch));
        assert!(super::shows_reply_preview(&kick));
        assert!(!super::shows_reply_preview(&youtube));
        assert!(!super::shows_reply_preview(&chat_message_with_text(
            Platform::Twitch,
            "plain"
        )));
    }

    #[test]
    fn self_ping_matches_exact_own_mentions_for_twitch_and_kick() {
        let settings = crate::storage::settings::default_app_settings();
        let accounts = [account(Platform::Twitch), account(Platform::Kick)];

        assert!(super::is_self_ping_message(
            &chat_message_with_text(Platform::Twitch, "hey @Satont"),
            &settings,
            &accounts,
        ));
        assert!(super::is_self_ping_message(
            &chat_message_with_text(Platform::Kick, "@satont ping"),
            &settings,
            &accounts,
        ));
    }

    #[test]
    fn self_ping_rejects_partial_email_wrong_platform_and_disabled_cases() {
        let mut settings = crate::storage::settings::default_app_settings();
        let accounts = [account(Platform::Twitch)];

        assert!(!super::is_self_ping_message(
            &chat_message_with_text(Platform::Twitch, "hey @satontology"),
            &settings,
            &accounts,
        ));
        assert!(!super::is_self_ping_message(
            &chat_message_with_text(Platform::Twitch, "mail foo@satont.com"),
            &settings,
            &accounts,
        ));
        assert!(!super::is_self_ping_message(
            &chat_message_with_text(Platform::Kick, "hey @satont"),
            &settings,
            &accounts,
        ));

        settings.self_ping.as_mut().unwrap().enabled = false;
        assert!(!super::is_self_ping_message(
            &chat_message_with_text(Platform::Twitch, "hey @satont"),
            &settings,
            &accounts,
        ));
    }

    #[test]
    fn build_message_parts_splits_plain_text_link_messages() {
        let message = NormalizedChatMessage {
            id: "message-link".into(),
            platform: Platform::Kick,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("fossabot".into()),
                display_name: "Fossabot".into(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: "Tg: https://t.me/satontdev".into(),
            emotes: Vec::new(),
            timestamp: "2026-05-18T21:03:27.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        };

        let parts = super::build_message_parts(&message);

        assert_eq!(parts.len(), 2);
        assert!(matches!(&parts[0], super::MessagePart::Text(text) if text == "Tg: "));
        assert!(matches!(
            &parts[1],
            super::MessagePart::Link(text) if text == "https://t.me/satontdev"
        ));
    }

    #[test]
    fn build_message_parts_handles_unicode_emote_positions_before_link() {
        let message = NormalizedChatMessage {
            id: "message-1".into(),
            platform: Platform::Kick,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("alexue4".into()),
                display_name: "alexue4".into(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: "А че они так и не пофиксили эту хуйню? https://al4.dev/6wYTrB".into(),
            emotes: vec![Emote {
                id: "emote-1".into(),
                name: "che".into(),
                image_url: "https://example.com/che.png".into(),
                positions: vec![EmotePosition { start: 2, end: 3 }],
                aspect_ratio: Some(1.0),
            }],
            timestamp: "2026-05-18T20:20:41.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        };

        let parts = super::build_message_parts(&message);

        assert_eq!(parts.len(), 4);
        assert!(matches!(&parts[0], super::MessagePart::Text(text) if text == "А "));
        assert!(matches!(&parts[1], super::MessagePart::Emote(emote) if emote.name == "che"));
        assert!(matches!(
            &parts[2],
            super::MessagePart::Text(text) if text == " они так и не пофиксили эту хуйню? "
        ));
        assert!(matches!(
            &parts[3],
            super::MessagePart::Link(text) if text == "https://al4.dev/6wYTrB"
        ));
    }

    #[test]
    fn build_message_parts_handles_byte_offsets_for_unicode_emote_positions() {
        let message = NormalizedChatMessage {
            id: "message-2".into(),
            platform: Platform::Kick,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("satont".into()),
                display_name: "Satont".into(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: "А че они так и не пофиксили эту хуйню? https://al4.dev/6wYTrB".into(),
            emotes: vec![Emote {
                id: "emote-1".into(),
                name: "che".into(),
                image_url: "https://example.com/che.png".into(),
                positions: vec![EmotePosition { start: 3, end: 6 }],
                aspect_ratio: Some(1.0),
            }],
            timestamp: "2026-05-18T21:08:48.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        };

        let parts = super::build_message_parts(&message);

        assert_eq!(parts.len(), 4);
        assert!(matches!(&parts[0], super::MessagePart::Text(text) if text == "А "));
        assert!(matches!(&parts[1], super::MessagePart::Emote(emote) if emote.name == "che"));
        assert!(matches!(
            &parts[2],
            super::MessagePart::Text(text) if text == " они так и не пофиксили эту хуйню? "
        ));
        assert!(matches!(
            &parts[3],
            super::MessagePart::Link(text) if text == "https://al4.dev/6wYTrB"
        ));
    }

    #[test]
    fn build_message_segments_splits_plain_text_for_wrapping() {
        let message = NormalizedChatMessage {
            id: "message-3".into(),
            platform: Platform::Kick,
            channel_id: "channel-1".into(),
            author: ChatAuthor {
                id: "author-1".into(),
                username: Some("satont".into()),
                display_name: "Satont".into(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: "hello world".into(),
            emotes: Vec::new(),
            timestamp: "2026-05-18T21:08:48.000Z".into(),
            message_type: ChatMessageType::Message,
            reply: None,
        };

        let parts = super::build_message_segments(&message, false);

        assert_eq!(parts.len(), 2);
        assert!(matches!(
            &parts[0],
            SelectableMessagePart::Text {
                text,
                source_range,
                is_link: false,
            } if text == "hello " && source_range.start == 0 && source_range.end == 6
        ));
        assert!(matches!(
            &parts[1],
            SelectableMessagePart::Text {
                text,
                source_range,
                is_link: false,
            } if text == "world" && source_range.start == 6 && source_range.end == 11
        ));
    }

    #[test]
    fn parse_chat_font_size_input_clamps_rounds_and_rejects_invalid_text() {
        assert_eq!(super::parse_chat_font_size_input("9"), Some(10.0));
        assert_eq!(super::parse_chat_font_size_input("17.6"), Some(18.0));
        assert_eq!(super::parse_chat_font_size_input("31px"), Some(30.0));
        assert_eq!(super::parse_chat_font_size_input(""), None);
        assert_eq!(super::parse_chat_font_size_input("large"), None);
    }

    #[test]
    fn test_format_timestamp() {
        use super::parse_timestamp;

        let tz = chrono::FixedOffset::east_opt(2 * 3600).unwrap();

        let format_with_tz = |ts: &str| -> String {
            if let Some(dt) = parse_timestamp(ts) {
                dt.with_timezone(&tz).format("%H:%M:%S").to_string()
            } else {
                ts.to_string()
            }
        };

        assert_eq!(format_with_tz("2026-05-28T13:42:00.000Z"), "15:42:00");

        assert_eq!(format_with_tz("1779979320"), "16:42:00");

        assert_eq!(format_with_tz("1779979320000"), "16:42:00");

        assert_eq!(format_with_tz("hello world"), "hello world");
        assert_eq!(format_with_tz(""), "");
    }
}
