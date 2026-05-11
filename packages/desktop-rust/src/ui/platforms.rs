#![allow(dead_code)]

use crate::app_state::mock_data::PrototypeData;
use crate::protocol::messages::{CategorySearchResult, StreamStatusResponse};
use crate::protocol::types::{Account, Platform, PlatformStatusInfo};
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

pub(crate) fn panel(data: &PrototypeData) -> Div {
    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(panel_title(
            "Platforms",
            "Connect your streaming accounts and join channels",
        ))
        .children(data.platform_cards.iter().map(|card| {
            div()
                .rounded_lg()
                .bg(theme::surface())
                .border_1()
                .border_color(theme::border())
                .p(px(18.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(10.0))
                        .child(
                            div()
                                .w(px(40.0))
                                .h(px(40.0))
                                .rounded_md()
                                .bg(theme::platform_color(card.platform))
                                .text_color(theme::background())
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(card.platform.glyph()),
                        )
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .text_color(theme::text_primary())
                                        .child(card.display_name.clone()),
                                )
                                .child(
                                    div()
                                        .text_color(theme::text_muted())
                                        .child(card.username.clone()),
                                ),
                        )
                        .child(
                            div()
                                .rounded_md()
                                .px(px(8.0))
                                .py(px(4.0))
                                .bg(rgb(0x163522))
                                .text_color(theme::green())
                                .child(card.status.clone()),
                        ),
                )
                .child(
                    div()
                        .text_color(theme::text_muted())
                        .child(format!("Joined: {}", card.joined_channel)),
                )
                .child(
                    div()
                        .rounded_md()
                        .px(px(10.0))
                        .py(px(8.0))
                        .bg(rgb(0x22193c))
                        .text_color(theme::accent())
                        .child(card.action_label.clone()),
                )
        }))
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
}
