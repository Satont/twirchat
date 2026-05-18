use crate::protocol::rpc::OpenExternalUrlParams;
use crate::runtime::{SystemExternalOpener, browser::open_external_url};
use crate::ui::theme;
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, Element, ElementId, ElementInputHandler,
    Entity, EntityInputHandler, FocusHandle, Focusable, GlobalElementId, HighlightStyle,
    IntoElement, KeyBinding, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    PaintQuad, Pixels, SharedString, StyledText, TextLayout, UTF16Selection, UnderlineStyle,
    Window, actions, div, fill, point, prelude::*, px, rgba,
};
use std::ops::Range;

actions!(twirchat_selectable_text, [Copy]);

pub fn key_bindings() -> [KeyBinding; 2] {
    [
        KeyBinding::new("cmd-c", Copy, Some("TwirChatSelectableText")),
        KeyBinding::new("ctrl-c", Copy, Some("TwirChatSelectableText")),
    ]
}

pub struct SelectableText {
    focus_handle: FocusHandle,
    text: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    layout: Option<TextLayout>,
    link_ranges: Vec<Range<usize>>,
    is_selecting: bool,
    mouse_down_index: Option<usize>,
}

impl SelectableText {
    pub fn new(
        text: impl Into<SharedString>,
        link_ranges: Vec<Range<usize>>,
        cx: &mut Context<Self>,
    ) -> Self {
        let text = text.into();

        Self {
            focus_handle: cx.focus_handle(),
            text,
            selected_range: 0..0,
            selection_reversed: false,
            layout: None,
            link_ranges,
            is_selecting: false,
            mouse_down_index: None,
        }
    }

    pub fn set_text_and_links(
        &mut self,
        text: impl Into<SharedString>,
        link_ranges: Vec<Range<usize>>,
        cx: &mut Context<Self>,
    ) {
        let text = text.into();
        if self.text == text && self.link_ranges == link_ranges {
            return;
        }

        self.text = text;
        self.link_ranges = link_ranges;
        let len = self.text.len();
        self.selected_range = self.selected_range.start.min(len)..self.selected_range.end.min(len);
        self.selection_reversed = false;
        cx.notify();
    }

    fn clamp_offset_to_text(&self, offset: usize) -> usize {
        let mut offset = offset.min(self.text.len());
        while offset > 0 && !self.text.is_char_boundary(offset) {
            offset -= 1;
        }
        offset
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = self.clamp_offset_to_text(offset);
        if self.selection_reversed {
            self.selected_range.start = offset;
        } else {
            self.selected_range.end = offset;
        }

        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }

        cx.notify();
    }

    fn selected_text(&self) -> Option<String> {
        (!self.selected_range.is_empty())
            .then(|| self.text[self.selected_range.clone()].to_string())
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = self.selected_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn text_position_to_offset(&self, position: gpui::Point<Pixels>) -> Option<usize> {
        let layout = self.layout.as_ref()?;
        let local = layout.bounds().localize(&position)?;
        Some(match layout.index_for_position(local) {
            Ok(index) | Err(index) => self.clamp_offset_to_text(index),
        })
    }

    fn open_link_at(&self, offset: usize) {
        let Some(range) = self
            .link_ranges
            .iter()
            .find(|range| range.contains(&offset))
        else {
            return;
        };

        let params = OpenExternalUrlParams {
            url: self.text[range.clone()].to_string(),
        };
        if let Err(error) = open_external_url(&SystemExternalOpener, &params) {
            eprintln!(
                "[ui/selectable_text] failed to open external link `{}`: {}",
                params.url, error
            );
        }
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus_handle, cx);
        let Some(offset) = self.text_position_to_offset(event.position) else {
            return;
        };

        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.is_selecting = true;
        self.mouse_down_index = Some(offset);
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.is_selecting {
            return;
        }

        if let Some(offset) = self.text_position_to_offset(event.position) {
            self.select_to(offset, cx);
        }
    }

    fn on_mouse_up(&mut self, event: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.is_selecting = false;

        let mouse_down_index = self.mouse_down_index.take();
        let mouse_up_index = self.text_position_to_offset(event.position);
        if self.selected_range.is_empty()
            && let (Some(mouse_down_index), Some(mouse_up_index)) =
                (mouse_down_index, mouse_up_index)
            && mouse_down_index == mouse_up_index
        {
            self.open_link_at(mouse_up_index);
        }

        cx.notify();
    }

    fn render_link_highlights(&self) -> StyledText {
        if self.link_ranges.is_empty() {
            return StyledText::new(self.text.clone());
        }

        let accent = theme::accent();
        let highlight = HighlightStyle {
            color: Some(accent.into()),
            underline: Some(UnderlineStyle {
                thickness: px(1.0),
                color: Some(accent.into()),
                wavy: false,
            }),
            ..Default::default()
        };

        StyledText::new(self.text.clone()).with_highlights(
            self.link_ranges
                .iter()
                .cloned()
                .map(|range| (range, highlight)),
        )
    }
}

impl Render for SelectableText {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("TwirChatSelectableText")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::copy))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .w_full()
            .min_w(px(0.0))
            .child(SelectableTextElement {
                text: self.render_link_highlights(),
                state: cx.entity(),
            })
    }
}

impl Focusable for SelectableText {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

struct SelectableTextElement {
    text: StyledText,
    state: Entity<SelectableText>,
}

impl IntoElement for SelectableTextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for SelectableTextElement {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        self.text.request_layout(id, inspector_id, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.text
            .prepaint(id, inspector_id, bounds, layout, window, cx);
        let measured_layout = self.text.layout().clone();
        self.state
            .update(cx, |state, _cx| state.layout = Some(measured_layout));
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let state = self.state.read(cx);
        let focus_handle = state.focus_handle.clone();
        let selected_range = state.selected_range.clone();
        let cursor_offset = state.cursor_offset();
        let text = state.text.clone();
        let measured_layout = state.layout.clone();

        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.state.clone()),
            cx,
        );

        if let Some(layout) = measured_layout.as_ref() {
            for quad in selection_quads(layout, &text, &selected_range) {
                window.paint_quad(quad);
            }
        }

        self.text
            .paint(id, inspector_id, bounds, layout, prepaint, window, cx);

        if focus_handle.is_focused(window)
            && selected_range.is_empty()
            && let Some(layout) = measured_layout.as_ref()
            && let Some(position) = layout.position_for_index(cursor_offset)
        {
            window.paint_quad(fill(
                Bounds::new(
                    point(bounds.left() + position.x, bounds.top() + position.y),
                    gpui::size(px(1.0), layout.line_height()),
                ),
                rgba(0xa78bfaff),
            ));
        }
    }
}

fn selection_quads(
    layout: &TextLayout,
    text: &str,
    selected_range: &Range<usize>,
) -> Vec<PaintQuad> {
    if selected_range.is_empty() {
        return Vec::new();
    }

    let mut groups: Vec<(gpui::Point<Pixels>, gpui::Point<Pixels>)> = Vec::new();
    let mut indices = Vec::new();
    let mut index = selected_range.start;
    indices.push(index);
    while index < selected_range.end {
        let slice = &text[index..selected_range.end];
        let next = slice
            .char_indices()
            .nth(1)
            .map(|(offset, _)| index + offset)
            .unwrap_or(selected_range.end);
        if next == index {
            break;
        }
        index = next;
        indices.push(index);
    }

    let mut current_start = None;
    let mut current_end = None;
    let mut current_y = None;

    for index in indices {
        let Some(position) = layout.position_for_index(index) else {
            continue;
        };
        match current_y {
            Some(y) if y == position.y => {
                current_end = Some(position);
            }
            Some(_) => {
                if let (Some(start), Some(end)) = (current_start, current_end) {
                    groups.push((start, end));
                }
                current_start = Some(position);
                current_end = Some(position);
                current_y = Some(position.y);
            }
            None => {
                current_start = Some(position);
                current_end = Some(position);
                current_y = Some(position.y);
            }
        }
    }

    if let (Some(start), Some(end)) = (current_start, current_end) {
        groups.push((start, end));
    }

    let bounds = layout.bounds();
    let line_height = layout.line_height();
    groups
        .into_iter()
        .filter_map(|(start, end)| {
            (end.x >= start.x).then_some(fill(
                Bounds::from_corners(
                    point(bounds.left() + start.x, bounds.top() + start.y),
                    point(bounds.left() + end.x, bounds.top() + start.y + line_height),
                ),
                rgba(0x7c3aed55),
            ))
        })
        .collect()
}

impl EntityInputHandler for SelectableText {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = utf16_range_to_utf8(&self.text, &range_utf16);
        actual_range.replace(utf8_range_to_utf16(&self.text, &range));
        Some(self.text[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: utf8_range_to_utf16(&self.text, &self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        None
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    fn replace_text_in_range(
        &mut self,
        _range_utf16: Option<Range<usize>>,
        _new_text: &str,
        _: &mut Window,
        _: &mut Context<Self>,
    ) {
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        _range_utf16: Option<Range<usize>>,
        _new_text: &str,
        _new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        _: &mut Context<Self>,
    ) {
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        _bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.layout.as_ref()?;
        let range = utf16_range_to_utf8(&self.text, &range_utf16);
        let start = layout.position_for_index(range.start)?;
        let end = layout.position_for_index(range.end)?;
        Some(Bounds::from_corners(
            point(
                layout.bounds().left() + start.x,
                layout.bounds().top() + start.y,
            ),
            point(
                layout.bounds().left() + end.x,
                layout.bounds().top() + start.y + layout.line_height(),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: gpui::Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        self.text_position_to_offset(point)
            .map(|offset| utf8_offset_to_utf16(&self.text, offset))
    }
}

fn utf8_offset_to_utf16(text: &str, offset: usize) -> usize {
    let mut utf16_offset = 0;
    let mut utf8_count = 0;

    for ch in text.chars() {
        if utf8_count >= offset {
            break;
        }
        utf8_count += ch.len_utf8();
        utf16_offset += ch.len_utf16();
    }

    utf16_offset
}

fn utf16_offset_to_utf8(text: &str, offset: usize) -> usize {
    let mut utf8_offset = 0;
    let mut utf16_count = 0;

    for ch in text.chars() {
        if utf16_count >= offset {
            break;
        }
        utf16_count += ch.len_utf16();
        utf8_offset += ch.len_utf8();
    }

    utf8_offset
}

fn utf8_range_to_utf16(text: &str, range: &Range<usize>) -> Range<usize> {
    utf8_offset_to_utf16(text, range.start)..utf8_offset_to_utf16(text, range.end)
}

fn utf16_range_to_utf8(text: &str, range: &Range<usize>) -> Range<usize> {
    utf16_offset_to_utf8(text, range.start)..utf16_offset_to_utf8(text, range.end)
}
