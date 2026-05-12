use crate::app_state::{AppState, AppStateActions};
use crate::ui::theme;
use gpui::{App, ClickEvent, Div, Entity, Window, div, prelude::*, px};

pub(crate) fn bar(state: &AppState, state_entity: Entity<AppState>) -> Div {
    let active_id = String::from(state.active_channel_tab_id());
    let tabs = vec![("home".to_string(), "Home".to_string(), None)];
    let tabs_state_entity = state_entity.clone();

    div()
        .w_full()
        .h(px(40.0))
        .bg(theme::surface_2())
        .border_b_1()
        .border_color(theme::border())
        .flex()
        .flex_row()
        .items_end()
        .px(px(8.0))
        .gap(px(2.0))
        .children(tabs.into_iter().map(move |(id, label, platform)| {
            let state_entity = tabs_state_entity.clone();
            let is_active = id == active_id;
            let tab_id = id.clone();
            let accent = platform
                .map(theme::platform_color)
                .unwrap_or(theme::accent());

            div()
                .id(format!("tab-{tab_id}"))
                .cursor_pointer()
                .rounded_t_md()
                .h(px(32.0))
                .px(px(16.0))
                .flex()
                .items_center()
                .border_1()
                .border_b_0()
                .border_color(if is_active {
                    theme::border()
                } else {
                    gpui::rgba(0x00000000)
                })
                .bg(if is_active {
                    theme::background()
                } else {
                    gpui::rgba(0x00000000)
                })
                .text_color(if is_active {
                    theme::text_primary()
                } else {
                    theme::text_muted()
                })
                .hover(|style| {
                    if is_active {
                        style
                    } else {
                        style.bg(theme::surface()).text_color(theme::text_primary())
                    }
                })
                .on_click(
                    move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                        state_entity.select_channel_tab(app, &tab_id);
                    },
                )
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(6.0))
                        .when(is_active && platform.is_some(), |this| {
                            this.child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(accent))
                        })
                        .child(label)
                        .when(is_active, |this| {
                            this.child(
                                div()
                                    .ml(px(8.0))
                                    .w(px(16.0))
                                    .h(px(16.0))
                                    .rounded_md()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_color(theme::text_muted())
                                    .hover(|s| {
                                        s.bg(theme::surface_2()).text_color(theme::text_primary())
                                    })
                                    .child("×"),
                            )
                        }),
                )
        }))
        .child(
            div()
                .relative()
                .h(px(32.0))
                .px(px(12.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded_t_md()
                .text_color(theme::text_muted())
                .hover(|s| s.bg(theme::surface()).text_color(theme::text_primary()))
                .cursor_pointer()
                .on_mouse_down(gpui::MouseButton::Left, {
                    let state_entity = state_entity.clone();
                    move |_event, _window, app| {
                        eprintln!("[ui/tabs] tab add menu clicked");
                        state_entity.update(app, |state, cx| {
                            state.toggle_tab_add_menu();
                            cx.notify();
                        });
                    }
                })
                .child("+")
                .when(state.tab_add_menu_open, |this| {
                    this.child(
                        div()
                            .absolute()
                            .top(px(34.0))
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
                                    .child("ADD CHANNEL"),
                            )
                            .children(state.platforms_panel.accounts.iter().map({
                                let state_entity = state_entity.clone();
                                move |account| {
                                    let account_id = account.id.clone();
                                    let label = format!(
                                        "Watch {} ({})",
                                        account.display_name, account.username
                                    );
                                    div()
                                        .rounded_md()
                                        .px(px(8.0))
                                        .py(px(6.0))
                                        .text_size(px(12.0))
                                        .text_color(theme::text_primary())
                                        .hover(|s| s.bg(theme::surface_2()))
                                        .cursor_pointer()
                                        .on_mouse_down(gpui::MouseButton::Left, {
                                            let state_entity = state_entity.clone();
                                            move |_event, _window, app| {
                                                eprintln!("[ui/tabs] add watched account clicked");
                                                state_entity.add_watched_channel_from_account(
                                                    app,
                                                    &account_id,
                                                );
                                                state_entity.update(app, |state, cx| {
                                                    state.close_tab_add_menu();
                                                    cx.notify();
                                                });
                                            }
                                        })
                                        .child(label)
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
}
