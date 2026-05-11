use crate::app_state::mock_data::PrototypeData;
use crate::models::{ChatMessage, StreamChip};
use crate::theme;
use crate::ui::shell::app::TwirChatApp;
use gpui::{Context, Div, div, prelude::*, px, rgb, uniform_list};
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
        .h(px(42.0))
        .border_b_1()
        .border_color(theme::border())
        .px(px(16.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .text_color(theme::text_muted())
                .text_size(px(12.0))
                .child("LIVE CHAT"),
        )
        .children(data.chips.iter().take(2).map(header_chip))
        .child(div().flex_1())
        .child(
            div()
                .text_color(theme::text_muted())
                .text_size(px(11.0))
                .child("142 messages"),
        )
        .child(div().text_color(theme::text_muted()).child("⚙"))
        .child(div().text_color(theme::text_muted()).child("+"))
        .child(div().text_color(theme::text_muted()).child("⋮"))
}

fn composer(data: &PrototypeData) -> Div {
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
            div().flex().flex_row().gap(px(5.0)).children(
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
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_1()
                        .h(px(38.0))
                        .rounded_lg()
                        .bg(theme::surface_2())
                        .border_1()
                        .border_color(theme::border())
                        .px(px(12.0))
                        .flex()
                        .items_center()
                        .text_size(px(12.0))
                        .text_color(rgb(0x777786))
                        .child("Send a message... (Enter↵ to send, Shift+Enter for newline)"),
                )
                .child(
                    div()
                        .w(px(28.0))
                        .h(px(28.0))
                        .rounded_md()
                        .text_color(theme::text_muted())
                        .flex()
                        .items_center()
                        .justify_center()
                        .child("☺"),
                )
                .child(
                    div()
                        .w(px(34.0))
                        .h(px(34.0))
                        .rounded_lg()
                        .bg(theme::accent_strong())
                        .text_color(theme::text_primary())
                        .flex()
                        .items_center()
                        .justify_center()
                        .child("➤"),
                ),
        )
}

fn status_chip(chip: &StreamChip, accent_bg: bool) -> Div {
    div()
        .rounded_full()
        .px(px(8.0))
        .py(px(3.0))
        .bg(if accent_bg {
            rgb(0x1c1b22)
        } else {
            theme::surface_2()
        })
        .border_1()
        .border_color(if chip.live {
            theme::platform_color(chip.platform)
        } else {
            theme::border()
        })
        .text_size(px(11.0))
        .text_color(theme::text_primary())
        .child(match chip.viewer_count {
            Some(count) => format!("● {} {}", chip.channel_name, format_viewers(count)),
            None => format!("● {}", chip.channel_name),
        })
}

fn header_chip(chip: &StreamChip) -> Div {
    div()
        .rounded_full()
        .px(px(8.0))
        .py(px(3.0))
        .bg(theme::surface_2())
        .border_1()
        .border_color(theme::border())
        .text_color(theme::text_primary())
        .text_size(px(11.0))
        .child(match chip.viewer_count {
            Some(count) => format!("● {} {}", chip.channel_name, format_viewers(count)),
            None => format!("● {}", chip.channel_name),
        })
}

fn message_row(message: &ChatMessage) -> Div {
    if message.system {
        return div()
            .w_full()
            .px(px(12.0))
            .py(px(1.0))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .child(div().w(px(2.0)).h(px(20.0)).bg(theme::green()))
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(rgb(0x8eb79b))
                    .child(message.text.clone()),
            );
    }

    div()
        .w_full()
        .px(px(12.0))
        .py(px(0.5))
        .flex()
        .flex_row()
        .items_start()
        .gap(px(6.0))
        .child(
            div()
                .w(px(2.0))
                .h(px(20.0))
                .bg(theme::platform_color(message.platform)),
        )
        .child(
            div()
                .text_size(px(9.0))
                .text_color(theme::text_muted())
                .child(message.timestamp.clone()),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme::platform_color(message.platform))
                .child(message.platform.glyph()),
        )
        .child(
            div()
                .text_size(px(12.0))
                .text_color(rgb(message.author_color_hex))
                .child(format!("{}:", message.author)),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .gap(px(2.0))
                .children(message.badges.iter().map(|badge| {
                    div()
                        .rounded_md()
                        .px(px(3.0))
                        .py(px(0.5))
                        .bg(rgb(0x25252f))
                        .text_color(theme::text_muted())
                        .text_size(px(8.0))
                        .child(badge.clone())
                })),
        )
        .child(
            div()
                .flex_1()
                .text_size(px(12.0))
                .text_color(theme::text_primary())
                .child(message.text.clone()),
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
