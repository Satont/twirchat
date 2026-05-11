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
                PanelContent::Main => div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .w_full()
                            .h(px(36.0))
                            .bg(theme::surface())
                            .border_b_1()
                            .border_color(theme::border())
                            .flex()
                            .items_center()
                            .px(px(12.0))
                            .child(
                                div()
                                    .text_color(theme::text_primary())
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .child("Main Chat"),
                            ),
                    )
                    .child(
                        div().flex_1().bg(theme::background()).p(px(12.0)).child(
                            div()
                                .text_color(theme::text_muted())
                                .child("Messages will appear here..."),
                        ),
                    ),
                PanelContent::Watched { channel_id } => div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .w_full()
                            .h(px(36.0))
                            .bg(theme::surface())
                            .border_b_1()
                            .border_color(theme::border())
                            .flex()
                            .items_center()
                            .px(px(12.0))
                            .child(
                                div()
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .gap(px(8.0))
                                    .child(
                                        div()
                                            .w(px(12.0))
                                            .h(px(12.0))
                                            .rounded_full()
                                            .bg(theme::accent()),
                                    )
                                    .child(
                                        div()
                                            .text_color(theme::text_primary())
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .child(channel_id.clone()),
                                    ),
                            ),
                    )
                    .child(
                        div().flex_1().bg(theme::background()).p(px(12.0)).child(
                            div()
                                .text_color(theme::text_muted())
                                .child("Waiting for events..."),
                        ),
                    ),
                PanelContent::Empty => div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(theme::surface_2())
                    .child(div().text_color(theme::text_muted()).child("No content")),
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
