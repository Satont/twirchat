use crate::protocol::rpc::OpenExternalUrlParams;
use crate::protocol::types::Emote;
use crate::runtime::{SystemExternalOpener, browser::open_external_url};
use crate::ui::components::animated_emote;
use crate::ui::theme;
use gpui::*;
use ui::FluentBuilder;

pub struct Tooltip {
    text: SharedString,
}

impl Tooltip {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { text: text.into() }
    }
}

impl RenderOnce for Tooltip {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div().child(self.text)
    }
}

pub fn emote_tooltip(
    emote: Emote,
    preview_id: impl Into<String>,
) -> impl Fn(&mut Window, &mut App) -> AnyView {
    let preview_id = preview_id.into();
    move |_window, cx| {
        cx.new(|_| EmoteTooltip {
            emote: emote.clone(),
            preview_id: preview_id.clone(),
        })
        .into()
    }
}

struct EmoteTooltip {
    emote: Emote,
    preview_id: String,
}

impl Render for EmoteTooltip {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let action_url = seven_tv_emote_url(&self.emote.id);

        div()
            .min_w(px(140.0))
            .rounded_lg()
            .border_1()
            .border_color(theme::border())
            .bg(theme::surface())
            .shadow_lg()
            .p(px(12.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(10.0))
            .child(
                div()
                    .w(px(64.0))
                    .h(px(64.0))
                    .rounded_md()
                    .bg(rgba(0xffffff0d))
                    .p(px(8.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(animated_emote(
                        format!("tooltip-emote-{}-{}", self.preview_id, self.emote.id),
                        self.emote.image_url.clone(),
                        self.emote.name.clone(),
                        window,
                        cx,
                    )),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(4.0))
                    .child(
                        div()
                            .max_w(px(220.0))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme::text_primary())
                            .child(self.emote.name.clone()),
                    )
                    .when_some(action_url, |tooltip, action_url| {
                        tooltip.child(
                            div()
                                .rounded_sm()
                                .px(px(8.0))
                                .py(px(4.0))
                                .bg(rgba(0xffffff0d))
                                .text_size(px(11.0))
                                .text_color(theme::text_muted())
                                .cursor_pointer()
                                .hover(|link| {
                                    link.bg(rgba(0xffffff1a)).text_color(theme::text_primary())
                                })
                                .on_mouse_down(MouseButton::Left, move |_event, _window, _cx| {
                                    let params = OpenExternalUrlParams {
                                        url: action_url.clone(),
                                    };
                                    if let Err(error) =
                                        open_external_url(&SystemExternalOpener, &params)
                                    {
                                        eprintln!(
                                            "[ui/components/tooltip] failed to open 7TV emote link `{}`: {}",
                                            params.url, error
                                        );
                                    }
                                })
                                .child("View on 7TV"),
                        )
                    }),
            )
    }
}

pub(crate) fn seven_tv_emote_url(emote_id: &str) -> Option<String> {
    is_safe_seven_tv_emote_id(emote_id).then(|| format!("https://7tv.app/emotes/{emote_id}"))
}

fn is_safe_seven_tv_emote_id(emote_id: &str) -> bool {
    !emote_id.is_empty() && emote_id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::seven_tv_emote_url;

    #[test]
    fn seven_tv_emote_url_matches_vue_tooltip_parity() {
        assert_eq!(
            seven_tv_emote_url("01HVABCDEF1234567890"),
            Some("https://7tv.app/emotes/01HVABCDEF1234567890".into())
        );
    }

    #[test]
    fn seven_tv_emote_url_rejects_external_opener_metacharacters() {
        for emote_id in [
            "",
            "abc def",
            "abc&calc",
            "abc|calc",
            "abc\"calc",
            "abc\ncalc",
            "abc?next=https://evil.example",
            "abc#fragment",
            "abc/def",
        ] {
            assert_eq!(seven_tv_emote_url(emote_id), None, "{emote_id:?}");
        }
    }
}
