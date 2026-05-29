use crate::app_state::{AppState, AppStateActions};
use crate::models::Platform as ModelPlatform;
use crate::protocol::types::Platform;
use crate::ui::components::input::Input;
use crate::ui::shared::format_compact_viewers;
use crate::ui::theme;
use gpui::{App, ClickEvent, Div, Entity, Focusable, Window, div, prelude::*, px};

const TAB_RENAME_INPUT_HEIGHT: f32 = 20.0;
const TAB_RENAME_INPUT_MIN_WIDTH: f32 = 56.0;
const TAB_RENAME_INPUT_MAX_WIDTH: f32 = 148.0;
const TAB_RENAME_INPUT_CHAR_WIDTH: f32 = 7.0;
const TAB_RENAME_INPUT_PADDING: f32 = 10.0;

#[derive(Clone)]
struct DraggedTab {
    id: String,
}

#[derive(Clone)]
pub(crate) struct TabItem {
    pub id: String,
    pub label: String,
    pub platform: Option<Platform>,
    pub is_live: bool,
    pub viewer_count: Option<u64>,
}

pub(crate) fn items(state: &AppState) -> Vec<TabItem> {
    let mut tabs = vec![TabItem {
        id: "home".to_string(),
        label: "Home".to_string(),
        platform: None,
        is_live: false,
        viewer_count: None,
    }];
    tabs.extend(state.visible_watched_channels().into_iter().map(|channel| {
        let status = state.home_channel_status(channel.platform, &channel.channel_slug);
        TabItem {
            id: channel.id.clone(),
            label: state
                .watched_tab_title(&channel.id)
                .unwrap_or_else(|| channel.display_name.clone()),
            platform: Some(channel.platform),
            is_live: status.is_some_and(|status| status.is_live),
            viewer_count: status.and_then(|status| status.viewer_count),
        }
    }));
    tabs
}

fn tab_rename_input_width(label: &str) -> gpui::Pixels {
    let label_width = label.chars().count() as f32 * TAB_RENAME_INPUT_CHAR_WIDTH;
    px((label_width + TAB_RENAME_INPUT_PADDING)
        .clamp(TAB_RENAME_INPUT_MIN_WIDTH, TAB_RENAME_INPUT_MAX_WIDTH))
}

pub(crate) fn bar(
    state: &AppState,
    state_entity: Entity<AppState>,
    add_channel_input: Entity<Input>,
    tab_rename_input: Entity<Input>,
) -> Div {
    let active_id = String::from(state.active_channel_tab_id());
    let tabs = items(state);
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
        .children(tabs.into_iter().map(move |tab| {
            let state_entity = tabs_state_entity.clone();
            let id = tab.id.clone();
            let label = tab.label.clone();
            let platform = tab.platform;
            let is_live = tab.is_live;
            let viewer_count = tab.viewer_count;
            let is_active = id == active_id;
            let tab_id = id.clone();
            let accent = tab_accent(platform);
            let is_home = tab_id == "home";
            let is_renaming = state.renaming_watched_tab_id() == Some(tab_id.as_str());

            div()
                .id(format!("tab-wrapper-{id}"))
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
                        .when((is_active || is_live) && platform.is_some(), |this| {
                            this.child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(accent))
                        })
                        .child(if is_renaming {
                            div()
                                .w(tab_rename_input_width(&label))
                                .max_w(px(TAB_RENAME_INPUT_MAX_WIDTH))
                                .h(px(TAB_RENAME_INPUT_HEIGHT))
                                .flex()
                                .items_center()
                                .child(tab_rename_input.clone())
                                .into_any_element()
                        } else {
                            div().child(label.clone()).into_any_element()
                        })
                        .when_some(viewer_count.filter(|_| is_live), |this, viewer_count| {
                            this.child(
                                div()
                                    .px(px(5.0))
                                    .py(px(1.0))
                                    .rounded_full()
                                    .bg(gpui::rgba(0xffffff14))
                                    .text_size(px(10.0))
                                    .child(format_compact_viewers(viewer_count)),
                            )
                        }),
                )
                .when(!is_home, |wrapper| {
                    let state_entity = tabs_state_entity.clone();
                    let tab_id = id.clone();
                    let drop_target_id = id.clone();
                    let drag_tab_id = id.clone();
                    wrapper
                        .on_drag(DraggedTab { id: drag_tab_id }, |_, _, _, cx| {
                            cx.new(|_| gpui::Empty)
                        })
                        .drag_over::<DraggedTab>(move |style, dragged, _, _| {
                            if dragged.id == drop_target_id {
                                style
                            } else {
                                style
                                    .bg(theme::surface())
                                    .border_b_2()
                                    .border_color(theme::accent())
                            }
                        })
                        .on_drop::<DraggedTab>({
                            let state_entity = tabs_state_entity.clone();
                            let target_id = id.clone();
                            move |dragged, _window, app| {
                                state_entity.reorder_watched_channel_tab(
                                    app,
                                    &dragged.id,
                                    &target_id,
                                );
                            }
                        })
                        .child(
                            div()
                                .absolute()
                                .right(px(28.0))
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
                                .on_mouse_down(
                                    gpui::MouseButton::Left,
                                    move |_event, _window, app| {
                                        state_entity.remove_watched_channel_for_tab(app, &tab_id);
                                    },
                                ),
                        )
                        .child(
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
                                .child(if is_renaming { "✓" } else { "✎" })
                                .on_mouse_down(gpui::MouseButton::Left, {
                                    let state_entity = tabs_state_entity.clone();
                                    let tab_id = id.clone();
                                    let label = label.clone();
                                    let tab_rename_input = tab_rename_input.clone();
                                    move |_event, window, app| {
                                        if is_renaming {
                                            let name = tab_rename_input
                                                .read(app)
                                                .text()
                                                .trim()
                                                .to_string();
                                            state_entity.rename_watched_tab(app, &tab_id, &name);
                                        } else {
                                            tab_rename_input.update(app, |input, cx| {
                                                input.set_text(label.clone(), cx);
                                            });
                                            state_entity.start_watched_tab_rename(app, &tab_id);
                                            let focus =
                                                tab_rename_input.read(app).focus_handle(app);
                                            window.focus(&focus, app);
                                        }
                                    }
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
