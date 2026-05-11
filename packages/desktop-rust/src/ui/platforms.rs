#![allow(dead_code)]

use crate::protocol::messages::{CategorySearchResult, StreamStatusResponse};
use crate::protocol::types::{
    Account, Platform, PlatformStatus, PlatformStatusInfo, PlatformStatusMode,
};
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::shared::panel_title;
use crate::ui::theme;
use gpui::{Div, div, prelude::*, px, rgb};
use std::collections::BTreeMap;

pub struct StreamEditor {
    pub platform: Platform,
    pub channel_id: String,

    pub is_live: bool,
    pub title: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub viewer_count: Option<u64>,
    pub load_error: Option<String>,
    pub loading: bool,

    pub editing: bool,
    pub edit_title: String,
    pub edit_category_id: Option<String>,
    pub edit_category_name: Option<String>,
    pub saving: bool,
    pub save_error: Option<String>,
    pub save_success: bool,

    pub category_query: String,
    pub category_results: Vec<CategorySearchResult>,
    pub search_loading: bool,
}

impl StreamEditor {
    pub fn new(platform: Platform, channel_id: String) -> Self {
        Self {
            platform,
            channel_id,
            is_live: false,
            title: String::new(),
            category_id: None,
            category_name: None,
            viewer_count: None,
            load_error: None,
            loading: false,

            editing: false,
            edit_title: String::new(),
            edit_category_id: None,
            edit_category_name: None,
            saving: false,
            save_error: None,
            save_success: false,

            category_query: String::new(),
            category_results: Vec::new(),
            search_loading: false,
        }
    }

    pub fn start_edit(&mut self) {
        self.editing = true;
        self.edit_title = self.title.clone();
        self.edit_category_id = self.category_id.clone();
        self.edit_category_name = self.category_name.clone();
        self.category_query = self.category_name.clone().unwrap_or_default();
        self.category_results.clear();
        self.save_error = None;
        self.save_success = false;
    }

    pub fn cancel_edit(&mut self) {
        self.editing = false;
    }

    pub fn apply_status(&mut self, status: StreamStatusResponse) {
        self.is_live = status.is_live;
        self.title = status.title;
        self.category_id = status.category_id;
        self.category_name = status.category_name;
        self.viewer_count = status.viewer_count;
        self.loading = false;
        self.load_error = None;
    }

    pub fn select_category(&mut self, category: CategorySearchResult) {
        self.edit_category_id = Some(category.id);
        self.edit_category_name = Some(category.name.clone());
        self.category_query = category.name;
        self.category_results.clear();
    }

    pub fn complete_save(&mut self) {
        self.title = self.edit_title.clone();
        self.category_id = self.edit_category_id.clone();
        self.category_name = self.edit_category_name.clone();
        self.save_success = true;
        self.saving = false;
        self.editing = false;
    }
}

#[derive(Debug, Clone)]
pub struct PlatformsPanel {
    pub accounts: Vec<Account>,
    pub statuses: BTreeMap<Platform, PlatformStatusInfo>,

    pub channel_inputs: BTreeMap<Platform, String>,
    pub joining_channel: BTreeMap<Platform, bool>,
    pub auth_loading: BTreeMap<Platform, bool>,
    pub joined_channels: BTreeMap<Platform, Vec<String>>,
    pub toasts: Vec<Toast>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub id: usize,
    pub platform: Platform,
    pub kind: ToastKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastKind {
    Success,
    Error,
}

impl PlatformsPanel {
    pub fn new() -> Self {
        Self {
            accounts: Vec::new(),
            statuses: BTreeMap::new(),
            channel_inputs: BTreeMap::new(),
            joining_channel: BTreeMap::new(),
            auth_loading: BTreeMap::new(),
            joined_channels: BTreeMap::new(),
            toasts: Vec::new(),
        }
    }

    pub fn account(&self, platform: Platform) -> Option<&Account> {
        self.accounts.iter().find(|a| a.platform == platform)
    }

    pub fn status(&self, platform: Platform) -> Option<&PlatformStatusInfo> {
        self.statuses.get(&platform)
    }

    pub fn add_toast(&mut self, platform: Platform, kind: ToastKind, message: String) {
        let id = self.toasts.len();
        self.toasts.push(Toast {
            id,
            platform,
            kind,
            message,
        });
    }

    pub fn join_channel(&mut self, platform: Platform, slug: String) {
        let entry = self.joined_channels.entry(platform).or_default();
        if !entry.contains(&slug) {
            entry.push(slug);
        }
    }

    pub fn leave_channel(&mut self, platform: Platform, slug: &str) {
        if let Some(entry) = self.joined_channels.get_mut(&platform) {
            entry.retain(|c| c != slug);
        }
    }
}

fn status_label(info: Option<&PlatformStatusInfo>) -> String {
    match info {
        None => "Not connected".to_string(),
        Some(s) => match s.status {
            PlatformStatus::Connected => match s.mode {
                PlatformStatusMode::Authenticated => "Connected".to_string(),
                PlatformStatusMode::Anonymous => "Connected (anonymous)".to_string(),
            },
            PlatformStatus::Connecting => "Connecting…".to_string(),
            PlatformStatus::Error => s.error.clone().unwrap_or_else(|| "Error".to_string()),
            PlatformStatus::Disconnected => "Disconnected".to_string(),
        },
    }
}

fn status_color(info: Option<&PlatformStatusInfo>) -> gpui::Rgba {
    match info {
        None => theme::text_muted(),
        Some(s) => match s.status {
            PlatformStatus::Connected => theme::green(),
            PlatformStatus::Connecting => rgb(0xf59e0b),
            PlatformStatus::Error => theme::red(),
            PlatformStatus::Disconnected => theme::text_muted(),
        },
    }
}

pub(crate) fn panel(state: &PlatformsPanel) -> Div {
    let platforms = [Platform::Twitch, Platform::Youtube, Platform::Kick];

    div()
        .flex_1()
        .p(px(28.0))
        .px(px(32.0))
        .flex()
        .flex_col()
        .gap(px(24.0))
        .child(panel_title(
            "Platforms",
            "Connect your streaming accounts and join channels",
        ))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(16.0))
                .children(platforms.into_iter().map(|platform| {
                    let display_name = match platform {
                        Platform::Twitch => "Twitch",
                        Platform::Youtube => "YouTube",
                        Platform::Kick => "Kick",
                    };

                    let models_platform = match platform {
                        Platform::Twitch => crate::models::Platform::Twitch,
                        Platform::Youtube => crate::models::Platform::YouTube,
                        Platform::Kick => crate::models::Platform::Kick,
                    };

                    let account = state.account(platform);
                    let status_info = state.status(platform);
                    let status_text = status_label(status_info);
                    let dot_color = status_color(status_info);

                    div()
                        .rounded_lg()
                        .bg(theme::surface())
                        .border_1()
                        .border_color(theme::border())
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(14.0))
                                .p(px(18.0))
                                .px(px(20.0))
                                .border_b_1()
                                .border_color(theme::border())
                                .child(
                                    div()
                                        .w(px(42.0))
                                        .h(px(42.0))
                                        .rounded_md()
                                        .bg(theme::platform_color(models_platform))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .child(
                                            PlatformIcon::new(models_platform)
                                                .size(px(20.0))
                                                .color(if platform == Platform::Kick {
                                                    rgb(0x000000)
                                                } else {
                                                    rgb(0xffffff)
                                                }),
                                        ),
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.0))
                                        .child(
                                            div()
                                                .text_size(px(15.0))
                                                .font_weight(gpui::FontWeight::BOLD)
                                                .text_color(theme::text_primary())
                                                .child(display_name),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(5.0))
                                                .child(
                                                    div()
                                                        .w(px(7.0))
                                                        .h(px(7.0))
                                                        .rounded_full()
                                                        .bg(dot_color),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(12.0))
                                                        .text_color(theme::text_muted())
                                                        .child(status_text),
                                                ),
                                        ),
                                )
                                .child(div().flex().items_center().gap(px(10.0)).map(|this| {
                                    if let Some(acc) = account {
                                        let avatar_fallback = acc
                                            .display_name
                                            .chars()
                                            .next()
                                            .unwrap_or('?')
                                            .to_uppercase()
                                            .to_string();
                                        this.child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(10.0))
                                                .child(
                                                    div()
                                                        .w(px(36.0))
                                                        .h(px(36.0))
                                                        .rounded_full()
                                                        .border_2()
                                                        .border_color(theme::platform_color(
                                                            models_platform,
                                                        ))
                                                        .flex()
                                                        .items_center()
                                                        .justify_center()
                                                        .child(
                                                            div()
                                                                .text_color(theme::platform_color(
                                                                    models_platform,
                                                                ))
                                                                .font_weight(gpui::FontWeight::BOLD)
                                                                .text_size(px(15.0))
                                                                .child(avatar_fallback),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .child(
                                                            div()
                                                                .text_size(px(13.0))
                                                                .font_weight(
                                                                    gpui::FontWeight::SEMIBOLD,
                                                                )
                                                                .text_color(theme::text_primary())
                                                                .child(acc.display_name.clone()),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(11.0))
                                                                .text_color(theme::text_muted())
                                                                .child(format!(
                                                                    "@{}",
                                                                    acc.username
                                                                )),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .rounded_md()
                                                        .px(px(14.0))
                                                        .py(px(7.0))
                                                        .border_1()
                                                        .border_color(theme::border())
                                                        .text_size(px(13.0))
                                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                                        .text_color(theme::text_muted())
                                                        .child("Disconnect"),
                                                ),
                                        )
                                    } else {
                                        this.child(
                                            div()
                                                .rounded_md()
                                                .px(px(14.0))
                                                .py(px(7.0))
                                                .bg(theme::platform_color(models_platform))
                                                .text_size(px(13.0))
                                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                                .text_color(if platform == Platform::Kick {
                                                    rgb(0x000000)
                                                } else {
                                                    rgb(0xffffff)
                                                })
                                                .child("Connect account"),
                                        )
                                    }
                                })),
                        )
                        .child(
                            div()
                                .p(px(14.0))
                                .px(px(20.0))
                                .flex()
                                .flex_col()
                                .gap(px(10.0))
                                .map(|this| {
                                    if platform == Platform::Twitch || account.is_none() {
                                        this.child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(8.0))
                                                .child(
                                                    div()
                                                        .flex_1()
                                                        .flex()
                                                        .items_center()
                                                        .bg(theme::surface_2())
                                                        .border_1()
                                                        .border_color(theme::border())
                                                        .rounded_md()
                                                        .child(
                                                            div()
                                                                .pl(px(12.0))
                                                                .pr(px(4.0))
                                                                .text_size(px(14.0))
                                                                .text_color(theme::text_muted())
                                                                .child("#"),
                                                        )
                                                        .child(
                                                            div()
                                                                .flex_1()
                                                                .py(px(8.0))
                                                                .pr(px(12.0))
                                                                .text_size(px(14.0))
                                                                .text_color(theme::text_muted())
                                                                .child(
                                                                    if platform == Platform::Youtube
                                                                    {
                                                                        "Channel ID or handle"
                                                                    } else {
                                                                        "channel name"
                                                                    },
                                                                ),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .rounded_md()
                                                        .px(px(18.0))
                                                        .py(px(8.0))
                                                        .border_1()
                                                        .border_color(gpui::rgba(0xa78bfa4d))
                                                        .bg(gpui::rgba(0xa78bfa26))
                                                        .text_color(rgb(0xa78bfa))
                                                        .text_size(px(13.0))
                                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                                        .child("Join"),
                                                ),
                                        )
                                    } else {
                                        this.child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(12.0))
                                                .py(px(8.0))
                                                .child(
                                                    div()
                                                        .text_size(px(13.0))
                                                        .text_color(theme::text_muted())
                                                        .child("Connected to your channel"),
                                                ),
                                        )
                                    }
                                }),
                        )
                        .map(|this| {
                            if let Some(acc) = account {
                                if platform == Platform::Twitch || platform == Platform::Kick {
                                    this.child(
                                        div()
                                            .border_t_1()
                                            .border_color(theme::border())
                                            .p(px(18.0))
                                            .px(px(20.0))
                                            .flex()
                                            .flex_col()
                                            .gap(px(12.0))
                                            .child(
                                                div()
                                                    .text_size(px(14.0))
                                                    .font_weight(gpui::FontWeight::BOLD)
                                                    .text_color(theme::text_primary())
                                                    .child("Stream Editor"),
                                            )
                                            .child(
                                                div()
                                                    .w_full()
                                                    .bg(theme::surface_2())
                                                    .border_1()
                                                    .border_color(theme::border())
                                                    .rounded_md()
                                                    .p(px(12.0))
                                                    .text_size(px(13.0))
                                                    .text_color(theme::text_muted())
                                                    .child(format!(
                                                        "Managing stream for {}",
                                                        acc.platform_user_id
                                                    )),
                                            ),
                                    )
                                } else {
                                    this
                                }
                            } else {
                                this
                            }
                        })
                })),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platforms_page_parity_tests() {
        let mut panel = PlatformsPanel::new();

        assert!(panel.account(Platform::Twitch).is_none());
        assert!(panel.status(Platform::Twitch).is_none());

        panel.accounts.push(Account {
            id: "1".into(),
            platform: Platform::Twitch,
            platform_user_id: "123".into(),
            username: "testuser".into(),
            display_name: "TestUser".into(),
            avatar_url: None,
            scopes: vec![],
            created_at: 0,
            updated_at: 0,
        });

        assert!(panel.account(Platform::Twitch).is_some());

        panel.join_channel(Platform::Twitch, "testuser".into());
        assert_eq!(
            panel.joined_channels.get(&Platform::Twitch).unwrap().len(),
            1
        );

        panel.leave_channel(Platform::Twitch, "testuser");
        assert_eq!(
            panel.joined_channels.get(&Platform::Twitch).unwrap().len(),
            0
        );

        panel.add_toast(Platform::Twitch, ToastKind::Success, "Connected".into());
        assert_eq!(panel.toasts.len(), 1);
        assert_eq!(panel.toasts[0].kind, ToastKind::Success);
    }

    #[test]
    fn stream_editor_contract_tests() {
        let mut editor = StreamEditor::new(Platform::Twitch, "123".into());

        assert!(!editor.is_live);
        assert!(!editor.editing);

        editor.apply_status(StreamStatusResponse {
            is_live: true,
            title: "Test Stream".into(),
            category_id: Some("456".into()),
            category_name: Some("Just Chatting".into()),
            viewer_count: Some(100),
        });

        assert!(editor.is_live);
        assert_eq!(editor.title, "Test Stream");
        assert_eq!(editor.category_name.as_deref(), Some("Just Chatting"));

        editor.start_edit();
        assert!(editor.editing);
        assert_eq!(editor.edit_title, "Test Stream");
        assert_eq!(editor.category_query, "Just Chatting");

        editor.select_category(CategorySearchResult {
            id: "789".into(),
            name: "Gaming".into(),
            thumbnail_url: None,
        });

        assert_eq!(editor.edit_category_id.as_deref(), Some("789"));
        assert_eq!(editor.edit_category_name.as_deref(), Some("Gaming"));
        assert_eq!(editor.category_query, "Gaming");

        editor.edit_title = "New Title".into();
        editor.complete_save();

        assert_eq!(editor.title, "New Title");
        assert_eq!(editor.category_name.as_deref(), Some("Gaming"));
        assert!(editor.save_success);
        assert!(!editor.editing);

        editor.cancel_edit();
        assert!(!editor.editing);
    }

    #[test]
    fn panel_renders_without_panic() {
        let panel_state = PlatformsPanel::new();
        let _view = super::panel(&panel_state);
    }
}
