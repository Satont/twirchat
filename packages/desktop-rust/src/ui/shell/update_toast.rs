use crate::app_state::{AppState, AppStateActions};
use crate::ui::shell::app::TwirChatApp;
use crate::ui::theme;
use gpui::{App, Entity, IntoElement, RenderOnce, Rgba, Window, div, prelude::*, px};

#[derive(IntoElement)]
pub struct UpdateToast {
    state_entity: Entity<AppState>,
    app_entity: Entity<TwirChatApp>,
}

impl UpdateToast {
    pub fn new(state_entity: Entity<AppState>, app_entity: Entity<TwirChatApp>) -> Self {
        Self {
            state_entity,
            app_entity,
        }
    }
}

impl RenderOnce for UpdateToast {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = self.state_entity.read(cx);
        let update_state = state.update_state();

        if !update_state.show {
            return div().id("update-toast-hidden");
        }

        let status = update_state.status.as_deref();
        let is_available = status == Some("update-available");
        let is_complete = status == Some("download-complete");
        let is_error = status == Some("error");
        let is_download_progress = status.is_some_and(is_download_progress_status);
        let skip_identifier = update_state.hash.clone();
        let title = update_title(status);
        let icon = update_icon(status);
        let progress = update_state
            .progress
            .map(|progress| progress.clamp(0.0, 100.0));
        let state_entity = self.state_entity.clone();
        let download_entity = self.app_entity.clone();
        let apply_entity = self.app_entity.clone();
        let skip_entity = self.app_entity.clone();

        div()
            .id("update-toast")
            .absolute()
            .top(px(16.0))
            .right(px(16.0))
            .w(px(360.0))
            .max_w(px(420.0))
            .bg(theme::surface())
            .border_1()
            .border_color(if is_error {
                theme::red()
            } else {
                theme::border()
            })
            .rounded_lg()
            .shadow_lg()
            .child(
                div()
                    .p(px(16.0))
                    .flex()
                    .flex_col()
                    .gap(px(14.0))
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(12.0))
                            .child(status_icon(icon, status_color(status)))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.0))
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(theme::text_primary())
                                            .child(title),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .line_height(gpui::relative(1.35))
                                            .text_color(theme::text_muted())
                                            .child(update_state.message.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .id("update-toast-close")
                                    .cursor_pointer()
                                    .rounded_md()
                                    .px(px(7.0))
                                    .py(px(3.0))
                                    .text_size(px(13.0))
                                    .text_color(theme::text_muted())
                                    .hover(|style| {
                                        style
                                            .bg(theme::surface_2())
                                            .text_color(theme::text_primary())
                                    })
                                    .on_mouse_down(gpui::MouseButton::Left, move |_, _, cx| {
                                        state_entity.dismiss_update_toast(cx);
                                    })
                                    .child("x"),
                            ),
                    )
                    .when_some(progress, |el, progress| {
                        el.child(progress_bar(progress, is_download_progress || is_complete))
                    })
                    .when(is_available || is_complete, |el| {
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .justify_end()
                                .gap(px(8.0))
                                .when(is_available && skip_identifier.is_some(), |actions| {
                                    if let Some(skip_identifier) = skip_identifier.clone() {
                                        actions.child(
                                            secondary_action("update-btn-skip", "Skip")
                                                .on_mouse_down(
                                                    gpui::MouseButton::Left,
                                                    move |_event, _window, app| {
                                                        skip_entity.update(app, |this, cx| {
                                                            this.skip_update(
                                                                skip_identifier.clone(),
                                                                cx,
                                                            );
                                                        });
                                                    },
                                                ),
                                        )
                                    } else {
                                        actions
                                    }
                                })
                                .when(is_available, |actions| {
                                    actions.child(
                                        primary_action("update-btn-download", "Download")
                                            .on_mouse_down(
                                                gpui::MouseButton::Left,
                                                move |_event, _window, app| {
                                                    download_entity.update(app, |this, cx| {
                                                        this.download_update(cx);
                                                    });
                                                },
                                            ),
                                    )
                                })
                                .when(is_complete, |actions| {
                                    actions.child(
                                        primary_action("update-btn-restart", "Restart")
                                            .on_mouse_down(
                                                gpui::MouseButton::Left,
                                                move |_event, _window, app| {
                                                    apply_entity.update(app, |this, cx| {
                                                        this.apply_update(cx);
                                                    });
                                                },
                                            ),
                                    )
                                }),
                        )
                    }),
            )
    }
}

fn update_title(status: Option<&str>) -> &'static str {
    match status {
        Some("update-available") => "Update ready to download",
        Some("download-complete") => "Update ready to apply",
        Some("checking") => "Checking for updates",
        Some("error") => "Update failed",
        Some("no-update") => "TwirChat is up to date",
        Some("applying")
        | Some("extracting")
        | Some("replacing-app")
        | Some("launching-new-version")
        | Some("complete") => "Applying update",
        Some(status) if is_download_progress_status(status) => "Downloading update",
        _ => "Update status",
    }
}

fn update_icon(status: Option<&str>) -> &'static str {
    match status {
        Some("download-complete") | Some("complete") => "✓",
        Some("error") => "!",
        Some("update-available") => "↓",
        Some(status) if is_download_progress_status(status) => "↓",
        _ => "↻",
    }
}

fn status_color(status: Option<&str>) -> Rgba {
    match status {
        Some("download-complete") | Some("complete") => theme::green(),
        Some("error") => theme::red(),
        _ => theme::accent(),
    }
}

fn is_download_progress_status(status: &str) -> bool {
    matches!(
        status,
        "download-starting"
            | "checking-local-tar"
            | "local-tar-found"
            | "local-tar-missing"
            | "fetching-patch"
            | "patch-found"
            | "patch-not-found"
            | "downloading-patch"
            | "applying-patch"
            | "patch-applied"
            | "extracting-version"
            | "patch-chain-complete"
            | "downloading-full-bundle"
            | "download-progress"
            | "decompressing"
    )
}

fn status_icon(icon: &'static str, color: Rgba) -> impl IntoElement {
    div()
        .w(px(34.0))
        .h(px(34.0))
        .rounded_lg()
        .bg(with_alpha(color, 0.16))
        .border_1()
        .border_color(with_alpha(color, 0.4))
        .text_color(color)
        .text_size(px(17.0))
        .font_weight(gpui::FontWeight::BOLD)
        .flex()
        .items_center()
        .justify_center()
        .child(icon)
}

fn progress_bar(progress: f64, emphasized: bool) -> impl IntoElement {
    let track_width = 220.0;
    let fill_width = track_width * (progress as f32 / 100.0);

    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            div()
                .w(px(track_width))
                .h(px(6.0))
                .bg(theme::surface_2())
                .rounded_full()
                .overflow_hidden()
                .child(
                    div()
                        .h_full()
                        .w(px(fill_width))
                        .bg(if emphasized {
                            theme::green()
                        } else {
                            theme::accent()
                        })
                        .rounded_full(),
                ),
        )
        .child(
            div()
                .min_w(px(38.0))
                .text_size(px(11.0))
                .text_color(theme::text_muted())
                .child(format!("{progress:.0}%")),
        )
}

fn primary_action(id: &'static str, label: &'static str) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .bg(theme::accent())
        .text_color(theme::background())
        .rounded_md()
        .px(px(12.0))
        .py(px(6.0))
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::BOLD)
        .cursor_pointer()
        .hover(|style| style.bg(theme::accent_strong()))
        .child(label)
}

fn secondary_action(id: &'static str, label: &'static str) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .bg(theme::surface())
        .text_color(theme::text_muted())
        .border_1()
        .border_color(theme::border())
        .rounded_md()
        .px(px(12.0))
        .py(px(6.0))
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::BOLD)
        .cursor_pointer()
        .hover(|style| {
            style
                .bg(theme::surface_2())
                .text_color(theme::text_primary())
        })
        .child(label)
}

fn with_alpha(color: Rgba, alpha: f32) -> Rgba {
    Rgba { a: alpha, ..color }
}
