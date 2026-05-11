use crate::app_state::{AppState, MainSection};
use crate::protocol::types::{LayoutNode, PanelContent, SplitDirection};
use crate::storage::watched_layout::create_default_tab_layout;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::shell::tabs;
use crate::ui::theme;
use crate::ui::{chat, events, platforms, settings};
use gpui::{Context, Div, Entity, div, prelude::*, px};

pub(crate) fn panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match state.active_section() {
        MainSection::Chat => {
            let active_id = state.active_channel_tab_id();

            // Home tab should only render chat, not a watched layout
            let chat_content = if active_id == "home" {
                chat::panel(state, state_entity.clone(), cx)
            } else {
                let fallback_layout = create_default_tab_layout(active_id);
                let layout = state.watched_layout(active_id).unwrap_or(&fallback_layout);
                render_layout(layout, state, state_entity.clone(), cx)
            };

            div()
                .flex_1()
                .flex()
                .flex_col()
                .bg(theme::background())
                .child(tabs::bar(state, state_entity.clone()))
                .child(chat_content)
        }
        MainSection::Events => events::panel(state),
        MainSection::Platforms => platforms::panel(&state.platforms_panel),
        MainSection::Settings => settings::panel(state, state_entity.clone()),
    }
}

fn render_layout(
    layout: &crate::protocol::types::WatchedChannelsLayout,
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    render_node(&layout.root, state, state_entity, cx)
}

fn render_node(
    node: &LayoutNode,
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match node {
        LayoutNode::Split {
            direction,
            children,
            ..
        } => div()
            .flex_1()
            .w_full()
            .flex()
            .when(matches!(direction, SplitDirection::Horizontal), |this| {
                this.flex_row()
            })
            .when(matches!(direction, SplitDirection::Vertical), |this| {
                this.flex_col()
            })
            .children(
                children
                    .iter()
                    .map(|child| render_node(child, state, state_entity.clone(), cx)),
            ),
        LayoutNode::Panel { content, .. } => render_panel(content, state, state_entity, cx),
    }
}

fn render_panel(
    content: &PanelContent,
    state: &AppState,
    state_entity: Entity<AppState>,
    cx: &mut Context<TwirChatApp>,
) -> Div {
    match content {
        PanelContent::Main => chat::panel(state, state_entity, cx),
        PanelContent::Watched { channel_id } => div()
            .flex_1()
            .min_w(px(240.0))
            .border_r_1()
            .border_color(theme::border())
            .child(
                div()
                    .w_full()
                    .px(px(12.0))
                    .py(px(6.0))
                    .bg(theme::surface_2())
                    .text_size(px(12.0))
                    .text_color(theme::text_muted())
                    .child(format!("Watched channel: {channel_id}")),
            )
            .child(chat::panel(state, state_entity, cx)),
        PanelContent::Empty => div()
            .flex_1()
            .min_w(px(240.0))
            .bg(theme::background())
            .border_1()
            .border_color(theme::border())
            .flex()
            .items_center()
            .justify_center()
            .text_color(theme::text_muted())
            .child("Empty watched panel"),
    }
}
