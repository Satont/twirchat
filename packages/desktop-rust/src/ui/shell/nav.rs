use crate::app_state::{AppState, AppStateActions, MainSection};
use crate::theme;
use gpui::{App, ClickEvent, Div, Entity, Window, div, prelude::*, px, rgb};

pub(crate) fn rail(state: &AppState, state_entity: Entity<AppState>) -> Div {
    let width = if state.sidebar_collapsed() {
        44.0
    } else {
        68.0
    };

    div()
        .w(px(width))
        .h_full()
        .bg(theme::nav_background())
        .border_r_1()
        .border_color(rgb(0x21212a))
        .pt(px(12.0))
        .pb(px(16.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_color(theme::accent())
                .text_size(px(20.0))
                .mb(px(12.0))
                .child("🖥"),
        )
        .child(
            div()
                .w_full()
                .px(px(7.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(button(
                    state,
                    state_entity.clone(),
                    MainSection::Chat,
                    "💬",
                    "Chat",
                    None,
                ))
                .child(button(
                    state,
                    state_entity.clone(),
                    MainSection::Events,
                    "🔔",
                    "Events",
                    None,
                ))
                .child(button(
                    state,
                    state_entity.clone(),
                    MainSection::Platforms,
                    "🌐",
                    "Platforms",
                    Some(String::from("2")),
                ))
                .child(button(
                    state,
                    state_entity.clone(),
                    MainSection::Settings,
                    "⚙",
                    "Settings",
                    None,
                )),
        )
        .child(div().flex_1())
        .child(sidebar_toggle(state, state_entity))
}

fn button(
    state: &AppState,
    state_entity: Entity<AppState>,
    section: MainSection,
    icon: &'static str,
    label: &'static str,
    badge: Option<String>,
) -> impl IntoElement {
    let active = state.active_section() == section;

    let mut item = div()
        .id(format!("nav-{label}"))
        .w_full()
        .rounded_lg()
        .px(px(4.0))
        .py(px(8.0))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(4.0))
        .cursor_pointer()
        .text_color(if active {
            theme::accent()
        } else {
            rgb(0x6f6f7d)
        })
        .bg(if active {
            rgb(0x1f1735)
        } else {
            theme::nav_background()
        })
        .on_click(
            move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                state_entity.select_section(app, section);
            },
        )
        .child(div().text_size(px(17.0)).child(icon));

    if !state.sidebar_collapsed() {
        item = item.child(div().text_size(px(9.0)).child(label));
    }

    if let Some(badge) = badge {
        item = item.child(
            div()
                .mt(px(2.0))
                .min_w(px(16.0))
                .rounded_md()
                .px(px(4.0))
                .py(px(1.0))
                .bg(if matches!(section, MainSection::Platforms) {
                    rgb(0x163522)
                } else {
                    rgb(0x451825)
                })
                .text_color(if matches!(section, MainSection::Platforms) {
                    theme::green()
                } else {
                    theme::red()
                })
                .text_size(px(9.0))
                .child(badge),
        );
    }

    item
}

fn sidebar_toggle(state: &AppState, state_entity: Entity<AppState>) -> impl IntoElement {
    div()
        .id("sidebar-toggle")
        .w(px(32.0))
        .h(px(32.0))
        .rounded_md()
        .cursor_pointer()
        .text_color(rgb(0x777786))
        .flex()
        .items_center()
        .justify_center()
        .on_click(
            move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                state_entity.toggle_sidebar(app);
            },
        )
        .child(if state.sidebar_collapsed() {
            "›"
        } else {
            "‹"
        })
}
