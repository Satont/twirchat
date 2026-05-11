use crate::protocol::types::{LayoutNode, PanelContent, SplitDirection, WatchedChannelsLayout};
use gpui::{Div, Stateful, div, prelude::*};

pub fn render_layout(layout: &WatchedChannelsLayout) -> Div {
    div()
        .flex_1()
        .flex()
        .flex_row()
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
                PanelContent::Main => div().child("Main Chat"),
                PanelContent::Watched { channel_id } => {
                    div().child(format!("Watched: {}", channel_id))
                }
                PanelContent::Empty => div().child("Empty Panel"),
            };
            div()
                .id(id.clone())
                .flex_grow()
                .border_1()
                .border_color(gpui::rgb(0x333333))
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
