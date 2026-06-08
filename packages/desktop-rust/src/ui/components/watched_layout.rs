use crate::app_state::{AppState, AppStateActions, OutgoingChatMessageStatus, PaneDropDirection};
use crate::protocol::types::{
    LayoutNode, PanelContent, PlatformStatus, PlatformStatusMode, SplitDirection, WatchedChannel,
    WatchedChannelsLayout,
};
use crate::ui::chat::{AutocompleteUi, MessageRowContext, composer_reply_bar, message_row};
use crate::ui::components::autocomplete_popup::AutocompletePopup;
use crate::ui::components::input::Input;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{Div, Entity, Stateful, div, prelude::*, px, rgb, rgba};
use std::collections::BTreeMap;

#[derive(Clone)]
struct WatchedComposerUi {
    input: Option<Entity<Input>>,
    autocomplete: Option<AutocompleteUi>,
}

#[derive(Clone)]
struct WatchedLayoutDeps<'a> {
    state: &'a AppState,
    state_entity: Entity<AppState>,
    font_size_input: Entity<Input>,
    watched_composer_inputs: &'a BTreeMap<String, Entity<Input>>,
    watched_autocomplete: &'a BTreeMap<String, AutocompleteUi>,
    can_drag_panes: bool,
}

#[derive(Clone)]
struct DraggedPane {
    panel_id: String,
}

pub(crate) fn tab_panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    font_size_input: Entity<Input>,
    watched_composer_inputs: &BTreeMap<String, Entity<Input>>,
    watched_autocomplete: &BTreeMap<String, AutocompleteUi>,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<TwirChatApp>,
) -> Div {
    let active_tab_id = state.active_channel_tab_id().to_string();
    let layout = state
        .watched_layout(&active_tab_id)
        .cloned()
        .unwrap_or_else(|| {
            crate::storage::watched_layout::create_default_tab_layout(&active_tab_id)
        });
    let can_drag_panes = count_layout_panels(&layout.root) > 1;

    div()
        .flex_1()
        .min_w(px(0.0))
        .min_h(px(0.0))
        .flex()
        .bg(theme::background())
        .child(render_layout(
            &layout,
            WatchedLayoutDeps {
                state,
                state_entity,
                font_size_input,
                watched_composer_inputs,
                watched_autocomplete,
                can_drag_panes,
            },
            window,
            cx,
        ))
}

fn render_layout(
    layout: &WatchedChannelsLayout,
    deps: WatchedLayoutDeps<'_>,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<TwirChatApp>,
) -> Div {
    div()
        .flex_1()
        .min_w(px(0.0))
        .min_h(px(0.0))
        .flex()
        .bg(theme::background())
        .child(render_node(&layout.root, deps, window, cx))
}

fn render_node(
    node: &LayoutNode,
    deps: WatchedLayoutDeps<'_>,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<TwirChatApp>,
) -> Stateful<Div> {
    match node {
        LayoutNode::Panel { id, content, .. } => {
            let is_main_panel = matches!(content, PanelContent::Main);
            let panel = match content {
                PanelContent::Main => empty_panel(
                    deps.state_entity.clone(),
                    id,
                    "Main pane",
                    "Watched tabs render channel panes only.",
                    deps.can_drag_panes,
                ),
                PanelContent::Watched { channel_id } => watched_panel(
                    deps.clone(),
                    id,
                    channel_id,
                    WatchedComposerUi {
                        input: deps.watched_composer_inputs.get(channel_id).cloned(),
                        autocomplete: deps.watched_autocomplete.get(channel_id).cloned(),
                    },
                    window,
                    cx,
                ),
                PanelContent::Empty => empty_panel(
                    deps.state_entity.clone(),
                    id,
                    "Empty pane",
                    "Use the plus button in a pane header to add another split.",
                    deps.can_drag_panes,
                ),
            };

            div()
                .id(id.clone())
                .relative()
                .flex_1()
                .min_w(px(0.0))
                .min_h(px(0.0))
                .child(panel)
                .when(!is_main_panel && deps.can_drag_panes, |el| {
                    el.child(pane_drop_zones(deps.state_entity.clone(), id.clone()))
                })
        }
        LayoutNode::Split {
            id,
            direction,
            children,
            ..
        } => {
            let mut container = div()
                .id(id.clone())
                .flex_1()
                .min_w(px(0.0))
                .min_h(px(0.0))
                .flex()
                .gap(px(1.0));

            container = if *direction == SplitDirection::Horizontal {
                container.flex_row()
            } else {
                container.flex_col()
            };

            let mut child_elements = Vec::with_capacity(children.len());
            for child in children {
                child_elements.push(render_node(child, deps.clone(), window, cx));
            }

            container.children(child_elements)
        }
    }
}

fn count_layout_panels(node: &LayoutNode) -> usize {
    match node {
        LayoutNode::Panel { .. } => 1,
        LayoutNode::Split { children, .. } => children.iter().map(count_layout_panels).sum(),
    }
}

fn watched_panel(
    deps: WatchedLayoutDeps<'_>,
    panel_id: &str,
    channel_id: &str,
    composer: WatchedComposerUi,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<TwirChatApp>,
) -> Div {
    let state = deps.state;
    let state_entity = deps.state_entity.clone();
    let font_size_input = deps.font_size_input.clone();
    let settings = state.settings().clone();
    let channel = state
        .watched_channels
        .iter()
        .find(|channel| channel.id == channel_id)
        .cloned();
    let title = channel
        .as_ref()
        .map(|channel| channel.display_name.clone())
        .unwrap_or_else(|| channel_id.to_string());
    let status = channel
        .as_ref()
        .and_then(|channel| state.watched_channel_statuses.get(&channel.id))
        .cloned();
    let accounts = state.platforms_panel.accounts.clone();
    let messages = channel
        .as_ref()
        .map(|channel| collect_panel_messages(state, channel))
        .unwrap_or_default();
    let status_dot = status
        .as_ref()
        .map(|status| match status.status {
            PlatformStatus::Connected => rgb(0x22c55e),
            PlatformStatus::Connecting => rgb(0xf59e0b),
            PlatformStatus::Error => rgb(0xef4444),
            PlatformStatus::Disconnected => theme::text_muted(),
        })
        .unwrap_or(theme::text_muted());
    let mode_label = channel.as_ref().map(|channel| {
        let has_account = accounts
            .iter()
            .any(|account| account.platform == channel.platform);
        match status.as_ref().map(|status| status.mode) {
            Some(PlatformStatusMode::Authenticated) => "authenticated",
            Some(PlatformStatusMode::Anonymous) if !has_account => "read-only",
            Some(PlatformStatusMode::Anonymous) | None => "authenticated",
        }
    });
    let status_label = status.as_ref().map(|status| match status.status {
        PlatformStatus::Connected => "connected",
        PlatformStatus::Connecting => "connecting",
        PlatformStatus::Disconnected => "disconnected",
        PlatformStatus::Error => "error",
    });

    div()
        .size_full()
        .min_w(px(0.0))
        .min_h(px(0.0))
        .bg(theme::background())
        .flex()
        .flex_col()
        .overflow_hidden()
        .child(
            div()
                .w_full()
                .min_h(px(38.0))
                .px(px(12.0))
                .py(px(8.0))
                .border_b_1()
                .border_color(theme::border())
                .flex()
                .flex_row()
                .items_center()
                .justify_between()
                .gap(px(8.0))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(8.0))
                        .when(deps.can_drag_panes, |row| {
                            row.child(pane_drag_handle(panel_id))
                        })
                        .child(div().w(px(7.0)).h(px(7.0)).rounded_full().bg(status_dot))
                        .child(
                            div()
                                .text_color(theme::text_primary())
                                .font_weight(gpui::FontWeight::BOLD)
                                .child(title),
                        )
                        .when_some(mode_label, |row, label| {
                            row.child(
                                div()
                                    .px(px(8.0))
                                    .py(px(2.0))
                                    .rounded_full()
                                    .bg(rgba(0xffffff12))
                                    .text_color(theme::text_muted())
                                    .text_size(px(11.0))
                                    .child(label),
                            )
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(6.0))
                        .when_some(status_label, |row, label| {
                            row.child(
                                div()
                                    .text_color(theme::text_muted())
                                    .text_size(px(11.0))
                                    .child(label),
                            )
                        })
                        .child(
                            div()
                                .relative()
                                .child(
                                    action_button("⚙")
                                        .bg(
                                            if state.chat_appearance_popover_open.as_deref()
                                                == Some(panel_id)
                                            {
                                                rgba(0x2a2a33ff)
                                            } else {
                                                rgba(0x00000000)
                                            },
                                        )
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            let panel_id = panel_id.to_string();
                                            move |_event, _window, cx| {
                                                state_entity.update(cx, |state, cx| {
                                                    state.toggle_chat_appearance_popover(&panel_id);
                                                    cx.notify();
                                                });
                                            }
                                        }),
                                )
                                .when(
                                    state.chat_appearance_popover_open.as_deref() == Some(panel_id),
                                    |el| {
                                        el.child(crate::ui::chat::render_appearance_popover(
                                            state_entity.clone(),
                                            font_size_input.clone(),
                                            settings.clone(),
                                        ))
                                    },
                                ),
                        )
                        .child(action_button("+").on_click({
                            let state_entity = state_entity.clone();
                            move |_event, _window, cx| {
                                state_entity.add_chat_pane_for_active_tab(cx);
                            }
                        }))
                        .child(action_button("Change").on_click({
                            let state_entity = state_entity.clone();
                            let panel_id = panel_id.to_string();
                            move |_event, _window, cx| {
                                state_entity.open_add_channel_modal_for_panel(cx, &panel_id);
                            }
                        }))
                        .child(action_button("×").on_click({
                            let state_entity = state_entity.clone();
                            let panel_id = panel_id.to_string();
                            move |_event, _window, cx| {
                                state_entity.remove_chat_pane_for_active_tab(cx, &panel_id);
                            }
                        })),
                ),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .min_h(px(0.0))
                .id(format!("watched-pane-scroll-{channel_id}"))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .children(if messages.is_empty() {
                    vec![
                        div()
                            .flex_1()
                            .min_h(px(0.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(theme::text_muted())
                            .text_size(px(12.0))
                            .child(match status.as_ref().map(|status| status.status) {
                                Some(PlatformStatus::Connecting) => "Connecting...",
                                _ => "No messages yet",
                            })
                            .into_any_element(),
                    ]
                } else {
                    let reply_focus_input = composer.input.clone();
                    let mut elements: Vec<gpui::AnyElement> =
                        vec![div().flex_1().min_h(px(0.0)).into_any_element()];
                    elements.extend(messages.into_iter().map(|message| {
                        watched_message_row(
                            &message,
                            &settings,
                            &accounts,
                            reply_focus_input.clone(),
                            window,
                            cx,
                            state_entity.clone(),
                        )
                    }));
                    elements
                }),
        )
        .when_some(composer.input, |panel, composer_input| {
            panel.child(watched_composer(
                state,
                state_entity,
                channel_id.to_string(),
                composer_input,
                composer.autocomplete,
                cx.entity(),
            ))
        })
}

fn empty_panel(
    state_entity: Entity<AppState>,
    panel_id: &str,
    title: &str,
    description: &str,
    can_drag_panes: bool,
) -> Div {
    let panel_id = panel_id.to_string();
    div()
        .size_full()
        .bg(theme::background())
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .relative()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(10.0))
                .when(can_drag_panes, |card| {
                    card.child(pane_drag_handle(&panel_id))
                })
                .child(
                    div()
                        .w(px(40.0))
                        .h(px(40.0))
                        .rounded_lg()
                        .bg(theme::surface_2())
                        .border_1()
                        .border_color(theme::border())
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme::text_muted())
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::surface()))
                        .child("+")
                        .on_mouse_down(gpui::MouseButton::Left, {
                            let state_entity = state_entity.clone();
                            let panel_id = panel_id.clone();
                            move |_event, _window, app| {
                                state_entity.open_add_channel_modal_for_panel(app, &panel_id);
                            }
                        }),
                )
                .child(
                    div()
                        .absolute()
                        .top(px(-6.0))
                        .right(px(-26.0))
                        .w(px(18.0))
                        .h(px(18.0))
                        .rounded_md()
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .text_color(theme::text_muted())
                        .hover(|s| s.bg(theme::surface()).text_color(theme::text_primary()))
                        .child("×")
                        .on_mouse_down(gpui::MouseButton::Left, move |_event, _window, app| {
                            state_entity.remove_chat_pane_for_active_tab(app, &panel_id);
                        }),
                )
                .child(
                    div()
                        .text_color(theme::text_primary())
                        .font_weight(gpui::FontWeight::BOLD)
                        .child(title.to_string()),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .text_size(px(12.0))
                        .child(description.to_string()),
                ),
        )
}

fn pane_drop_zones(state_entity: Entity<AppState>, target_id: String) -> Div {
    div()
        .absolute()
        .top(px(0.0))
        .right(px(0.0))
        .bottom(px(0.0))
        .left(px(0.0))
        .flex()
        .flex_col()
        .child(pane_drop_target(
            state_entity.clone(),
            target_id.clone(),
            PaneDropDirection::Top,
        ))
        .child(pane_horizontal_drop_row(
            state_entity.clone(),
            target_id.clone(),
        ))
        .child(pane_horizontal_drop_row(
            state_entity.clone(),
            target_id.clone(),
        ))
        .child(pane_horizontal_drop_row(
            state_entity.clone(),
            target_id.clone(),
        ))
        .child(pane_drop_target(
            state_entity,
            target_id,
            PaneDropDirection::Bottom,
        ))
}

fn pane_horizontal_drop_row(state_entity: Entity<AppState>, target_id: String) -> Div {
    div()
        .flex_1()
        .min_h(px(0.0))
        .flex()
        .flex_row()
        .child(pane_drop_target(
            state_entity.clone(),
            target_id.clone(),
            PaneDropDirection::Left,
        ))
        .child(pane_drop_target(
            state_entity,
            target_id,
            PaneDropDirection::Right,
        ))
}

fn pane_drop_target(
    state_entity: Entity<AppState>,
    target_id: String,
    direction: PaneDropDirection,
) -> Div {
    let target_for_drop = target_id.clone();
    div()
        .flex_1()
        .min_w(px(0.0))
        .min_h(px(0.0))
        .opacity(0.0)
        .border_2()
        .border_color(rgba(0x5865f200))
        .bg(rgba(0x5865f200))
        .flex()
        .items_center()
        .justify_center()
        .drag_over::<DraggedPane>(move |style, dragged, _, _| {
            if dragged.panel_id == target_id {
                style
            } else {
                style
                    .opacity(1.0)
                    .bg(rgba(0x5865f25a))
                    .border_1()
                    .border_color(rgba(0x5865f2cc))
            }
        })
        .on_drop::<DraggedPane>(move |dragged, _window, app| {
            state_entity.move_chat_pane_for_active_tab(
                app,
                &dragged.panel_id,
                &target_for_drop,
                direction,
            );
        })
        .child(pane_drop_hint(direction))
}

fn pane_drag_handle(panel_id: &str) -> Stateful<Div> {
    div()
        .id(format!("pane-drag-handle-{panel_id}"))
        .h(px(24.0))
        .min_w(px(30.0))
        .px(px(6.0))
        .rounded_md()
        .border_1()
        .border_color(theme::border())
        .bg(theme::surface_2())
        .text_color(theme::text_muted())
        .text_size(px(11.0))
        .font_weight(gpui::FontWeight::BOLD)
        .flex()
        .items_center()
        .justify_center()
        .cursor_move()
        .hover(|s| s.bg(theme::surface()).text_color(theme::text_primary()))
        .child(pane_drag_grip_icon())
        .on_drag(
            DraggedPane {
                panel_id: panel_id.to_string(),
            },
            |_, _, _, cx| cx.new(|_| gpui::Empty),
        )
}

fn pane_drag_grip_icon() -> Div {
    div()
        .flex()
        .flex_row()
        .gap(px(3.0))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(pane_drag_dot())
                .child(pane_drag_dot())
                .child(pane_drag_dot()),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(pane_drag_dot())
                .child(pane_drag_dot())
                .child(pane_drag_dot()),
        )
}

fn pane_drag_dot() -> Div {
    div()
        .w(px(3.0))
        .h(px(3.0))
        .rounded_full()
        .bg(theme::text_muted())
}

fn pane_drop_hint(direction: PaneDropDirection) -> Div {
    let label = match direction {
        PaneDropDirection::Left => "Drop left",
        PaneDropDirection::Right => "Drop right",
        PaneDropDirection::Top => "Drop top",
        PaneDropDirection::Bottom => "Drop bottom",
    };

    div()
        .px(px(8.0))
        .py(px(3.0))
        .rounded_md()
        .bg(theme::surface_2())
        .text_color(theme::text_primary())
        .text_size(px(11.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .child(label)
}

fn collect_panel_messages(
    state: &AppState,
    channel: &WatchedChannel,
) -> Vec<crate::protocol::types::NormalizedChatMessage> {
    if let Some(messages) = state.watched_channel_messages.get(&channel.id) {
        return messages.clone();
    }

    let mut messages = state
        .messages
        .iter()
        .filter(|message| {
            message.platform == channel.platform
                && (message.channel_id == channel.id
                    || message
                        .channel_id
                        .eq_ignore_ascii_case(&channel.channel_slug))
        })
        .cloned()
        .collect::<Vec<_>>();

    if messages.len() > 120 {
        let start = messages.len() - 120;
        messages = messages.split_off(start);
    }

    messages
}

fn watched_message_row(
    message: &crate::protocol::types::NormalizedChatMessage,
    settings: &crate::protocol::types::AppSettings,
    accounts: &[crate::protocol::types::Account],
    reply_focus_input: Option<Entity<Input>>,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<crate::app::TwirChatApp>,
    state_entity: gpui::Entity<crate::app_state::AppState>,
) -> gpui::AnyElement {
    let status = state_entity.read(cx).outgoing_message_status(&message.id);
    let row = message_row(
        message,
        settings,
        accounts,
        window,
        cx,
        MessageRowContext::watched(state_entity, reply_focus_input),
    );

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

fn watched_composer(
    state: &AppState,
    state_entity: Entity<AppState>,
    channel_id: String,
    composer_input: Entity<Input>,
    autocomplete: Option<AutocompleteUi>,
    app_entity: Entity<TwirChatApp>,
) -> Div {
    let reply_target = state.watched_reply_target(&channel_id).cloned();

    div()
        .w_full()
        .h(px(if reply_target.is_some() { 88.0 } else { 58.0 }))
        .relative()
        .child(
            div()
                .absolute()
                .size_full()
                .border_t_1()
                .border_color(theme::border()),
        )
        .child(
            div()
                .size_full()
                .px(px(10.0))
                .py(px(10.0))
                .flex()
                .flex_col()
                .justify_center()
                .gap(px(6.0))
                .when_some(reply_target, |body, target| {
                    body.child(composer_reply_bar(
                        &target,
                        format!("watched-reply-target-cancel-{channel_id}"),
                        {
                            let state_entity = state_entity.clone();
                            let channel_id = channel_id.clone();
                            move |_event, _window, cx| {
                                state_entity.update(cx, |state, cx| {
                                    state.cancel_watched_reply_target(&channel_id);
                                    cx.notify();
                                });
                            }
                        },
                    ))
                })
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .rounded_md()
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
                                .w(px(36.0))
                                .h(px(36.0))
                                .rounded_md()
                                .bg(theme::accent_strong())
                                .text_color(theme::text_primary())
                                .flex()
                                .items_center()
                                .justify_center()
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(0x6d28d9)))
                                .child("➤")
                                .on_mouse_down(gpui::MouseButton::Left, move |_, _, app| {
                                    let text = composer_input.read(app).text().to_string();
                                    if state_entity.queue_watched_channel_send(
                                        app,
                                        &channel_id,
                                        &text,
                                    ) {
                                        composer_input.update(app, |input, cx| input.clear(cx));
                                    }
                                }),
                        ),
                ),
        )
}

fn action_button(icon: &'static str) -> Stateful<Div> {
    div()
        .id(icon)
        .min_w(px(26.0))
        .h(px(26.0))
        .px(px(7.0))
        .rounded_md()
        .flex()
        .items_center()
        .justify_center()
        .text_color(theme::text_muted())
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .cursor_pointer()
        .hover(|s| s.bg(rgb(0x2a2a33)).text_color(theme::text_primary()))
        .child(icon)
}
