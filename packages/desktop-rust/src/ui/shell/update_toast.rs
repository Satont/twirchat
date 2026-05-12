use crate::app_state::{AppState, AppStateActions};
use crate::ui::theme;
use gpui::{App, Entity, IntoElement, RenderOnce, Window, div, prelude::*, px, rgba};

#[derive(IntoElement)]
pub struct UpdateToast {
    state_entity: Entity<AppState>,
}

impl UpdateToast {
    pub fn new(state_entity: Entity<AppState>) -> Self {
        Self { state_entity }
    }
}

impl RenderOnce for UpdateToast {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = self.state_entity.read(cx);
        let update_state = state.update_state();

        if !update_state.show {
            return div().id("update-toast-hidden");
        }

        let is_complete = update_state.status.as_deref() == Some("download-complete");
        let is_available = update_state.status.as_deref() == Some("update-available");
        let has_hash = update_state.hash.is_some();
        let state_entity_clone = self.state_entity.clone();

        div()
            .id("update-toast")
            .absolute()
            .top(px(16.0))
            .right(px(16.0))
            .bg(theme::surface())
            .border_1()
            .border_color(theme::border())
            .rounded_xl()
            .p(px(16.0))
            .min_w(px(300.0))
            .shadow_lg()
            .flex()
            .items_center()
            .gap(px(12.0))
            .child(
                div()
                    .text_color(theme::accent())
                    .text_size(px(18.0))
                    .child("↻"),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(theme::text_primary())
                            .child(update_state.message.clone()),
                    )
                    .when_some(update_state.progress, |el, p| {
                        el.child(
                            div()
                                .mt(px(8.0))
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(
                                    div()
                                        .flex_1()
                                        .h(px(4.0))
                                        .bg(theme::surface_2())
                                        .rounded_sm()
                                        .child(
                                            div()
                                                .h_full()
                                                .bg(theme::accent())
                                                .rounded_sm()
                                                .w(px(p as f32 * 2.0)), // Pseudo-width for visual tests
                                        ),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme::text_muted())
                                        .min_w(px(32.0))
                                        .child(format!("{:.0}%", p)),
                                ),
                        )
                    }),
            )
            .when(is_complete, |el| {
                el.child(
                    div()
                        .id("update-btn-restart")
                        .bg(theme::accent())
                        .text_color(rgba(0xffffffff))
                        .rounded_md()
                        .px(px(12.0))
                        .py(px(6.0))
                        .text_size(px(12.0))
                        .font_weight(gpui::FontWeight::BOLD)
                        .cursor_pointer()
                        .on_click(|_, _, _| {
                            // Apply update handler
                        })
                        .child("Restart"),
                )
            })
            .when(is_available && has_hash, |el| {
                el.child(
                    div()
                        .id("update-btn-skip")
                        .bg(rgba(0x00000000))
                        .text_color(theme::text_muted())
                        .border_1()
                        .border_color(theme::border())
                        .rounded_md()
                        .px(px(12.0))
                        .py(px(6.0))
                        .text_size(px(12.0))
                        .font_weight(gpui::FontWeight::BOLD)
                        .cursor_pointer()
                        .on_click(|_, _, _| {
                            // Skip update handler
                        })
                        .child("Skip"),
                )
            })
            .child(
                div()
                    .id("update-toast-close")
                    .cursor_pointer()
                    .p(px(4.0))
                    .text_color(theme::text_muted())
                    .hover(|style| style.text_color(theme::text_primary()))
                    .on_click(move |_, _, cx| {
                        state_entity_clone.dismiss_update_toast(cx);
                    })
                    .child("×"),
            )
    }
}
