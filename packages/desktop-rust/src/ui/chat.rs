use crate::app_state::AppState;
use crate::protocol::types::{ChatMessageType, NormalizedChatMessage, Platform, WatchedChannel};
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{
    AnyElement, Context, Div, Entity, Stateful, div, prelude::*, px, rgb, rgba, uniform_list,
};
use std::ops::Range;

pub(crate) fn panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    div()
        .flex_1()
        .flex()
        .flex_col()
        .bg(theme::background())
        .child(header(
            &state.watched_channels,
            state.messages.len(),
            state_entity,
        ))
        .child(
            div().flex_1().bg(theme::background()).child(
                {
                    let messages = state.messages.clone();
                    uniform_list(
                        "chat-messages",
                        messages.len(),
                        cx.processor(
                            move |_this: &mut TwirChatApp,
                                  range: Range<usize>,
                                  _window,
                                  _cx|
                                  -> Vec<AnyElement> {
                                messages[range]
                                    .iter()
                                    .map(|msg| message_row(msg).into_any_element())
                                    .collect()
                            },
                        ),
                    )
                }
                .h_full(),
            ),
        )
        .child(composer(&state.watched_channels))
}

fn header(
    channels: &[WatchedChannel],
    message_count: usize,
    state_entity: Entity<AppState>,
) -> Div {
    let message_count_text = format!("{} messages", message_count);

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
                .children(channels.iter().map(header_chip)),
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
                        .child(panel_action_btn("⚙", true).on_click({
                            let state_entity = state_entity.clone();
                            move |_event, _window, cx| {
                                state_entity.update(cx, |state, cx| {
                                    state.select_section(crate::app_state::MainSection::Settings);
                                    cx.notify();
                                });
                            }
                        }))
                        .child(panel_action_btn("+", false))
                        .child(panel_action_btn("⋮", false)),
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

fn composer(channels: &[WatchedChannel]) -> Div {
    div()
        .w_full()
        .bg(theme::surface())
        .border_t_1()
        .border_color(theme::border())
        .pt(px(6.0))
        .px(px(12.0))
        .pb(px(8.0))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .flex()
                .flex_row()
                .flex_wrap()
                .gap(px(6.0))
                .children(channels.iter().map(|chip| status_chip(chip, true))),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .items_end()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_1()
                        .max_h(px(120.0))
                        .rounded_lg()
                        .bg(theme::surface_2())
                        .border_1()
                        .border_color(theme::border())
                        .py(px(8.0))
                        .px(px(12.0))
                        .flex()
                        .items_center()
                        .text_size(px(13.0))
                        .text_color(rgb(0x8b8b99))
                        .child("Send a message... (Enter ↵ to send, Shift+Enter for newline)"),
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
                        .bg(theme::accent_strong())
                        .text_color(theme::text_primary())
                        .flex()
                        .items_center()
                        .justify_center()
                        .hover(|s| s.bg(rgb(0x6d28d9)))
                        .child("➤"),
                ),
        )
}

fn status_chip(chip: &WatchedChannel, accent_bg: bool) -> Div {
    let active = accent_bg;
    let color = theme::platform_color(to_model_platform(chip.platform));

    div()
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
        .text_color(if active { color } else { theme::text_muted() })
        .flex()
        .flex_row()
        .items_center()
        .gap(px(5.0))
        .child(
            div()
                .text_color(color)
                .child(PlatformIcon::new(to_model_platform(chip.platform)).size(px(13.0))),
        )
        .child(
            div()
                .max_w(px(80.0))
                .overflow_hidden()
                .child(chip.display_name.clone()),
        )
}

fn header_chip(chip: &WatchedChannel) -> Div {
    div()
        .rounded_full()
        .px(px(8.0))
        .py(px(3.0))
        .bg(theme::surface_2())
        .border_1()
        .border_color(theme::border())
        .text_color(if true {
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
        .child(div().w(px(6.0)).h(px(6.0)).rounded_full().bg(if true {
            theme::platform_color(to_model_platform(chip.platform))
        } else {
            rgb(0x666666)
        }))
        .child(
            div()
                .max_w(px(100.0))
                .overflow_hidden()
                .child(chip.display_name.clone()),
        )
}

#[allow(dead_code)]
fn message_row(message: &NormalizedChatMessage) -> Div {
    if message.message_type == ChatMessageType::System {
        return div()
            .w_full()
            .px(px(14.0))
            .py(px(3.0))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .child(
                div()
                    .w(px(17.0))
                    .h(px(17.0))
                    .rounded_full()
                    .bg(rgba(0x4ade8026)) // 0.15 * 255 = ~38 = 26
                    .text_color(rgb(0x4ade80))
                    .text_size(px(12.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .font_weight(gpui::FontWeight::BOLD)
                    .child("~"),
            )
            .child(
                div()
                    .flex_1()
                    .text_size(px(14.0))
                    .text_color(theme::text_muted())
                    .child(message.text.clone()),
            )
            .child(
                div()
                    .text_size(px(10.0))
                    .text_color(theme::text_muted())
                    .child(message.timestamp.clone()),
            );
    }

    div()
        .w_full()
        .px(px(14.0))
        .py(px(4.0))
        .flex()
        .flex_row()
        .items_start()
        .gap(px(8.0))
        .relative()
        .hover(|s| s.bg(rgba(0xffffff06))) // 0.025 * 255 = 6.375
        .child(
            div()
                .absolute()
                .left(px(0.0))
                .top(px(4.0))
                .bottom(px(4.0))
                .w(px(2.0))
                .rounded_sm()
                .bg(theme::platform_color(to_model_platform(message.platform))),
        )
        .child(
            div()
                .w(px(28.0))
                .h(px(28.0))
                .rounded_full()
                .bg(rgb(0x8b8b99))
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme::text_primary())
                .text_size(px(11.0))
                .font_weight(gpui::FontWeight::BOLD)
                .child(
                    message
                        .author
                        .display_name
                        .chars()
                        .next()
                        .unwrap_or('?')
                        .to_uppercase()
                        .to_string(),
                ),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(5.0))
                        .flex_wrap()
                        .children(message.author.badges.iter().map(|badge| {
                            div()
                                .rounded_sm()
                                .px(px(4.0))
                                .py(px(1.0))
                                .bg(rgba(0xffffff1a)) // 0.1 * 255 = 25.5 = 1a
                                .text_color(theme::text_primary())
                                .text_size(px(10.0))
                                .child(badge.text.clone())
                        }))
                        .child(
                            div()
                                .text_color(rgb(0x8b8b99))
                                .text_size(px(13.0))
                                .font_weight(gpui::FontWeight::BOLD)
                                .child(message.author.display_name.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme::text_muted())
                                .child(message.timestamp.clone()),
                        ),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme::text_primary())
                        .child(message.text.clone()),
                ),
        )
}

fn to_model_platform(p: Platform) -> crate::models::Platform {
    match p {
        Platform::Twitch => crate::models::Platform::Twitch,
        Platform::Youtube => crate::models::Platform::YouTube,
        Platform::Kick => crate::models::Platform::Kick,
    }
}
