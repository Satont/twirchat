use crate::app_state::{AppState, AppStateActions};
use crate::protocol::types::{
    Account, AppSettings, ChatMessageType, ChatTheme, NormalizedChatMessage, Platform,
    PlatformStatus,
};
use crate::ui::components::input::Input;
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::components::selectable_message::{SelectableMessage, SelectableMessagePart};
use crate::ui::components::switch::Switch;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{
    AnyElement, App, Context, Div, Entity, FollowMode, ImageSource, ListSizingBehavior, ListState,
    ObjectFit, Stateful, Window, div, img, list, prelude::*, px, rgb, rgba,
};
use std::path::Path;
use ui::WithScrollbar;
use url::Url;

pub(crate) struct ChatScrollUi<'a> {
    pub list_state: &'a ListState,
    pub paused: bool,
}

pub(crate) struct ChatPanelProps<'a> {
    pub state_entity: Entity<AppState>,
    pub composer_input: Entity<Input>,
    pub composer_text: String,
    pub scroll_ui: ChatScrollUi<'a>,
}

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
                .child(
                    list(props.scroll_ui.list_state.clone(), move |ix, window, cx| {
                        message_row(&messages[ix], &settings, &accounts, window, cx)
                            .into_any_element()
                    })
                    .with_sizing_behavior(ListSizingBehavior::Auto)
                    .size_full(),
                ),
        )
        .child(composer(
            state,
            props.state_entity.clone(),
            props.composer_input,
            props.composer_text,
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
                )),
        )
}

fn header(message_count: usize, state: &AppState, state_entity: Entity<AppState>) -> Div {
    let message_count_text = format!("{} messages", message_count);
    let home_targets = home_chat_targets(state);

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
                                        .bg(if state.chat_appearance_popover_open {
                                            gpui::rgba(0x2a2a33ff)
                                        } else {
                                            gpui::rgba(0x00000000)
                                        })
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, cx| {
                                                eprintln!("[ui/chat] appearance popover clicked");
                                                state_entity.update(cx, |state, cx| {
                                                    state.toggle_chat_appearance_popover();
                                                    cx.notify();
                                                });
                                            }
                                        }),
                                )
                                .when(state.chat_appearance_popover_open, |el| {
                                    let settings = state.settings().clone();
                                    el.child(
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
                                                    .child("Appearance") // ChatAppearancePopover
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
                                                            .bg(
                                                                if settings.chat_theme
                                                                    == ChatTheme::Modern
                                                                {
                                                                    theme::surface_2()
                                                                } else {
                                                                    gpui::rgba(0x00000000)
                                                                },
                                                            )
                                                            .text_color(
                                                                if settings.chat_theme
                                                                    == ChatTheme::Modern
                                                                {
                                                                    theme::text_primary()
                                                                } else {
                                                                    theme::text_muted()
                                                                },
                                                            )
                                                            .cursor_pointer()
                                                            .child("Modern")
                                                            .on_mouse_down(
                                                                gpui::MouseButton::Left,
                                                                {
                                                                    let state_entity =
                                                                        state_entity.clone();
                                                                    move |_, _, cx| {
                                                                        state_entity.set_chat_theme(
                                                                            cx,
                                                                            ChatTheme::Modern,
                                                                        )
                                                                    }
                                                                },
                                                            ),
                                                    )
                                                    .child(
                                                        div()
                                                            .px(px(8.0))
                                                            .py(px(2.0))
                                                            .text_size(px(12.0))
                                                            .bg(
                                                                if settings.chat_theme
                                                                    == ChatTheme::Compact
                                                                {
                                                                    theme::surface_2()
                                                                } else {
                                                                    gpui::rgba(0x00000000)
                                                                },
                                                            )
                                                            .text_color(
                                                                if settings.chat_theme
                                                                    == ChatTheme::Compact
                                                                {
                                                                    theme::text_primary()
                                                                } else {
                                                                    theme::text_muted()
                                                                },
                                                            )
                                                            .cursor_pointer()
                                                            .child("Compact")
                                                            .on_mouse_down(
                                                                gpui::MouseButton::Left,
                                                                {
                                                                    let state_entity =
                                                                        state_entity.clone();
                                                                    move |_, _, cx| {
                                                                        state_entity.set_chat_theme(
                                                                            cx,
                                                                            ChatTheme::Compact,
                                                                        )
                                                                    }
                                                                },
                                                            ),
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
                                                            .on_mouse_down(
                                                                gpui::MouseButton::Left,
                                                                {
                                                                    let state_entity =
                                                                        state_entity.clone();
                                                                    let fs = settings.font_size;
                                                                    move |_, _, cx| {
                                                                        state_entity.set_font_size(
                                                                            cx,
                                                                            (fs - 1.0).max(10.0),
                                                                        )
                                                                    }
                                                                },
                                                            ),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_size(px(12.0))
                                                            .text_color(theme::text_primary())
                                                            .child(format!(
                                                                "{}px",
                                                                settings.font_size
                                                            )),
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
                                                            .on_mouse_down(
                                                                gpui::MouseButton::Left,
                                                                {
                                                                    let state_entity =
                                                                        state_entity.clone();
                                                                    let fs = settings.font_size;
                                                                    move |_, _, cx| {
                                                                        state_entity.set_font_size(
                                                                            cx,
                                                                            (fs + 1.0).min(30.0),
                                                                        )
                                                                    }
                                                                },
                                                            ),
                                                    ),
                                            ))
                                            .child(div().w_full().h(px(1.0)).bg(theme::border()))
                                            .child(popover_row(
                                                "Show Avatars",
                                                Switch::new(settings.show_avatars).on_click({
                                                    let state_entity = state_entity.clone();
                                                    let current = settings.show_avatars;
                                                    move |_, _, cx| {
                                                        state_entity.set_show_avatars(cx, !current)
                                                    }
                                                }),
                                            ))
                                            .child(popover_row(
                                                "Show Badges",
                                                Switch::new(settings.show_badges).on_click({
                                                    let state_entity = state_entity.clone();
                                                    let current = settings.show_badges;
                                                    move |_, _, cx| {
                                                        state_entity.set_show_badges(cx, !current)
                                                    }
                                                }),
                                            ))
                                            .child(popover_row(
                                                "Platform Icon",
                                                Switch::new(settings.show_platform_icon).on_click(
                                                    {
                                                        let state_entity = state_entity.clone();
                                                        let current = settings.show_platform_icon;
                                                        move |_, _, cx| {
                                                            state_entity.set_show_platform_icon(
                                                                cx, !current,
                                                            )
                                                        }
                                                    },
                                                ),
                                            ))
                                            .child(popover_row(
                                                "Timestamp",
                                                Switch::new(settings.show_timestamp).on_click({
                                                    let state_entity = state_entity.clone();
                                                    let current = settings.show_timestamp;
                                                    move |_, _, cx| {
                                                        state_entity
                                                            .set_show_timestamp(cx, !current)
                                                    }
                                                }),
                                            ))
                                            .child(popover_row(
                                                "Platform Stripe",
                                                Switch::new(settings.show_platform_color_stripe)
                                                    .on_click({
                                                        let state_entity = state_entity.clone();
                                                        let current =
                                                            settings.show_platform_color_stripe;
                                                        move |_, _, cx| {
                                                            state_entity
                                                                .set_show_platform_color_stripe(
                                                                    cx, !current,
                                                                )
                                                        }
                                                    }),
                                            )),
                                    )
                                }),
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
) -> Div {
    let home_targets = home_chat_targets(state);
    let can_send = !composer_text.trim().is_empty()
        && home_targets
            .iter()
            .any(|channel| !state.composer_disabled_channel_ids.contains(&channel.id));

    div()
        .w_full()
        .h(px(104.0))
        .min_h(px(82.0))
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
                .children(home_targets.iter().map({
                    let state_entity = state_entity.clone();
                    move |chip| {
                        let enabled = !state.composer_disabled_channel_ids.contains(&chip.id);
                        status_chip(chip, enabled, state_entity.clone())
                    }
                })),
        )
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
                        .flex()
                        .items_center()
                        .child(composer_input.clone()),
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
        .child(
            div()
                .max_w(px(80.0))
                .overflow_hidden()
                .child(chip.display_name.clone()),
        )
}

fn header_chip(chip: &HomeChatTarget) -> Div {
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

#[derive(Clone)]
struct HomeChatTarget {
    id: String,
    platform: Platform,
    display_name: String,
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

        targets.push(HomeChatTarget {
            id: format!("{:?}:{}", status.platform, channel_login.to_lowercase()),
            platform: status.platform,
            display_name,
        });
    }

    targets
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

#[allow(dead_code)]
fn message_row(
    message: &NormalizedChatMessage,
    settings: &AppSettings,
    accounts: &[Account],
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let is_compact = settings.chat_theme == ChatTheme::Compact;
    let _is_modern = settings.chat_theme == ChatTheme::Modern;
    let v_pad = if is_compact { 1.0 } else { 2.0 };

    if message.message_type == ChatMessageType::System {
        return div()
            .id(format!("message-row-{}", message.id))
            .w_full()
            .px(px(14.0))
            .py(px(v_pad))
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
                    .text_size(px(settings.font_size as f32))
                    .text_color(theme::text_muted())
                    .child(selectable_message(
                        format!("system-message-text-{}", message.id),
                        message,
                        vec![SelectableMessagePart::Text {
                            text: message.text.clone().into(),
                            source_range: 0..message.text.len(),
                            is_link: false,
                        }],
                        settings.font_size as f32,
                        window,
                        cx,
                    )),
            )
            .when(settings.show_timestamp, |el| {
                el.child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme::text_muted())
                        .child(message.timestamp.clone()),
                )
            })
            .into_any_element();
    }

    div()
        .id(format!("message-row-{}", message.id))
        .w_full()
        .px(px(14.0))
        .py(px(v_pad))
        .flex()
        .flex_row()
        .items_start()
        .gap(px(8.0))
        .relative()
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
        .when(settings.show_avatars, |el| {
            let avatar_url = message
                .author
                .avatar_url
                .clone()
                .or_else(|| account_avatar_for_message(message, accounts));
            let fallback_name = {
                let dn = message.author.display_name.trim();
                if !dn.is_empty() {
                    dn
                } else if let Some(un) = &message.author.username {
                    let un = un.trim();
                    if !un.is_empty() {
                        un
                    } else {
                        &message.author.id
                    }
                } else {
                    &message.author.id
                }
            };
            let fallback = fallback_name
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
                    .when_some(avatar_url.clone(), |avatar, url| {
                        avatar.child(
                            img(ImageSource::from(url))
                                .id(format!("avatar-{}", message.id))
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
                                    .size(px(12.0))
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
                                            .w(px(14.0))
                                            .h(px(14.0))
                                            .rounded_sm()
                                            .overflow_hidden()
                                            .child(
                                                img(ImageSource::from(Path::new(path)))
                                                    .id(format!(
                                                        "badge-{}-{}-{}",
                                                        message.id, badge.id, index
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
                                            .w(px(14.0))
                                            .h(px(14.0))
                                            .rounded_sm()
                                            .overflow_hidden()
                                            .child(
                                                img(ImageSource::from(url.clone()))
                                                    .id(format!(
                                                        "badge-{}-{}-{}",
                                                        message.id, badge.id, index
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
                                            .text_size(px(10.0))
                                            .child(badge.text.clone())
                                    }
                                },
                            ))
                        })
                        .child(
                            div()
                                .text_color(theme::accent())
                                .text_size(px(12.0))
                                .font_weight(gpui::FontWeight::BOLD)
                                .child({
                                    let dn = message.author.display_name.trim();
                                    if !dn.is_empty() {
                                        dn.to_string()
                                    } else if let Some(un) = &message.author.username {
                                        let un = un.trim();
                                        if !un.is_empty() {
                                            un.to_string()
                                        } else {
                                            message.author.id.clone()
                                        }
                                    } else {
                                        message.author.id.clone()
                                    }
                                }),
                        )
                        .when(settings.show_timestamp, |el| {
                            el.child(
                                div()
                                    .text_size(px(9.0))
                                    .text_color(theme::text_muted())
                                    .child(message.timestamp.clone()),
                            )
                        }),
                )
                .child(message_text_with_emotes(
                    message,
                    settings.font_size as f32,
                    is_compact,
                    window,
                    cx,
                )),
        )
        .into_any_element()
}

fn message_text_with_emotes(
    message: &NormalizedChatMessage,
    font_size: f32,
    is_compact: bool,
    window: &mut Window,
    cx: &mut App,
) -> Div {
    let segments = build_message_segments(message, is_compact);

    div()
        .w_full()
        .min_w(px(0.0))
        .text_size(px(font_size))
        .text_color(theme::text_primary())
        .flex()
        .flex_row()
        .flex_wrap()
        .items_center()
        .whitespace_normal()
        .child(selectable_message(
            format!("message-{}", message.id),
            message,
            segments,
            font_size,
            window,
            cx,
        ))
}

fn selectable_message(
    id: String,
    message: &NormalizedChatMessage,
    parts: Vec<SelectableMessagePart>,
    font_size: f32,
    window: &mut Window,
    cx: &mut App,
) -> Entity<SelectableMessage> {
    let selectable = window.use_keyed_state(id, cx, {
        let message_id = message.id.clone();
        let text = message.text.clone();
        let parts = parts.clone();
        move |_, cx| {
            SelectableMessage::new(
                message_id.clone(),
                text.clone(),
                parts.clone(),
                font_size,
                cx,
            )
        }
    });

    selectable.update(cx, |selectable, cx| {
        selectable.set_content(message.text.clone(), parts, font_size, cx)
    });

    selectable
}

#[derive(Clone)]
struct TextSegmentWithRange {
    text: String,
    is_link: bool,
}

fn build_message_segments(
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

    if !is_link
        && let Some(TextSegmentWithRange {
            text: existing,
            is_link: false,
            ..
        }) = parts.last_mut()
    {
        existing.push_str(&text);
        return;
    }

    parts.push(TextSegmentWithRange { text, is_link });
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
mod tests {
    use super::{MessagePart, TextSegment, build_message_parts, build_text_segments};
    use crate::protocol::types::{
        ChatAuthor, ChatMessageType, Emote, EmotePosition, NormalizedChatMessage, Platform,
    };

    #[test]
    fn build_text_segments_extracts_links_without_swallowing_punctuation() {
        let parts = build_text_segments("go https://example.com, now");

        assert_eq!(parts.len(), 3);
        assert!(matches!(&parts[0], TextSegment::Text(text) if text == "go "));
        assert!(matches!(
            &parts[1],
            TextSegment::Link(text) if text == "https://example.com"
        ));
        assert!(matches!(&parts[2], TextSegment::Text(text) if text == ", now"));
    }

    #[test]
    fn build_text_segments_keeps_plain_text_without_links() {
        let parts = build_text_segments("hello world");

        assert_eq!(parts.len(), 1);
        assert!(matches!(&parts[0], TextSegment::Text(text) if text == "hello world"));
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

        let parts = build_message_parts(&message);

        assert_eq!(parts.len(), 2);
        assert!(matches!(&parts[0], MessagePart::Text(text) if text == "Tg: "));
        assert!(matches!(&parts[1], MessagePart::Link(text) if text == "https://t.me/satontdev"));
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

        let parts = build_message_parts(&message);

        assert_eq!(parts.len(), 4);
        assert!(matches!(&parts[0], MessagePart::Text(text) if text == "А "));
        assert!(matches!(&parts[1], MessagePart::Emote(emote) if emote.name == "che"));
        assert!(matches!(
            &parts[2],
            MessagePart::Text(text) if text == " они так и не пофиксили эту хуйню? "
        ));
        assert!(matches!(
            &parts[3],
            MessagePart::Link(text) if text == "https://al4.dev/6wYTrB"
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

        let parts = build_message_parts(&message);

        assert_eq!(parts.len(), 4);
        assert!(matches!(&parts[0], MessagePart::Text(text) if text == "А "));
        assert!(matches!(&parts[1], MessagePart::Emote(emote) if emote.name == "che"));
        assert!(matches!(
            &parts[2],
            MessagePart::Text(text) if text == " они так и не пофиксили эту хуйню? "
        ));
        assert!(matches!(
            &parts[3],
            MessagePart::Link(text) if text == "https://al4.dev/6wYTrB"
        ));
    }
}
