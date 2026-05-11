use crate::app_state::mock_data::PrototypeData;
use crate::theme;
use crate::ui::shared::panel_title;
use gpui::{Div, div, prelude::*, px};

pub(crate) fn panel(data: &PrototypeData) -> Div {
    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(panel_title(
            "Settings",
            "Appearance and desktop preview controls",
        ))
        .children(data.settings.iter().map(|row| {
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
                        .child(row.label.clone()),
                )
                .child(
                    div()
                        .rounded_md()
                        .bg(theme::surface_2())
                        .border_1()
                        .border_color(theme::border())
                        .px(px(10.0))
                        .py(px(8.0))
                        .text_color(theme::accent())
                        .child(row.value.clone()),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child(row.hint.clone()),
                )
        }))
}
