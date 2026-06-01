use crate::app_state::{AppState, AppStateActions, MainSection};
use crate::ui::theme;
use gpui::{App, ClickEvent, Entity, Window, div, prelude::*, px, rgba};

pub(crate) fn rail(state: &AppState, state_entity: Entity<AppState>) -> impl IntoElement {
    let width = if state.sidebar_collapsed() {
        44.0
    } else {
        68.0
    };

    div()
        .id("nav-rail")
        .w(px(width))
        .h_full()
        .bg(theme::nav_background())
        .border_r_1()
        .border_color(rgba(0x21212aff))
        .pt(px(12.0))
        .pb(px(16.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_color(theme::accent())
                .mb(px(12.0))
                .text_size(px(20.0))
                .child("✦"),
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
                    "⚡",
                    "Events",
                    if state.unread_events() > 0 {
                        Some(if state.unread_events() > 99 {
                            "99+".to_string()
                        } else {
                            state.unread_events().to_string()
                        })
                    } else {
                        None
                    },
                ))
                .child(button(
                    state,
                    state_entity.clone(),
                    MainSection::Platforms,
                    "◉",
                    "Platforms",
                    connected_platforms_badge(state),
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

fn connected_platforms_badge(state: &AppState) -> Option<String> {
    let count = state.connected_platform_count();
    (count > 0).then(|| count.to_string())
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

    let mut item_inner = div()
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(17.0))
        .child(icon);

    if let Some(badge_text) = badge {
        item_inner = item_inner.child(
            div()
                .absolute()
                .top(px(-6.0))
                .right(px(-8.0))
                .rounded_md()
                .px(px(4.0))
                .py(px(1.0))
                .min_w(px(16.0))
                .bg(if matches!(section, MainSection::Platforms) {
                    rgba(0x22c55eff) // badge-green
                } else {
                    rgba(0xef4444ff) // red
                })
                .text_color(rgba(0xffffffff))
                .text_size(px(9.0))
                .font_weight(gpui::FontWeight::BOLD)
                .flex()
                .justify_center()
                .child(badge_text),
        );
    }

    let mut item = div()
        .id(format!("nav-{label}"))
        .w_full()
        .rounded_xl()
        .px(px(4.0))
        .py(px(10.0))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(4.0))
        .cursor_pointer()
        .text_color(if active {
            theme::accent()
        } else {
            rgba(0xffffff73) // nav-text approx opacity 0.45
        })
        .bg(if active {
            rgba(0xa78bfa26) // approx accent opacity 0.15
        } else {
            rgba(0x00000000)
        })
        .hover(|s| {
            if !active {
                s.bg(rgba(0xffffff0f)).text_color(rgba(0xffffffcc)) // hover states
            } else {
                s
            }
        })
        .on_click(
            move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                state_entity.select_section(app, section);
            },
        )
        .child(item_inner);

    if !state.sidebar_collapsed() {
        item = item.child(
            div()
                .text_size(px(10.0))
                .font_weight(gpui::FontWeight::MEDIUM)
                .child(label),
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
        .text_color(rgba(0xffffff59)) // 0.35 opacity
        .flex()
        .items_center()
        .justify_center()
        .hover(|s| s.bg(rgba(0xffffff14)).text_color(rgba(0xffffffb2))) // hover
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
