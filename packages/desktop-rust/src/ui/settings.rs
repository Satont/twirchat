use crate::app_state::mock_data::PrototypeData;
use crate::ui::shared::panel_title;
use crate::ui::theme;
use gpui::{Div, div, prelude::*, px};

pub(crate) fn panel(_data: &PrototypeData) -> Div {
    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(panel_title(
            "Settings",
            "Appearance, hotkeys and overlay controls",
        ))
        .child(
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(18.0))
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(
                    div()
                        .text_color(theme::text_primary())
                        .child("Theme & Font Family"),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child("AppTheme and FontFamilyChoice controls"),
                ),
        )
        .child(
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(18.0))
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(
                    div()
                        .text_color(theme::text_primary())
                        .child("Self Ping & Updates"),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child("Self-ping enabled/color, auto-check-updates toggle"),
                ),
        )
        .child(
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(18.0))
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(
                    div()
                        .text_color(theme::text_primary())
                        .child("Overlay Config"),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child("Overlay URL, animation, font size"),
                ),
        )
        .child(
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(18.0))
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(div().text_color(theme::text_primary()).child("Hotkeys"))
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child("Hotkey recording: Ctrl+K override, Escape to cancel"),
                ),
        )
}
