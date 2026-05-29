use crate::protocol::rpc::OpenExternalUrlParams;
use crate::protocol::types::Emote;
use crate::runtime::{SystemExternalOpener, browser::open_external_url};
use crate::ui::components::{animated_emote, emote_tooltip};
use crate::ui::theme;
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, DispatchPhase, Element, ElementId, Entity,
    FocusHandle, Focusable, Font, Global, GlobalElementId, HighlightStyle, Hitbox, HitboxBehavior,
    IntoElement, KeyBinding, LayoutId, MouseDownEvent, MouseMoveEvent, MouseUpEvent, PaintQuad,
    Pixels, SharedString, StyledText, TextLayout, UnderlineStyle, Window, actions, div, fill,
    point, prelude::*, px, rgba,
};
use std::ops::Range;

actions!(twirchat_selectable_message, [Copy]);

pub type CustomMessagePart =
    std::sync::Arc<dyn Fn(&mut Window, &mut App) -> gpui::AnyElement + Send + Sync>;

#[derive(Default)]
struct ActiveChatSelection(Option<SharedString>);

impl Global for ActiveChatSelection {}

pub fn key_bindings() -> [KeyBinding; 2] {
    [
        KeyBinding::new("cmd-c", Copy, Some("TwirChatSelectableMessage")),
        KeyBinding::new("ctrl-c", Copy, Some("TwirChatSelectableMessage")),
    ]
}

#[derive(Clone)]
pub enum SelectableMessagePart {
    Text {
        text: SharedString,
        source_range: Range<usize>,
        is_link: bool,
    },
    Emote {
        emote: Emote,
        source_range: Range<usize>,
        message_id: SharedString,
        part_index: usize,
        is_compact: bool,
    },
    Custom(CustomMessagePart),
}

pub struct SelectableMessage {
    message_id: SharedString,
    focus_handle: FocusHandle,
    source_text: SharedString,
    parts: Vec<SelectableMessagePart>,
    selected_range: Range<usize>,
    selection_reversed: bool,
    is_selecting: bool,
    mouse_down_index: Option<usize>,
    font_size: f32,
    font: Font,
    link_ranges: Vec<Range<usize>>,
}

impl SelectableMessage {
    pub fn new(
        message_id: impl Into<SharedString>,
        source_text: impl Into<SharedString>,
        parts: Vec<SelectableMessagePart>,
        font_size: f32,
        font: Font,
        cx: &mut Context<Self>,
    ) -> Self {
        let message_id = message_id.into();
        let source_text = source_text.into();
        let link_ranges = parts
            .iter()
            .filter_map(|part| match part {
                SelectableMessagePart::Text {
                    source_range,
                    is_link: true,
                    ..
                } => Some(source_range.clone()),
                _ => None,
            })
            .collect();

        cx.default_global::<ActiveChatSelection>();
        cx.observe_global::<ActiveChatSelection>(|_, cx| cx.notify())
            .detach();

        Self {
            message_id,
            focus_handle: cx.focus_handle(),
            source_text,
            parts,
            selected_range: 0..0,
            selection_reversed: false,
            is_selecting: false,
            mouse_down_index: None,
            font_size,
            font,
            link_ranges,
        }
    }

    pub fn set_content(
        &mut self,
        source_text: impl Into<SharedString>,
        parts: Vec<SelectableMessagePart>,
        font_size: f32,
        font: Font,
        cx: &mut Context<Self>,
    ) {
        let source_text = source_text.into();
        if self.source_text == source_text && self.font_size == font_size && self.font == font {
            return;
        }

        self.source_text = source_text;
        self.parts = parts;
        self.font_size = font_size;
        self.font = font;
        self.link_ranges = self
            .parts
            .iter()
            .filter_map(|part| match part {
                SelectableMessagePart::Text {
                    source_range,
                    is_link: true,
                    ..
                } => Some(source_range.clone()),
                _ => None,
            })
            .collect();

        let len = self.source_text.len();
        self.selected_range = self.selected_range.start.min(len)..self.selected_range.end.min(len);
        self.selection_reversed = false;
        cx.notify();
    }

    fn clamp_offset(&self, offset: usize) -> usize {
        let mut offset = offset.min(self.source_text.len());
        while offset > 0 && !self.source_text.is_char_boundary(offset) {
            offset -= 1;
        }
        offset
    }

    fn selected_text(&self) -> Option<String> {
        (!self.selected_range.is_empty())
            .then(|| self.source_text[self.selected_range.clone()].to_string())
    }

    fn on_copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = self.selected_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn on_mouse_down_at(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = self.clamp_offset(offset);
        cx.update_global::<ActiveChatSelection, _>(|active, _| {
            active.0 = Some(self.message_id.clone())
        });
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.is_selecting = true;
        self.mouse_down_index = Some(offset);
        cx.notify();
    }

    fn on_mouse_move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if !self.is_selecting {
            return;
        }

        let offset = self.clamp_offset(offset);
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

    fn on_mouse_up_at(&mut self, offset: Option<usize>, cx: &mut Context<Self>) {
        self.is_selecting = false;

        let mouse_down_index = self.mouse_down_index.take();
        if self.selected_range.is_empty()
            && let (Some(mouse_down_index), Some(mouse_up_index)) = (mouse_down_index, offset)
            && mouse_down_index == mouse_up_index
            && let Some(range) = self
                .link_ranges
                .iter()
                .find(|range| range.contains(&mouse_up_index))
        {
            let params = OpenExternalUrlParams {
                url: self.source_text[range.clone()].to_string(),
            };
            if let Err(error) = open_external_url(&SystemExternalOpener, &params) {
                eprintln!(
                    "[ui/selectable_message] failed to open external link `{}`: {}",
                    params.url, error
                );
            }
        }

        cx.notify();
    }
}

impl Render for SelectableMessage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let is_active = cx.read_global(|active: &ActiveChatSelection, _| {
            active.0.as_ref() == Some(&self.message_id)
        });
        if !is_active && !self.selected_range.is_empty() {
            self.selected_range = 0..0;
            self.selection_reversed = false;
            self.is_selecting = false;
            self.mouse_down_index = None;
        }

        let mut parts = Vec::with_capacity(self.parts.len());
        for part in self.parts.iter().cloned() {
            let element = match part {
                SelectableMessagePart::Text {
                    text,
                    source_range,
                    is_link,
                } => SelectableTextPartElement::new(cx.entity(), text, source_range, is_link)
                    .into_any_element(),
                SelectableMessagePart::Emote {
                    emote,
                    source_range,
                    message_id,
                    part_index,
                    is_compact,
                } => {
                    let is_selected = ranges_overlap(&self.selected_range, &source_range);
                    let state = cx.entity();
                    let focus_handle = self.focus_handle.clone();
                    div()
                        .id(format!(
                            "emote-tooltip-target-{}-{}-{}",
                            message_id, emote.id, part_index
                        ))
                        .mx(px(1.5))
                        .h(px(if is_compact { 20.0 } else { 24.0 }))
                        .min_w(px(if is_compact { 20.0 } else { 24.0 }))
                        .max_w(px(if is_compact { 20.0 } else { 24.0 }
                            * emote.aspect_ratio.unwrap_or(1.0) as f32))
                        .when(is_selected, |el| el.bg(rgba(0x7c3aed55)).rounded_sm())
                        .on_mouse_down(gpui::MouseButton::Left, move |_, window, cx| {
                            window.focus(&focus_handle, cx);
                            state.update(cx, |state, cx| {
                                state.on_mouse_down_at(source_range.start, cx)
                            });
                        })
                        .on_mouse_move({
                            let state = cx.entity();
                            let source_range = source_range.clone();
                            move |_, _, cx| {
                                state.update(cx, |state, cx| {
                                    state.on_mouse_move_to(source_range.end, cx)
                                });
                            }
                        })
                        .on_mouse_up(gpui::MouseButton::Left, {
                            let state = cx.entity();
                            let source_range = source_range.clone();
                            move |_, _, cx| {
                                state.update(cx, |state, cx| {
                                    state.on_mouse_up_at(Some(source_range.end), cx)
                                });
                            }
                        })
                        .hoverable_tooltip(emote_tooltip(
                            emote.clone(),
                            format!("{}-{}-{}", message_id, emote.id, part_index),
                        ))
                        .child(animated_emote(
                            format!("emote-{}-{}-{}", message_id, emote.id, part_index),
                            emote.image_url.clone(),
                            emote.name.clone(),
                            window,
                            cx,
                        ))
                        .into_any_element()
                }
                SelectableMessagePart::Custom(render_fn) => render_fn(window, cx),
            };

            parts.push(element);
        }

        div()
            .key_context("TwirChatSelectableMessage")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .w_full()
            .min_w(px(0.0))
            .flex()
            .flex_row()
            .flex_wrap()
            .items_center()
            .whitespace_normal()
            .font(self.font.clone())
            .text_size(px(self.font_size))
            .text_color(theme::text_primary())
            .on_action(cx.listener(Self::on_copy))
            .children(parts)
    }
}

impl Focusable for SelectableMessage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

struct SelectableTextPartElement {
    state: Entity<SelectableMessage>,
    text: StyledText,
    source_range: Range<usize>,
    local_text: SharedString,
    is_link: bool,
}

impl SelectableTextPartElement {
    fn new(
        state: Entity<SelectableMessage>,
        text: SharedString,
        source_range: Range<usize>,
        is_link: bool,
    ) -> Self {
        let styled = if is_link {
            let accent = theme::accent();
            StyledText::new(text.clone()).with_highlights(std::iter::once((
                0..text.len(),
                HighlightStyle {
                    color: Some(accent.into()),
                    underline: Some(UnderlineStyle {
                        thickness: px(1.0),
                        color: Some(accent.into()),
                        wavy: false,
                    }),
                    ..Default::default()
                },
            )))
        } else {
            StyledText::new(text.clone())
        };

        Self {
            state,
            text: styled,
            source_range,
            local_text: text,
            is_link,
        }
    }
}

impl IntoElement for SelectableTextPartElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for SelectableTextPartElement {
    type RequestLayoutState = ();
    type PrepaintState = Hitbox;

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
        window.insert_hitbox(bounds, HitboxBehavior::Normal)
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        window.set_cursor_style(
            if self.is_link {
                CursorStyle::PointingHand
            } else {
                CursorStyle::IBeam
            },
            hitbox,
        );

        let state = self.state.read(cx);
        let selected_range = state.selected_range.clone();
        let focus_handle = state.focus_handle.clone();
        let _ = state;

        let layout_snapshot = self.text.layout().clone();
        let hitbox_snapshot = hitbox.clone();
        let state_entity = self.state.clone();
        let source_range = self.source_range.clone();
        let local_text_len = self.local_text.len();
        let text_bounds = bounds;
        let focus_handle_for_down = focus_handle.clone();
        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble || !hitbox_snapshot.is_hovered(window) {
                return;
            }

            let local_offset = local_offset_for_position(
                &layout_snapshot,
                text_bounds,
                event.position,
                local_text_len,
            );
            window.focus(&focus_handle_for_down, cx);
            state_entity.update(cx, |state, cx| {
                state.on_mouse_down_at(source_range.start + local_offset, cx)
            });
            window.refresh();
        });

        let layout_snapshot = self.text.layout().clone();
        let hitbox_snapshot = hitbox.clone();
        let state_entity = self.state.clone();
        let source_range = self.source_range.clone();
        let local_text_len = self.local_text.len();
        let text_bounds = bounds;
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble || !hitbox_snapshot.is_hovered(window) {
                return;
            }

            let local_offset = local_offset_for_position(
                &layout_snapshot,
                text_bounds,
                event.position,
                local_text_len,
            );
            state_entity.update(cx, |state, cx| {
                state.on_mouse_move_to(source_range.start + local_offset, cx)
            });
            window.refresh();
        });

        let layout_snapshot = self.text.layout().clone();
        let hitbox_snapshot = hitbox.clone();
        let state_entity = self.state.clone();
        let source_range = self.source_range.clone();
        let local_text_len = self.local_text.len();
        let text_bounds = bounds;
        window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble || !hitbox_snapshot.is_hovered(window) {
                return;
            }

            let local_offset = local_offset_for_position(
                &layout_snapshot,
                text_bounds,
                event.position,
                local_text_len,
            );
            state_entity.update(cx, |state, cx| {
                state.on_mouse_up_at(Some(source_range.start + local_offset), cx)
            });
            window.refresh();
        });

        if let Some(local_selection) = intersect_local_range(&selected_range, &self.source_range) {
            for quad in selection_quads(self.text.layout(), &self.local_text, &local_selection) {
                window.paint_quad(quad);
            }
        }

        self.text
            .paint(id, inspector_id, bounds, layout, &mut (), window, cx);
    }
}

fn intersect_local_range(
    selection: &Range<usize>,
    source_range: &Range<usize>,
) -> Option<Range<usize>> {
    let start = selection.start.max(source_range.start);
    let end = selection.end.min(source_range.end);
    if start < end {
        Some(start - source_range.start..end - source_range.start)
    } else {
        None
    }
}

fn local_offset_for_position(
    layout: &TextLayout,
    bounds: Bounds<Pixels>,
    position: gpui::Point<Pixels>,
    text_len: usize,
) -> usize {
    if position.x >= bounds.right() {
        return text_len;
    }

    match layout.index_for_position(position) {
        Ok(index) | Err(index) => index.min(text_len),
    }
}

fn ranges_overlap(left: &Range<usize>, right: &Range<usize>) -> bool {
    left.start < right.end && right.start < left.end
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

    let line_height = layout.line_height();
    groups
        .into_iter()
        .filter_map(|(start, end)| {
            (end.x >= start.x).then_some(fill(
                Bounds::from_corners(point(start.x, start.y), point(end.x, start.y + line_height)),
                rgba(0x7c3aed55),
            ))
        })
        .collect()
}
