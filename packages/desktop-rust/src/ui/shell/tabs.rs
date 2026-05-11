use crate::app_state::{AppState, AppStateActions};
use crate::ui::theme;
use gpui::{App, ClickEvent, Div, Entity, Window, div, prelude::*, px};

pub(crate) fn bar(state: &AppState, state_entity: Entity<AppState>) -> Div {
    let active_id = String::from(state.active_channel_tab_id());

    let tabs = vec![
        ("home", "Home", None),
        ("satont", "satont", Some(crate::models::Platform::Twitch)),
    ];

    div()
        .w_full()
        .bg(theme::nav_background())
        .border_b_1()
        .border_color(theme::border())
        .px(px(16.0))
        .pt(px(8.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(4.0))
        .children(tabs.into_iter().map(move |(id, label, platform)| {
            let state_entity = state_entity.clone();
            let is_active = id == active_id;
            let tab_id = id.to_string();
            let accent = platform
                .map(theme::platform_color)
                .unwrap_or(theme::accent());

            div()
                .id(format!("tab-{tab_id}"))
                .cursor_pointer()
                .rounded_t_md()
                .px(px(16.0))
                .py(px(6.0))
                .border_b_2()
                .border_color(if is_active {
                    accent
                } else {
                    gpui::rgba(0x00000000)
                })
                .bg(if is_active {
                    theme::surface()
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
                        style
                            .bg(theme::surface_2())
                            .text_color(theme::text_primary())
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
                        .when(is_active, |this| {
                            this.child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(accent))
                        })
                        .child(label),
                )
        }))
        .child(
            div()
                .px(px(12.0))
                .py(px(6.0))
                .rounded_t_md()
                .text_color(theme::text_muted())
                .hover(|s| s.bg(theme::surface_2()).text_color(theme::text_primary()))
                .cursor_pointer()
                .child("+"),
        )
}
