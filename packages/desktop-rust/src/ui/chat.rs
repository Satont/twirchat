use crate::app_state::{AppState, AppStateActions};
use crate::protocol::types::{
    AppSettings, ChatMessageType, ChatTheme, NormalizedChatMessage, Platform, WatchedChannel,
};
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::components::switch::Switch;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{
    AnyElement, Context, Div, Entity, Stateful, div, img, prelude::*, px, rgb, rgba, uniform_list,
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
            state,
            state_entity,
        ))
        .child(
            div().flex_1().bg(theme::background()).child(
                {
                    let messages = state.messages.clone();
                    let settings = state.settings().clone();
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
                                    .map(|msg| message_row(msg, &settings).into_any_element())
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
    state: &AppState,
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
                                    panel_action_btn("+", true)
                                        .bg(if state.chat_add_menu_open {
                                            gpui::rgba(0x2a2a33ff)
                                        } else {
                                            gpui::rgba(0x00000000)
                                        })
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, cx| {
                                                state_entity.update(cx, |state, cx| {
                                                    state.toggle_chat_add_menu();
                                                    cx.notify();
                                                });
                                            }
                                        }),
                                )
                                .when(state.chat_add_menu_open, |el| {
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
                                            .p(px(4.0))
                                            .child(
                                                div()
                                                    .px(px(8.0))
                                                    .py(px(4.0))
                                                    .text_size(px(11.0))
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(theme::text_muted())
                                                    .child("ADD"),
                                            )
                                            .child(popover_btn("Add chat pane (Split)", {
                                                let state_entity = state_entity.clone();
                                                move |_event, _window, cx| {
                                                    state_entity.add_chat_pane_for_active_tab(cx);
                                                }
                                            }))
                                            .children(state.platforms_panel.accounts.iter().map({
                                                let state_entity = state_entity.clone();
                                                move |account| {
                                                    let account_id = account.id.clone();
                                                    let label = format!(
                                                        "Watch {} ({})",
                                                        account.display_name, account.username
                                                    );
                                                    add_menu_row(label, {
                                                        let state_entity = state_entity.clone();
                                                        move |_event, _window, app| {
                                                            state_entity.add_watched_channel_from_account(
                                                                app,
                                                                &account_id,
                                                            );
                                                        }
                                                    })
                                                }
                                            }))
                                            .when(state.platforms_panel.accounts.is_empty(), |this| {
                                                this.child(
                                                    div()
                                                        .px(px(8.0))
                                                        .py(px(6.0))
                                                        .text_size(px(12.0))
                                                        .text_color(theme::text_muted())
                                                        .child("No connected accounts"),
                                                )
                                            }),
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
fn message_row(message: &NormalizedChatMessage, settings: &AppSettings) -> Div {
    let is_compact = settings.chat_theme == ChatTheme::Compact;
    let _is_modern = settings.chat_theme == ChatTheme::Modern;
    let v_pad = if is_compact { 2.0 } else { 4.0 };

    if message.message_type == ChatMessageType::System {
        return div()
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
                    .text_size(px(14.0))
                    .text_color(theme::text_muted())
                    .child(message.text.clone()),
            )
            .when(settings.show_timestamp, |el| {
                el.child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme::text_muted())
                        .child(message.timestamp.clone()),
                )
            });
    }

    div()
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
            el.child(
                div()
                    .w(px(28.0))
                    .h(px(28.0))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(rgb(0x8b8b99))
                    .text_color(theme::text_primary())
                    .text_size(px(11.0))
                    .font_weight(gpui::FontWeight::BOLD)
                    .child(if let Some(url) = &message.author.avatar_url {
                        img(url.clone())
                            .w_full()
                            .h_full()
                            .rounded_full()
                            .into_any_element()
                    } else {
                        message
                            .author
                            .display_name
                            .chars()
                            .next()
                            .unwrap_or('?')
                            .to_uppercase()
                            .to_string()
                            .into_any_element()
                    }),
            )
        })
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
                        .when(settings.show_platform_icon, |el| {
                            el.child(
                                PlatformIcon::new(to_model_platform(message.platform))
                                    .size(px(13.0)),
                            )
                        })
                        .when(settings.show_badges, |el| {
                            el.children(message.author.badges.iter().map(|badge| {
                                if let Some(url) = &badge.image_url {
                                    div()
                                        .w(px(18.0))
                                        .h(px(18.0))
                                        .child(img(url.clone()).w_full().h_full())
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
                            }))
                        })
                        .child(
                            div()
                                .text_color(rgb(0x8b8b99))
                                .text_size(px(13.0))
                                .font_weight(gpui::FontWeight::BOLD)
                                .child(message.author.display_name.clone()),
                        )
                        .when(settings.show_timestamp, |el| {
                            el.child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme::text_muted())
                                    .child(message.timestamp.clone()),
                            )
                        }),
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

fn add_menu_row(
    label: impl Into<gpui::SharedString>,
    on_click: impl Fn(&gpui::MouseDownEvent, &mut gpui::Window, &mut gpui::App) + 'static,
) -> Div {
    let label: gpui::SharedString = label.into();

    div()
        .w_full()
        .px(px(8.0))
        .py(px(6.0))
        .rounded_sm()
        .text_color(theme::text_primary())
        .text_size(px(13.0))
        .cursor_pointer()
        .hover(|s| s.bg(rgba(0xffffff1a)))
        .child(label)
        .on_mouse_down(gpui::MouseButton::Left, on_click)
}
