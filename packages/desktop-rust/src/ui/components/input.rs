use crate::ui::theme;
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, DispatchPhase, Element, ElementId,
    ElementInputHandler, Entity, EntityInputHandler, FocusHandle, Focusable, GlobalElementId,
    Hitbox, HitboxBehavior, IntoElement, KeyBinding, LayoutId, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, PaintQuad, Pixels, Render, ShapedLine, SharedString, Style, TextRun,
    UTF16Selection, Window, actions, div, fill, hsla, point, prelude::*, px, relative, rgb, rgba,
    size,
};
use std::ops::Range;

fn clamp_offset_to_str(content: &str, offset: usize) -> usize {
    let mut offset = offset.min(content.len());
    while offset > 0 && !content.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn previous_word_boundary_in(content: &str, offset: usize) -> usize {
    if offset == 0 {
        return 0;
    }

    let chars: Vec<(usize, char)> = content.char_indices().collect();
    let mut index = chars.partition_point(|(idx, _)| *idx < offset);

    while index > 0 && chars[index - 1].1.is_whitespace() {
        index -= 1;
    }

    while index > 0 && !is_word_char(chars[index - 1].1) && !chars[index - 1].1.is_whitespace() {
        index -= 1;
    }

    while index > 0 && is_word_char(chars[index - 1].1) {
        index -= 1;
    }

    chars.get(index).map(|(idx, _)| *idx).unwrap_or(0)
}

fn next_word_boundary_in(content: &str, offset: usize) -> usize {
    if offset >= content.len() {
        return content.len();
    }

    let chars: Vec<(usize, char)> = content.char_indices().collect();
    let mut index = chars.partition_point(|(idx, _)| *idx < offset);

    if index < chars.len() && is_word_char(chars[index].1) {
        while index < chars.len() && is_word_char(chars[index].1) {
            index += 1;
        }
        return chars
            .get(index)
            .map(|(idx, _)| *idx)
            .unwrap_or(content.len());
    }

    while index < chars.len() && !is_word_char(chars[index].1) {
        index += 1;
    }

    chars
        .get(index)
        .map(|(idx, _)| *idx)
        .unwrap_or(content.len())
}

fn extend_selection_to(
    mut selected_range: Range<usize>,
    mut selection_reversed: bool,
    offset: usize,
) -> (Range<usize>, bool) {
    if selection_reversed {
        selected_range.start = offset;
    } else {
        selected_range.end = offset;
    }

    if selected_range.end < selected_range.start {
        selection_reversed = !selection_reversed;
        selected_range = selected_range.end..selected_range.start;
    }

    (selected_range, selection_reversed)
}

actions!(
    twirchat_input,
    [
        Backspace,
        Delete,
        Enter,
        Left,
        Right,
        WordLeft,
        WordRight,
        SelectLeft,
        SelectRight,
        SelectWordLeft,
        SelectWordRight,
        SelectAll,
        Copy,
        Cut,
        Paste
    ]
);

pub fn key_bindings() -> [KeyBinding; 23] {
    [
        KeyBinding::new("backspace", Backspace, Some("TwirChatInput")),
        KeyBinding::new("delete", Delete, Some("TwirChatInput")),
        KeyBinding::new("enter", Enter, Some("TwirChatInput")),
        KeyBinding::new("left", Left, Some("TwirChatInput")),
        KeyBinding::new("right", Right, Some("TwirChatInput")),
        KeyBinding::new("ctrl-left", WordLeft, Some("TwirChatInput")),
        KeyBinding::new("ctrl-right", WordRight, Some("TwirChatInput")),
        KeyBinding::new("alt-left", WordLeft, Some("TwirChatInput")),
        KeyBinding::new("alt-right", WordRight, Some("TwirChatInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("TwirChatInput")),
        KeyBinding::new("shift-right", SelectRight, Some("TwirChatInput")),
        KeyBinding::new("ctrl-shift-left", SelectWordLeft, Some("TwirChatInput")),
        KeyBinding::new("ctrl-shift-right", SelectWordRight, Some("TwirChatInput")),
        KeyBinding::new("alt-shift-left", SelectWordLeft, Some("TwirChatInput")),
        KeyBinding::new("alt-shift-right", SelectWordRight, Some("TwirChatInput")),
        KeyBinding::new("cmd-a", SelectAll, Some("TwirChatInput")),
        KeyBinding::new("ctrl-a", SelectAll, Some("TwirChatInput")),
        KeyBinding::new("cmd-c", Copy, Some("TwirChatInput")),
        KeyBinding::new("ctrl-c", Copy, Some("TwirChatInput")),
        KeyBinding::new("cmd-x", Cut, Some("TwirChatInput")),
        KeyBinding::new("ctrl-x", Cut, Some("TwirChatInput")),
        KeyBinding::new("cmd-v", Paste, Some("TwirChatInput")),
        KeyBinding::new("ctrl-v", Paste, Some("TwirChatInput")),
    ]
}

pub struct Input {
    focus_handle: FocusHandle,
    placeholder: SharedString,
    content: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    last_layout: Option<ShapedLine>,
    last_bounds: Option<Bounds<Pixels>>,
    submit_requested: bool,
    is_selecting: bool,
    clear_on_copy: bool,
    compact_appearance: bool,
    tab_rename_appearance: bool,
}

impl Input {
    pub fn new(placeholder: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            placeholder: placeholder.into(),
            content: SharedString::default(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            last_layout: None,
            last_bounds: None,
            submit_requested: false,
            is_selecting: false,
            clear_on_copy: false,
            compact_appearance: false,
            tab_rename_appearance: false,
        }
    }

    pub fn with_clear_on_copy(mut self) -> Self {
        self.clear_on_copy = true;
        self
    }

    pub fn with_compact_appearance(mut self) -> Self {
        self.compact_appearance = true;
        self
    }

    pub fn with_tab_rename_appearance(mut self) -> Self {
        self.compact_appearance = true;
        self.tab_rename_appearance = true;
        self
    }

    pub fn text(&self) -> &str {
        self.content.as_ref()
    }

    pub fn set_text(&mut self, text: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.content = text.into();
        self.selected_range = self.content.len()..self.content.len();
        self.marked_range = None;
        self.is_selecting = false;
        cx.notify();
    }

    pub fn set_placeholder(
        &mut self,
        placeholder: impl Into<SharedString>,
        cx: &mut Context<Self>,
    ) {
        self.placeholder = placeholder.into();
        cx.notify();
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.set_text("", cx);
    }

    pub fn take_submit_requested(&mut self) -> bool {
        let requested = self.submit_requested;
        self.submit_requested = false;
        requested
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn clamp_offset_to_content(&self, offset: usize) -> usize {
        clamp_offset_to_str(&self.content, offset)
    }

    fn clamp_range_to_content(&self, range: Range<usize>) -> Range<usize> {
        let start = self.clamp_offset_to_content(range.start);
        let end = self.clamp_offset_to_content(range.end).max(start);
        start..end
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let (selected_range, selection_reversed) =
            extend_selection_to(self.selected_range.clone(), self.selection_reversed, offset);
        self.selected_range = selected_range;
        self.selection_reversed = selection_reversed;

        cx.notify();
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .char_indices()
            .rev()
            .find_map(|(idx, _)| (idx < offset).then_some(idx))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .char_indices()
            .find_map(|(idx, _)| (idx > offset).then_some(idx))
            .unwrap_or(self.content.len())
    }

    fn previous_word_boundary(&self, offset: usize) -> usize {
        previous_word_boundary_in(&self.content, offset)
    }

    fn next_word_boundary(&self, offset: usize) -> usize {
        next_word_boundary_in(&self.content, offset)
    }

    fn selected_text(&self) -> Option<String> {
        (!self.selected_range.is_empty())
            .then(|| self.content[self.selected_range.clone()].to_string())
    }

    fn offset_for_mouse_position(&self, position: gpui::Point<Pixels>) -> Option<usize> {
        let bounds = self.last_bounds?;
        let line = self.last_layout.as_ref()?;
        if self.content.is_empty() {
            return Some(0);
        }

        let x = position.x - bounds.left();
        Some(self.clamp_offset_to_content(line.index_for_x(x).unwrap_or(self.content.len())))
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;

        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }

        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;

        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }

        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range_utf16: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end)
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let cursor = self.cursor_offset();
            let previous = self.content[..cursor]
                .char_indices()
                .next_back()
                .map(|(idx, _)| idx)
                .unwrap_or(cursor);
            self.selected_range = previous..cursor;
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx);
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.end, cx);
        }
    }

    fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_word_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx);
        }
    }

    fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_word_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.end, cx);
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_word_boundary(self.cursor_offset()), cx);
    }

    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_word_boundary(self.cursor_offset()), cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let cursor = self.cursor_offset();
            let next = self.content[cursor..]
                .char_indices()
                .nth(1)
                .map(|(idx, _)| cursor + idx)
                .unwrap_or(self.content.len());
            self.selected_range = cursor..next;
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn enter(&mut self, _: &Enter, _: &mut Window, cx: &mut Context<Self>) {
        self.submit_requested = true;
        cx.notify();
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.selected_range = 0..self.content.len();
        self.selection_reversed = false;
        cx.notify();
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if self.clear_on_copy {
            self.clear(cx);
            return;
        }

        if let Some(text) = self.selected_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = self.selected_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
            self.replace_text_in_range(None, "", window, cx);
        }
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &text, window, cx);
        }
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus_handle, cx);
        if let Some(offset) = self.offset_for_mouse_position(event.position) {
            self.selected_range = offset..offset;
            self.selection_reversed = false;
            self.is_selecting = true;
        }
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !self.is_selecting {
            return;
        }

        if let Some(offset) = self.offset_for_mouse_position(event.position) {
            self.select_to(offset, cx);
        }
    }

    fn on_mouse_up(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        if self.is_selecting
            && let Some(offset) = self.offset_for_mouse_position(event.position)
        {
            self.select_to(offset, cx);
        }
        self.is_selecting = false;
        cx.notify();
    }
}

impl EntityInputHandler for Input {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.clamp_range_to_content(self.range_from_utf16(&range_utf16));
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or_else(|| self.selected_range.clone());
        let range = self.clamp_range_to_content(range);
        let new_text = new_text.replace('\n', " ");
        self.content =
            (self.content[0..range.start].to_owned() + &new_text + &self.content[range.end..])
                .into();
        let cursor = range.start + new_text.len();
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        self.is_selecting = false;
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or_else(|| self.selected_range.clone());
        let range = self.clamp_range_to_content(range);
        self.content =
            (self.content[0..range.start].to_owned() + new_text + &self.content[range.end..])
                .into();
        self.marked_range = Some(range.start..range.start + new_text.len());
        self.selected_range = new_selected_range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        self.is_selecting = false;
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let last_layout = self.last_layout.as_ref()?;
        let range = self.clamp_range_to_content(self.range_from_utf16(&range_utf16));
        Some(Bounds::from_corners(
            point(
                bounds.left() + last_layout.x_for_index(range.start),
                bounds.top(),
            ),
            point(
                bounds.left() + last_layout.x_for_index(range.end),
                bounds.bottom(),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: gpui::Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let line_point = self.last_bounds?.localize(&point)?;
        let last_layout = self.last_layout.as_ref()?;
        if self.content.is_empty() {
            return Some(0);
        }
        let utf8_index = last_layout.index_for_x(point.x - line_point.x)?;
        Some(self.offset_to_utf16(utf8_index))
    }
}

impl Render for Input {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let min_height = if self.tab_rename_appearance {
            20.0
        } else if self.compact_appearance {
            24.0
        } else {
            36.0
        };
        let horizontal_padding = if self.tab_rename_appearance {
            2.0
        } else if self.compact_appearance {
            8.0
        } else {
            12.0
        };
        let text_size = if self.tab_rename_appearance {
            13.0
        } else if self.compact_appearance {
            12.0
        } else {
            13.0
        };
        let border_color = if self.focus_handle.is_focused(_window) {
            if self.tab_rename_appearance {
                rgba(0xffffff30)
            } else {
                rgba(0xa78bfa80)
            }
        } else if self.tab_rename_appearance {
            rgba(0x00000000)
        } else if self.compact_appearance {
            theme::border()
        } else {
            rgb(0x3f3f46)
        };
        let background_color = if self.tab_rename_appearance {
            rgba(0x00000000)
        } else if self.compact_appearance {
            theme::surface_2()
        } else {
            rgb(0x18181b)
        };

        div()
            .key_context("TwirChatInput")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::enter))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::word_left))
            .on_action(cx.listener(Self::word_right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_word_left))
            .on_action(cx.listener(Self::select_word_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::paste))
            .w_full()
            .when(!self.tab_rename_appearance, |el| el.min_h(px(min_height)))
            .when(self.tab_rename_appearance, |el| el.h(px(min_height)))
            .rounded_lg()
            .when(self.compact_appearance, |el| el.rounded_md())
            .when(self.tab_rename_appearance, |el| el.rounded_sm())
            .border_1()
            .border_color(border_color)
            .bg(background_color)
            .px(px(horizontal_padding))
            .flex()
            .items_center()
            .text_size(px(text_size))
            .child(TextElement { input: cx.entity() })
    }
}

impl Focusable for Input {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

struct TextElement {
    input: Entity<Input>,
}

struct PrepaintState {
    hitbox: Hitbox,
    line: Option<ShapedLine>,
    cursor: Option<PaintQuad>,
    selection: Option<PaintQuad>,
}

impl IntoElement for TextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextElement {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = window.line_height().into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let input = self.input.read(cx);
        let content = input.content.clone();
        let selected_range = input.selected_range.clone();
        let cursor = input.cursor_offset();
        let style = window.text_style();
        let is_placeholder = content.is_empty();
        let display_text = if is_placeholder {
            input.placeholder.clone()
        } else {
            content
        };
        let color = if is_placeholder {
            hsla(0., 0., 0.57, 0.47)
        } else {
            style.color
        };
        let run = TextRun {
            len: display_text.len(),
            font: style.font(),
            color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line = window
            .text_system()
            .shape_line(display_text, font_size, &[run], None);
        let cursor_pos = line.x_for_index(cursor);
        let (selection, cursor) = if selected_range.is_empty() {
            (
                None,
                Some(fill(
                    Bounds::new(
                        point(bounds.left() + cursor_pos, bounds.top()),
                        size(px(1.0), bounds.bottom() - bounds.top()),
                    ),
                    rgba(0xa78bfaff),
                )),
            )
        } else {
            (
                Some(fill(
                    Bounds::from_corners(
                        point(
                            bounds.left() + line.x_for_index(selected_range.start),
                            bounds.top(),
                        ),
                        point(
                            bounds.left() + line.x_for_index(selected_range.end),
                            bounds.bottom(),
                        ),
                    ),
                    rgba(0x7c3aed55),
                )),
                None,
            )
        };
        PrepaintState {
            hitbox,
            line: Some(line),
            cursor,
            selection,
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.input.read(cx).focus_handle.clone();
        window.set_cursor_style(CursorStyle::IBeam, &prepaint.hitbox);
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );

        let input_entity = self.input.clone();
        let input_hitbox = prepaint.hitbox.clone();
        let input_focus = focus_handle.clone();
        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble || !input_hitbox.is_hovered(window) {
                return;
            }

            input_entity.update(cx, |input, cx| {
                input.on_mouse_down(event, window, cx);
            });
            window.refresh();
            window.focus(&input_focus, cx);
        });

        let input_entity = self.input.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }

            input_entity.update(cx, |input, cx| input.on_mouse_move(event, cx));
            window.refresh();
        });

        let input_entity = self.input.clone();
        window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }

            input_entity.update(cx, |input, cx| input.on_mouse_up(event, cx));
            window.refresh();
        });

        if let Some(selection) = prepaint.selection.take() {
            window.paint_quad(selection);
        }
        let Some(line) = prepaint.line.take() else {
            eprintln!("input paint skipped: missing prepaint line");
            self.input.update(cx, |input, _cx| {
                input.last_layout = None;
                input.last_bounds = Some(bounds);
            });
            return;
        };

        if let Err(error) = line.paint(
            bounds.origin,
            window.line_height(),
            gpui::TextAlign::Left,
            None,
            window,
            cx,
        ) {
            eprintln!("input paint failed: {error}");
        }
        if focus_handle.is_focused(window)
            && let Some(cursor) = prepaint.cursor.take()
        {
            window.paint_quad(cursor);
        }
        self.input.update(cx, |input, _cx| {
            input.last_layout = Some(line);
            input.last_bounds = Some(bounds);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_offset_to_str, extend_selection_to, next_word_boundary_in, previous_word_boundary_in,
    };

    #[test]
    fn clamp_offset_handles_placeholder_range_on_empty_content() {
        assert_eq!(clamp_offset_to_str("", 39), 0);
    }

    #[test]
    fn clamp_offset_preserves_utf8_boundaries() {
        assert_eq!(clamp_offset_to_str("тест", 3), 2);
        assert_eq!(clamp_offset_to_str("тест", 99), "тест".len());
    }

    #[test]
    fn word_boundaries_match_expected_navigation() {
        let content = "hello   brave_new world!";

        assert_eq!(next_word_boundary_in(content, 0), 5);
        assert_eq!(next_word_boundary_in(content, 5), 8);
        assert_eq!(next_word_boundary_in(content, 17), 18);
        assert_eq!(previous_word_boundary_in(content, 23), 18);
        assert_eq!(previous_word_boundary_in(content, 17), 8);
        assert_eq!(previous_word_boundary_in(content, 8), 0);
    }

    #[test]
    fn extend_selection_normalizes_forward_and_reversed_ranges() {
        assert_eq!(extend_selection_to(2..2, false, 5), (2..5, false));
        assert_eq!(extend_selection_to(2..5, false, 1), (1..2, true));
        assert_eq!(extend_selection_to(1..2, true, 4), (2..4, false));
    }
}
