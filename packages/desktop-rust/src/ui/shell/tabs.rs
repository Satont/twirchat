use crate::app_state::mock_data::PrototypeData;
use crate::app_state::{AppState, AppStateActions};
use crate::theme;
use gpui::{App, ClickEvent, Div, Entity, Window, div, prelude::*, px, rgb};

pub(crate) fn bar(state: &AppState, state_entity: Entity<AppState>, data: &PrototypeData) -> Div {
    let active_id = String::from(state.active_channel_tab_id());

    div()
        .w_full()
        .bg(theme::nav_background())
        .border_b_1()
        .border_color(theme::border())
        .px(px(8.0))
        .pt(px(4.0))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(2.0))
        .children(data.tabs.iter().map(move |tab| {
            let state_entity = state_entity.clone();
            let is_active = tab.id == active_id;
            let tab_id = tab.id.clone();
            let accent = tab
                .platform
                .map(theme::platform_color)
                .unwrap_or(theme::accent());

            div()
                .id(format!("tab-{tab_id}"))
                .cursor_pointer()
                .rounded_t_lg()
                .px(px(10.0))
                .pt(px(4.0))
                .pb(px(5.0))
                .border_b_2()
                .border_color(if is_active {
                    accent
                } else {
                    theme::nav_background()
                })
                .bg(if is_active {
                    rgb(0x171721)
                } else {
                    theme::nav_background()
                })
                .text_color(if is_active {
                    accent
                } else {
                    theme::text_muted()
                })
                .on_click(
                    move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                        state_entity.select_channel_tab(app, &tab_id);
                    },
                )
                .child(tab.label.clone())
        }))
        .child(
            div()
                .px(px(8.0))
                .pt(px(4.0))
                .pb(px(5.0))
                .text_color(theme::text_muted())
                .child("+"),
        )
}
