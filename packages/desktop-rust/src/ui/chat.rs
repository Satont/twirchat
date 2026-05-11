use crate::app_state::mock_data::PrototypeData;
use crate::models::{ChatMessage, StreamChip};
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{Context, Div, div, prelude::*, px, rgb, rgba, uniform_list};
use std::ops::Range;

pub(crate) fn panel(data: &PrototypeData, cx: &mut Context<TwirChatApp>) -> Div {
    div()
        .flex_1()
        .flex()
        .flex_col()
        .bg(theme::background())
        .child(header(data))
        .child(
            div().flex_1().bg(theme::background()).child(
                uniform_list(
                    "chat-messages",
                    data.messages.len(),
                    cx.processor(
                        |this: &mut TwirChatApp, range: Range<usize>, _window, _cx| {
                            range
                                .filter_map(|index| this.data.messages.get(index))
                                .map(message_row)
                                .collect::<Vec<_>>()
                        },
                    ),
                )
                .h_full(),
            ),
        )
        .child(composer(data))
}

fn header(data: &PrototypeData) -> Div {
    div()
        .w_full()
        .min_h(px(44.0))
        .border_b_1()
        .border_color(theme::border())
        .px(px(16.0))
        .py(px(8.0))
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
                .children(data.chips.iter().take(2).map(header_chip)),
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
                        .child(format!("{} messages", data.messages.len())),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(2.0))
                        .child(panel_action_btn("⚙"))
                        .child(panel_action_btn("+"))
                        .child(panel_action_btn("⋮")),
                ),
        )
}

fn panel_action_btn(icon: &'static str) -> Div {
    div()
        .w(px(26.0))
        .h(px(26.0))
        .rounded_md()
        .text_color(theme::text_muted())
        .flex()
        .items_center()
        .justify_center()
        .hover(|s| s.bg(rgb(0x2a2a33)).text_color(theme::text_primary()))
        .child(icon)
}

fn composer(data: &PrototypeData) -> Div {
    div()
        .w_full()
        .bg(theme::surface())
        .border_t_1()
        .border_color(theme::border())
        .pt(px(8.0))
        .px(px(12.0))
        .pb(px(10.0))
        .flex()
        .flex_col()
        .gap(px(7.0))
        .child(
            div().flex().flex_row().flex_wrap().gap(px(6.0)).children(
                data.chips
                    .iter()
                    .take(2)
                    .map(|chip| status_chip(chip, true)),
            ),
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

fn status_chip(chip: &StreamChip, accent_bg: bool) -> Div {
    let active = accent_bg;
    let color = theme::platform_color(chip.platform);

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
                .child(PlatformIcon::new(chip.platform).size(px(13.0))),
        )
        .child(
            div()
                .max_w(px(80.0))
                .overflow_hidden()
                .child(chip.channel_name.clone()),
        )
}

fn header_chip(chip: &StreamChip) -> Div {
    div()
        .rounded_full()
        .px(px(8.0))
        .py(px(3.0))
        .bg(theme::surface_2())
        .border_1()
        .border_color(theme::border())
        .text_color(if chip.live {
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
        .child(div().w(px(6.0)).h(px(6.0)).rounded_full().bg(if chip.live {
            theme::platform_color(chip.platform)
        } else {
            rgb(0x666666)
        }))
        .child(
            div()
                .max_w(px(100.0))
                .overflow_hidden()
                .child(chip.channel_name.clone()),
        )
        .children(chip.viewer_count.map(|count| {
            div()
                .text_size(px(11.0))
                .text_color(theme::text_muted())
                .child(format_viewers(count))
        }))
}

fn message_row(message: &ChatMessage) -> Div {
    if message.system {
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
        .py(px(6.0))
        .flex()
        .flex_row()
        .items_start()
        .gap(px(10.0))
        .relative()
        .hover(|s| s.bg(rgba(0xffffff06))) // 0.025 * 255 = 6.375
        .child(
            div()
                .absolute()
                .left(px(0.0))
                .top(px(6.0))
                .bottom(px(6.0))
                .w(px(2.0))
                .rounded_sm()
                .bg(theme::platform_color(message.platform)),
        )
        .child(
            div()
                .w(px(28.0))
                .h(px(28.0))
                .rounded_full()
                .bg(rgb(message.author_color_hex))
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme::text_primary())
                .text_size(px(11.0))
                .font_weight(gpui::FontWeight::BOLD)
                .child(
                    message
                        .author
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
                        .children(message.badges.iter().map(|badge| {
                            div()
                                .rounded_sm()
                                .px(px(4.0))
                                .py(px(1.0))
                                .bg(rgba(0xffffff1a)) // 0.1 * 255 = 25.5 = 1a
                                .text_color(theme::text_primary())
                                .text_size(px(10.0))
                                .child(badge.clone())
                        }))
                        .child(
                            div()
                                .text_color(rgb(message.author_color_hex))
                                .text_size(px(14.0))
                                .font_weight(gpui::FontWeight::BOLD)
                                .child(message.author.clone()),
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
                        .text_size(px(14.0))
                        .text_color(theme::text_primary())
                        .child(message.text.clone()),
                ),
        )
}

fn format_viewers(viewers: usize) -> String {
    if viewers >= 1_000_000 {
        format!("{:.1}M", viewers as f32 / 1_000_000.0)
    } else if viewers >= 1_000 {
        format!("{:.1}K", viewers as f32 / 1_000.0)
    } else {
        viewers.to_string()
    }
}
