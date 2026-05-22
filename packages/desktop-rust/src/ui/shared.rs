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

pub(crate) fn format_compact_viewers(count: u64) -> String {
    if count >= 1_000_000 {
        return format!("{:.1}M", count as f64 / 1_000_000.0);
    }
    if count >= 1_000 {
        return format!("{:.1}K", count as f64 / 1_000.0);
    }
    count.to_string()
}

pub(crate) fn format_exact_viewers(count: u64) -> String {
    let digits = count.to_string();
    let mut formatted = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            formatted.push(',');
        }
        formatted.push(ch);
    }
    formatted
}

#[cfg(test)]
mod tests {
    #[test]
    fn viewer_formatting_matches_vue_contract() {
        assert_eq!(super::format_compact_viewers(42), "42");
        assert_eq!(super::format_compact_viewers(1_234), "1.2K");
        assert_eq!(super::format_compact_viewers(1_000_000), "1.0M");
        assert_eq!(super::format_exact_viewers(1_234_567), "1,234,567");
    }
}
