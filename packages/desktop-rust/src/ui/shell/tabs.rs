use crate::app_state::{AppState, AppStateActions};
use crate::models::Platform as ModelPlatform;
use crate::protocol::types::Platform;
use crate::ui::components::input::Input;
use crate::ui::theme;
use gpui::{App, ClickEvent, Div, Entity, Window, div, prelude::*, px};

pub(crate) fn bar(
    state: &AppState,
    state_entity: Entity<AppState>,
    add_channel_input: Entity<Input>,
) -> Div {
    let active_id = String::from(state.active_channel_tab_id());
    let mut tabs = vec![("home".to_string(), "Home".to_string(), None)];
    tabs.extend(state.watched_channels.iter().map(|channel| {
        (
            channel.id.clone(),
            channel.display_name.clone(),
            Some(channel.platform),
        )
    }));
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
            let accent = tab_accent(platform);
            let is_home = tab_id == "home";

            div()
                .relative()
                .flex()
                .items_center()
                .child(
                    div()
                        .id(format!("tab-{tab_id}"))
                        .cursor_pointer()
                        .rounded_t_md()
                        .h(px(32.0))
                        .px(if is_home { px(16.0) } else { px(28.0) })
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
                        .gap(px(6.0))
                        .when(is_active && platform.is_some(), |this| {
                            this.child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(accent))
                        })
                        .child(label),
                )
                .when(!is_home, |wrapper| {
                    let state_entity = tabs_state_entity.clone();
                    let tab_id = id.clone();
                    wrapper.child(
                        div()
                            .absolute()
                            .right(px(8.0))
                            .top(px(7.0))
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
                                state_entity.remove_watched_channel(app, &tab_id);
                            }),
                    )
                })
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
                    let add_channel_input = add_channel_input.clone();
                    move |_event, _window, app| {
                        add_channel_input.update(app, |input, cx| {
                            input.clear(cx);
                            input.set_placeholder("Twitch channel name", cx);
                        });
                        state_entity.open_add_channel_modal(app);
                    }
                })
                .child("+"),
        )
}

fn tab_accent(platform: Option<Platform>) -> gpui::Rgba {
    match platform {
        Some(Platform::Twitch) => theme::platform_color(ModelPlatform::Twitch),
        Some(Platform::Youtube) => theme::platform_color(ModelPlatform::YouTube),
        Some(Platform::Kick) => theme::platform_color(ModelPlatform::Kick),
        None => theme::accent(),
    }
}
