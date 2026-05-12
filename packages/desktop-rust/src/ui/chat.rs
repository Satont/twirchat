use crate::app_state::{AppState, AppStateActions};
use crate::protocol::types::{
    Account, AppSettings, ChatMessageType, ChatTheme, Emote, NormalizedChatMessage, Platform,
    WatchedChannel,
};
use crate::ui::components::input::Input;
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::components::switch::Switch;
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use base64::Engine;
use gpui::{
    Context, Div, Entity, ImageSource, ObjectFit, Stateful, div, img, prelude::*, px, rgb, rgba,
};

pub(crate) fn panel(
    state: &AppState,
    state_entity: Entity<AppState>,
    composer_input: Entity<Input>,
    add_channel_input: Entity<Input>,
    composer_text: String,
    _cx: &mut Context<TwirChatApp>,
) -> Div {
    let start = state.messages.len().saturating_sub(120);
    let visible_messages = state.messages[start..].to_vec();
    let settings = state.settings().clone();

    div()
        .relative()
        .flex_1()
        .min_h(px(0.0))
        .flex()
        .flex_col()
        .bg(theme::background())
        .child(
            div()
                .id("chat-scroll")
                .flex_1()
                .min_h(px(0.0))
                .mt(px(40.0))
                .bg(theme::background())
                .overflow_y_scroll()
                .child(div().min_h_full().flex().flex_col().justify_end().children(
                    visible_messages.iter().map(|msg| {
                        message_row(msg, &settings, &state.platforms_panel.accounts)
                            .into_any_element()
                    }),
                )),
        )
        .child(composer(
            state,
            state_entity.clone(),
            composer_input,
            composer_text,
        ))
        .child(
            div()
                .absolute()
                .top(px(0.0))
                .left(px(0.0))
                .right(px(0.0))
                .child(header(
                    &state.watched_channels,
                    state.messages.len(),
                    state,
                    state_entity.clone(),
                )),
        )
        .when(state.tab_add_menu_open, |el| {
            el.child(add_channel_modal(
                state,
                state_entity.clone(),
                add_channel_input,
            ))
        })
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
                                    panel_action_btn("+", true)
                                        .bg(if state.chat_add_menu_open {
                                            gpui::rgba(0x2a2a33ff)
                                        } else {
                                            gpui::rgba(0x00000000)
                                        })
                                        .on_click({
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, cx| {
                                                eprintln!("[ui/chat] add menu clicked");
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
                                                            state_entity
                                                                .add_watched_channel_from_account(
                                                                    app,
                                                                    &account_id,
                                                                );
                                                        }
                                                    })
                                                }
                                            }))
                                            .when(
                                                state.platforms_panel.accounts.is_empty(),
                                                |this| {
                                                    this.child(
                                                        div()
                                                            .px(px(8.0))
                                                            .py(px(6.0))
                                                            .text_size(px(12.0))
                                                            .text_color(theme::text_muted())
                                                            .child("No connected accounts"),
                                                    )
                                                },
                                            ),
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
    let can_send = !composer_text.trim().is_empty()
        && state
            .watched_channels
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
        .child(div().flex().flex_row().flex_wrap().gap(px(6.0)).children(
            state.watched_channels.iter().map({
                let state_entity = state_entity.clone();
                move |chip| {
                    let enabled = !state.composer_disabled_channel_ids.contains(&chip.id);
                    status_chip(chip, enabled, state_entity.clone())
                }
            }),
        ))
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
    chip: &WatchedChannel,
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

fn add_channel_modal(
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
                                        state_entity.add_watched_channel_from_slug(
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
) -> Div {
    let is_compact = settings.chat_theme == ChatTheme::Compact;
    let _is_modern = settings.chat_theme == ChatTheme::Modern;
    let v_pad = if is_compact { 1.0 } else { 2.0 };

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
                    .text_size(px(settings.font_size as f32))
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
                            el.children(message.author.badges.iter().map(|badge| {
                                if let Some(svg_markup) = badge
                                    .image_url
                                    .as_ref()
                                    .filter(|url| url.starts_with("<svg"))
                                {
                                    return div()
                                        .w(px(18.0))
                                        .h(px(18.0))
                                        .rounded_sm()
                                        .overflow_hidden()
                                        .child(
                                            img(ImageSource::from(svg_data_uri(svg_markup)))
                                                .w_full()
                                                .h_full()
                                                .object_fit(ObjectFit::Contain),
                                        );
                                }

                                if let Some(url) = badge.image_url.as_ref().filter(|url| {
                                    url.starts_with("http://") || url.starts_with("https://")
                                }) {
                                    div()
                                        .w(px(18.0))
                                        .h(px(18.0))
                                        .rounded_sm()
                                        .overflow_hidden()
                                        .child(
                                            img(ImageSource::from(url.clone()))
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
                            }))
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
                )),
        )
}

fn svg_data_uri(svg: &str) -> String {
    format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    )
}

fn message_text_with_emotes(
    message: &NormalizedChatMessage,
    font_size: f32,
    is_compact: bool,
) -> Div {
    div()
        .text_size(px(font_size))
        .text_color(theme::text_primary())
        .flex()
        .flex_row()
        .flex_wrap()
        .items_center()
        .gap(px(3.0))
        .children(
            build_message_parts(message)
                .into_iter()
                .map(|part| match part {
                    MessagePart::Text(text) => div().child(text).into_any_element(),
                    MessagePart::Emote(emote) => emote_image(&emote, is_compact).into_any_element(),
                }),
        )
}

enum MessagePart {
    Text(String),
    Emote(Emote),
}

fn build_message_parts(message: &NormalizedChatMessage) -> Vec<MessagePart> {
    if message.emotes.is_empty() {
        return vec![MessagePart::Text(message.text.clone())];
    }

    let mut ranges = Vec::new();
    for emote in &message.emotes {
        for position in &emote.positions {
            let start = position.start as usize;
            let Some(end) = (position.end as usize).checked_add(1) else {
                continue;
            };
            ranges.push((start, end, emote.clone()));
        }
    }
    ranges.sort_by_key(|(start, _, _)| *start);

    let mut parts = Vec::new();
    let mut index = 0;
    for (start, end, emote) in ranges {
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
            parts.push(MessagePart::Text(text.to_string()));
        }
        parts.push(MessagePart::Emote(emote));
        index = end;
    }

    if index < message.text.len()
        && let Some(text) = message.text.get(index..)
    {
        parts.push(MessagePart::Text(text.to_string()));
    }

    if parts.is_empty() {
        parts.push(MessagePart::Text(message.text.clone()));
    }

    parts
}

fn emote_image(emote: &Emote, is_compact: bool) -> Div {
    let size = if is_compact { 20.0 } else { 24.0 };
    div()
        .h(px(size))
        .min_w(px(size))
        .max_w(px(size * emote.aspect_ratio.unwrap_or(1.0) as f32))
        .child(
            img(ImageSource::from(emote.image_url.clone()))
                .h_full()
                .w_full()
                .object_fit(ObjectFit::Contain)
                .with_loading({
                    let name = emote.name.clone();
                    move || name.clone().into_any_element()
                })
                .with_fallback({
                    let name = emote.name.clone();
                    move || name.clone().into_any_element()
                }),
        )
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
