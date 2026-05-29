use crate::chat::{EmoteSuggestion, MentionSuggestion};
use crate::ui::theme;
use gpui::prelude::*;
use gpui::*;
use std::rc::Rc;

type SelectCallback = Rc<dyn Fn(usize, &mut Window, &mut App) + 'static>;

#[derive(Clone)]
pub enum AutocompleteSuggestion {
    Mention(MentionSuggestion),
    Emote(EmoteSuggestion),
}

#[derive(IntoElement)]
pub struct AutocompletePopup {
    suggestions: Vec<AutocompleteSuggestion>,
    selected_index: usize,
    on_select: Option<SelectCallback>,
}

impl AutocompletePopup {
    pub fn new(suggestions: Vec<AutocompleteSuggestion>, selected_index: usize) -> Self {
        Self {
            suggestions,
            selected_index,
            on_select: None,
        }
    }

    pub fn on_select(mut self, cb: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(cb));
        self
    }
}

impl RenderOnce for AutocompletePopup {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let mut list = div()
            .id("autocomplete-popup")
            .absolute()
            .left(px(0.0))
            .right(px(0.0))
            .bottom(px(44.0))
            .mb(px(8.0))
            .max_h(px(260.0))
            .overflow_y_scroll()
            .rounded(px(10.0))
            .border_1()
            .border_color(theme::border())
            .bg(theme::surface_2())
            .shadow_lg()
            .p(px(4.0))
            .flex()
            .flex_col()
            .gap(px(2.0));

        for (index, suggestion) in self.suggestions.into_iter().enumerate() {
            let is_selected = index == self.selected_index;
            let on_select = self.on_select.clone();
            list = list.child(match suggestion {
                AutocompleteSuggestion::Mention(suggestion) => {
                    mention_item(index, suggestion, is_selected, on_select)
                }
                AutocompleteSuggestion::Emote(suggestion) => {
                    emote_item(index, suggestion, is_selected, on_select)
                }
            });
        }

        list
    }
}

fn mention_item(
    index: usize,
    suggestion: MentionSuggestion,
    is_selected: bool,
    on_select: Option<SelectCallback>,
) -> AnyElement {
    let label = suggestion.label;
    let description = suggestion
        .description
        .unwrap_or_else(|| format!("{:?}", suggestion.platform));
    let display_name = suggestion.display_name;
    let alias_note = suggestion
        .current_alias
        .map(|alias| format!("Alias for {display_name}: {alias}"));
    let color = suggestion
        .color
        .as_deref()
        .and_then(parse_hex_color)
        .unwrap_or_else(theme::accent_strong);

    div()
        .id(format!("mention-autocomplete-item-{index}"))
        .cursor_pointer()
        .rounded(px(8.0))
        .px(px(10.0))
        .py(px(8.0))
        .bg(selected_bg(is_selected))
        .hover(|style| style.bg(rgba(0xffffff0f)))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(10.0))
        .child(div().w(px(9.0)).h(px(9.0)).rounded_full().bg(color))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme::text_primary())
                        .child(format!("@{label}")),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme::text_muted())
                        .child(alias_note.unwrap_or(description)),
                ),
        )
        .on_mouse_down(MouseButton::Left, move |_event, window, app| {
            if let Some(cb) = &on_select {
                cb(index, window, app);
            }
        })
        .into_any_element()
}

fn emote_item(
    index: usize,
    suggestion: EmoteSuggestion,
    is_selected: bool,
    on_select: Option<SelectCallback>,
) -> AnyElement {
    let label = suggestion.label;
    let image_url = suggestion.image_url;
    let animated = suggestion.animated;

    div()
        .id(format!("emote-autocomplete-item-{index}"))
        .cursor_pointer()
        .rounded(px(8.0))
        .px(px(10.0))
        .py(px(7.0))
        .bg(selected_bg(is_selected))
        .hover(|style| style.bg(rgba(0xffffff0f)))
        .flex()
        .flex_row()
        .items_center()
        .gap(px(10.0))
        .child(
            img(ImageSource::from(image_url))
                .w(px(24.0))
                .h(px(24.0))
                .object_fit(ObjectFit::Contain)
                .with_loading(|| {
                    div()
                        .w(px(24.0))
                        .h(px(24.0))
                        .bg(theme::surface())
                        .into_any_element()
                })
                .with_fallback(|| {
                    div()
                        .w(px(24.0))
                        .h(px(24.0))
                        .bg(theme::surface())
                        .into_any_element()
                }),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme::text_primary())
                        .child(label),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme::text_muted())
                        .child(if animated {
                            "animated 7TV emote"
                        } else {
                            "7TV emote"
                        }),
                ),
        )
        .on_mouse_down(MouseButton::Left, move |_event, window, app| {
            if let Some(cb) = &on_select {
                cb(index, window, app);
            }
        })
        .into_any_element()
}

fn selected_bg(is_selected: bool) -> Rgba {
    if is_selected {
        rgba(0x7c3aed33)
    } else {
        rgba(0x00000000)
    }
}

fn parse_hex_color(value: &str) -> Option<Rgba> {
    let hex = value.strip_prefix('#')?;
    let value = u32::from_str_radix(hex, 16).ok()?;
    Some(rgb(value))
}
