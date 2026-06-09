use crate::protocol::types::{ModerationPresetKind, Platform};
use crate::ui::components::log_slider::LogSlider;
use crate::ui::theme;
use gpui::*;
use std::rc::Rc;
use ui::FluentBuilder;

struct Preset {
    label: &'static str,
    seconds: u32,
}

const PRESETS: &[Preset] = &[
    Preset {
        label: "1m",
        seconds: 60,
    },
    Preset {
        label: "5m",
        seconds: 300,
    },
    Preset {
        label: "10m",
        seconds: 600,
    },
    Preset {
        label: "30m",
        seconds: 1800,
    },
    Preset {
        label: "1h",
        seconds: 3600,
    },
    Preset {
        label: "6h",
        seconds: 21600,
    },
    Preset {
        label: "1d",
        seconds: 86400,
    },
    Preset {
        label: "Perm",
        seconds: 0,
    },
];

pub fn format_duration(seconds: u32) -> String {
    if seconds == 0 {
        return "Permanent ban".into();
    }
    if seconds < 60 {
        return format!("{seconds}s");
    }
    if seconds < 3600 {
        let m = seconds / 60;
        return format!("{m} minute{}", if m == 1 { "" } else { "s" });
    }
    if seconds < 86400 {
        let h = seconds / 3600;
        return format!("{h} hour{}", if h == 1 { "" } else { "s" });
    }
    if seconds < 604_800 {
        let d = seconds / 86400;
        return format!("{d} day{}", if d == 1 { "" } else { "s" });
    }
    let w = seconds / 604_800;
    format!("{w} week{}", if w == 1 { "" } else { "s" })
}

fn is_preset_valid_for_platform(preset: &Preset, platform: Platform) -> bool {
    match platform {
        Platform::Youtube => false,
        Platform::Twitch => true,
        Platform::Kick => {
            // Kick minimum is 60s, maximum is 7 days (604800s)
            // Perm (0) is valid for Kick (permanent ban)
            if preset.seconds == 0 {
                return true;
            }
            preset.seconds >= 60 && preset.seconds <= 604_800
        }
    }
}

fn preset_button(
    id: impl Into<ElementId>,
    label: &'static str,
    is_selected: bool,
    on_click: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let bg = if is_selected {
        theme::accent()
    } else {
        theme::surface_2()
    };
    let text_color = if is_selected {
        theme::text_primary()
    } else {
        theme::text_muted()
    };

    div()
        .id(id)
        .w(px(48.0))
        .h(px(24.0))
        .rounded_sm()
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(11.0))
        .text_color(text_color)
        .bg(bg)
        .cursor_pointer()
        .hover(|s| s.bg(theme::accent()).text_color(theme::text_primary()))
        .on_mouse_down(MouseButton::Left, on_click)
        .child(label)
}

pub fn moderation_popover(
    platform: Platform,
    selected_duration_seconds: u32,
    on_change: impl Fn(u32, &mut Window, &mut App) + 'static,
    on_confirm: impl Fn(u32, &mut Window, &mut App) + 'static,
    on_cancel: impl Fn(&mut Window, &mut App) + 'static,
) -> Div {
    if platform == Platform::Youtube {
        return div()
            .bg(theme::surface())
            .border_1()
            .border_color(theme::border())
            .rounded_md()
            .shadow_md()
            .p(px(12.0))
            .flex()
            .items_center()
            .justify_center()
            .text_size(px(12.0))
            .text_color(theme::text_muted())
            .child("Moderation not supported for YouTube");
    }

    let on_confirm = Rc::new(on_confirm);
    let on_change = Rc::new(on_change);
    let on_cancel = Rc::new(on_cancel);

    let valid_presets: Vec<&Preset> = PRESETS
        .iter()
        .filter(|p| is_preset_valid_for_platform(p, platform))
        .collect();

    let row1_count = valid_presets.len().min(4);
    let row1 = &valid_presets[..row1_count];
    let row2 = &valid_presets[row1_count..];

    let duration_label = format_duration(selected_duration_seconds);

    div()
        .w(px(240.0))
        .bg(theme::surface())
        .border_1()
        .border_color(theme::border())
        .rounded_md()
        .shadow_md()
        .p(px(12.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            // Preset buttons row 1
            div()
                .flex()
                .flex_row()
                .gap(px(4.0))
                .children(row1.iter().map(|preset| {
                    let is_selected = preset.seconds == selected_duration_seconds;
                    let seconds = preset.seconds;
                    let on_preset_change = on_change.clone();
                    preset_button(
                        SharedString::from(format!("preset-{}", preset.label)),
                        preset.label,
                        is_selected,
                        move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
                            on_preset_change(seconds, window, app);
                        },
                    )
                })),
        )
        .when(!row2.is_empty(), |el| {
            let on_change_row2 = on_change.clone();
            el.child(
                // Preset buttons row 2
                div()
                    .flex()
                    .flex_row()
                    .gap(px(4.0))
                    .children(row2.iter().map(|preset| {
                        let is_selected = preset.seconds == selected_duration_seconds;
                        let seconds = preset.seconds;
                        let on_preset_change = on_change_row2.clone();
                        preset_button(
                            SharedString::from(format!("preset-{}-row2", preset.label)),
                            preset.label,
                            is_selected,
                            move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
                                on_preset_change(seconds, window, app);
                            },
                        )
                    })),
            )
        })
        .child(
            // LogSlider
            div().w_full().child(
                LogSlider::new("moderation-duration-slider", selected_duration_seconds)
                    .platform(platform)
                    .on_change({
                        let on_slider = on_change.clone();
                        move |seconds: u32, window: &mut Window, app: &mut App| {
                            on_slider(seconds, window, app);
                        }
                    }),
            ),
        )
        .child(
            // Duration label
            div()
                .text_size(px(12.0))
                .text_color(theme::text_muted())
                .child(duration_label),
        )
        .child(
            // Action buttons row
            div()
                .flex()
                .flex_row()
                .gap(px(8.0))
                .justify_end()
                .child(
                    // Cancel button
                    div()
                        .id("moderation-cancel")
                        .px(px(12.0))
                        .h(px(28.0))
                        .rounded_sm()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.0))
                        .text_color(theme::text_muted())
                        .bg(theme::surface_2())
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::border()).text_color(theme::text_primary()))
                        .on_mouse_down(MouseButton::Left, {
                            let on_cancel = on_cancel.clone();
                            move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
                                on_cancel(window, app);
                            }
                        })
                        .child("Cancel"),
                )
                .child(
                    // Confirm button
                    div()
                        .id("moderation-confirm")
                        .px(px(12.0))
                        .h(px(28.0))
                        .rounded_sm()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.0))
                        .text_color(theme::text_primary())
                        .bg(theme::accent())
                        .cursor_pointer()
                        .hover(|s| s.bg(theme::accent_strong()))
                        .on_mouse_down(MouseButton::Left, {
                            let duration = selected_duration_seconds;
                            move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
                                on_confirm(duration, window, app);
                            }
                        })
                        .child("Confirm"),
                ),
        )
}

fn inline_preset_button(
    id: impl Into<ElementId>,
    label: &str,
    is_ban: bool,
    on_click: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let bg = if is_ban {
        rgba(0xef44441a)
    } else {
        theme::surface_2()
    };
    let text_color = if is_ban {
        rgb(0xef4444)
    } else {
        theme::text_muted()
    };
    let hover_bg = if is_ban {
        rgba(0xef444433)
    } else {
        theme::accent()
    };
    let hover_text = if is_ban {
        rgb(0xfca5a5)
    } else {
        theme::text_primary()
    };

    div()
        .id(id)
        .px(px(5.0))
        .h(px(18.0))
        .rounded(px(3.0))
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(10.0))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(text_color)
        .bg(bg)
        .cursor_pointer()
        .hover(|s| s.bg(hover_bg).text_color(hover_text))
        .on_mouse_down(MouseButton::Left, on_click)
        .child(label.to_string())
}

fn inline_custom_button(
    id: impl Into<ElementId>,
    on_click: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    div()
        .id(id)
        .w(px(18.0))
        .h(px(18.0))
        .rounded(px(3.0))
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(10.0))
        .text_color(theme::text_muted())
        .bg(theme::surface_2())
        .cursor_pointer()
        .hover(|s| s.bg(theme::accent()).text_color(theme::text_primary()))
        .on_mouse_down(MouseButton::Left, on_click)
        .child("⋯")
}

pub fn inline_moderation_presets(
    message_id: &str,
    platform: Platform,
    presets: &[ModerationPresetKind],
    on_preset_click: impl Fn(ModerationPresetKind, &mut Window, &mut App) + 'static,
    on_custom_click: impl Fn(&mut Window, &mut App) + 'static,
) -> Div {
    let on_preset_click = Rc::new(on_preset_click);
    let on_custom_click = Rc::new(on_custom_click);

    let valid_presets: Vec<&ModerationPresetKind> = presets
        .iter()
        .filter(|p| p.is_valid_for_platform(platform))
        .collect();

    if valid_presets.is_empty() && platform == Platform::Youtube {
        return div();
    }

    let mut row = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(2.0))
        .mr(px(4.0));

    for preset in valid_presets {
        let preset = *preset;
        let label = preset.label();
        let is_ban = matches!(preset, ModerationPresetKind::Ban);
        let on_click = on_preset_click.clone();
        let msg_id = message_id.to_string();

        row = row.child(inline_preset_button(
            SharedString::from(format!("mod-preset-{msg_id}-{label}")),
            label,
            is_ban,
            move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
                on_click(preset, window, app);
            },
        ));
    }

    let on_custom = on_custom_click.clone();
    row = row.child(inline_custom_button(
        SharedString::from(format!("mod-custom-{message_id}")),
        move |_event: &MouseDownEvent, window: &mut Window, app: &mut App| {
            on_custom(window, app);
        },
    ));

    row
}
