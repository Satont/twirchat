use crate::app_state::mock_data::PrototypeData;
use crate::theme;
use crate::ui::shared::panel_title;
use gpui::{Div, div, prelude::*, px, rgb};

pub(crate) fn panel(data: &PrototypeData) -> Div {
    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(panel_title(
            "Events",
            "Realtime follows, gifts, raids and platform activity",
        ))
        .children(data.events.iter().map(|event| {
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(16.0))
                .flex()
                .flex_row()
                .gap(px(12.0))
                .child(
                    div()
                        .w(px(36.0))
                        .h(px(36.0))
                        .rounded_md()
                        .bg(rgb(event.accent_hex))
                        .text_color(theme::text_primary())
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(event.platform.glyph()),
                )
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_color(theme::text_primary())
                                .child(event.title.clone()),
                        )
                        .child(
                            div()
                                .text_color(theme::text_muted())
                                .child(event.detail.clone()),
                        ),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child(event.timestamp.clone()),
                )
        }))
}
