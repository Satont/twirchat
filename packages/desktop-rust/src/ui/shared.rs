use crate::ui::theme;
use gpui::{Div, div, prelude::*, px};

pub(crate) fn panel_title(title: &'static str, subtitle: &'static str) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .text_color(theme::text_primary())
                .text_size(px(20.0))
                .child(title),
        )
        .child(
            div()
                .text_color(theme::text_muted())
                .text_size(px(13.0))
                .child(subtitle),
        )
}
