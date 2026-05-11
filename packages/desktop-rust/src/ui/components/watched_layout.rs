use crate::protocol::types::{LayoutNode, PanelContent, SplitDirection, WatchedChannelsLayout};
use crate::ui::theme;
use gpui::{Div, Stateful, div, prelude::*, px};

pub fn render_layout(layout: &WatchedChannelsLayout) -> Div {
    div()
        .flex_1()
        .flex()
        .flex_row()
        .bg(theme::background())
        .child(render_node(&layout.root))
}

fn render_node(node: &LayoutNode) -> Stateful<Div> {
    match node {
        LayoutNode::Panel {
            id,
            content,
            flex: _,
        } => {
            let content_div = match content {
                PanelContent::Main => render_chat_panel("Main Chat", None),
                PanelContent::Watched { channel_id } => {
                    render_chat_panel(channel_id, Some(theme::accent()))
                }
                PanelContent::Empty => div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(theme::surface_2())
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .w(px(48.0))
                                    .h(px(48.0))
                                    .rounded_lg()
                                    .bg(theme::surface())
                                    .border_1()
                                    .border_color(theme::border())
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(div().text_color(theme::text_muted()).child("+")),
                            )
                            .child(
                                div()
                                    .text_color(theme::text_muted())
                                    .child("Select a channel to watch"),
                            ),
                    ),
            };
            div()
                .id(id.clone())
                .flex_grow()
                .flex()
                .flex_col()
                .border_1()
                .border_color(theme::border())
                .child(content_div)
        }
        LayoutNode::Split {
            id,
            direction,
            children,
            flex: _,
            ..
        } => {
            let mut container = div().id(id.clone()).flex_grow().flex();
            if *direction == SplitDirection::Horizontal {
                container = container.flex_row();
            } else {
                container = container.flex_col();
            }
            container.children(children.iter().map(render_node))
        }
    }
}

fn render_chat_panel(title: &str, dot_color: Option<gpui::Rgba>) -> Div {
    div()
        .flex_1()
        .flex()
        .flex_col()
        .child(
            div()
                .w_full()
                .h(px(40.0))
                .bg(theme::surface())
                .border_b_1()
                .border_color(theme::border())
                .flex()
                .items_center()
                .justify_between()
                .px(px(12.0))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(8.0))
                        .when_some(dot_color, |this, color| {
                            this.child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(color))
                        })
                        .child(
                            div()
                                .text_color(theme::text_primary())
                                .font_weight(gpui::FontWeight::BOLD)
                                .child(title.to_string()),
                        ),
                )
                .child(
                    div().flex().flex_row().items_center().gap(px(4.0)).child(
                        div()
                            .px(px(6.0))
                            .py(px(2.0))
                            .rounded_md()
                            .bg(theme::surface_2())
                            .text_color(theme::text_muted())
                            .text_size(px(12.0))
                            .child("1.2k"),
                    ),
                ),
        )
        .child(
            div()
                .flex_1()
                .bg(theme::background())
                .flex()
                .flex_col()
                .justify_end()
                .p(px(12.0))
                .gap(px(8.0))
                .child(render_mock_message(
                    "user1",
                    "Hello everyone!",
                    gpui::rgb(0xff0000),
                ))
                .child(render_mock_message(
                    "mod_user",
                    "Welcome to the stream!",
                    gpui::rgb(0x00ff00),
                ))
                .child(render_mock_message(
                    "viewer99",
                    "PogChamp",
                    gpui::rgb(0x0000ff),
                ))
                .child(
                    div()
                        .w_full()
                        .mt(px(8.0))
                        .p(px(8.0))
                        .rounded_md()
                        .bg(theme::surface())
                        .border_1()
                        .border_color(theme::border())
                        .text_color(theme::text_muted())
                        .child("Send a message..."),
                ),
        )
}

fn render_mock_message(author: &str, content: &str, color: gpui::Rgba) -> Div {
    div()
        .flex()
        .flex_row()
        .items_start()
        .gap(px(6.0))
        .child(
            div()
                .text_color(color)
                .font_weight(gpui::FontWeight::BOLD)
                .child(author.to_string()),
        )
        .child(
            div()
                .text_color(theme::text_primary())
                .child(content.to_string()),
        )
}
