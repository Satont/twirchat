use crate::models::Platform;
use crate::ui::components::input::Input;
use crate::ui::components::platform_icon::PlatformIcon;
use crate::ui::theme;
use gpui::prelude::*;
use gpui::*;
use std::rc::Rc;

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct UserCardMetadata {
    pub account_age: SharedString,
    pub follow_age: SharedString,
    pub subscription_duration: SharedString,
    pub sub_age: SharedString,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum MetadataState {
    Unsupported,
    Loading,
    Error(SharedString),
    Loaded(UserCardMetadata),
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct HistoryMessage {
    pub content: SharedString,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum HistoryState {
    LoadingInitial,
    Error(SharedString),
    Empty,
    Loaded {
        messages: Vec<HistoryMessage>,
        loading_older: bool,
        has_more: bool,
    },
}

type WindowAppCallback = Rc<dyn Fn(&mut Window, &mut App) + 'static>;
type AliasSaveCallback = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct UserCard {
    pub platform: Platform,
    pub platform_user_id: SharedString,
    pub display_name: SharedString,
    pub username: Option<SharedString>,
    pub avatar_url: Option<SharedString>,
    pub current_alias: Option<SharedString>,
    pub alias_input: Option<Entity<Input>>,

    pub metadata_state: MetadataState,
    pub history_state: HistoryState,

    pub on_refresh_metadata: Option<WindowAppCallback>,
    pub on_refresh_history: Option<WindowAppCallback>,
    pub on_load_older: Option<WindowAppCallback>,
    pub on_save_alias: Option<AliasSaveCallback>,
    pub on_remove_alias: Option<WindowAppCallback>,
}

impl UserCard {
    pub fn new(
        platform: Platform,
        platform_user_id: impl Into<SharedString>,
        display_name: impl Into<SharedString>,
    ) -> Self {
        Self {
            platform,
            platform_user_id: platform_user_id.into(),
            display_name: display_name.into(),
            username: None,
            avatar_url: None,
            current_alias: None,
            alias_input: None,
            metadata_state: MetadataState::Unsupported,
            history_state: HistoryState::Empty,
            on_refresh_metadata: None,
            on_refresh_history: None,
            on_load_older: None,
            on_save_alias: None,
            on_remove_alias: None,
        }
    }

    pub fn username(mut self, username: impl Into<SharedString>) -> Self {
        self.username = Some(username.into());
        self
    }

    pub fn avatar_url(mut self, url: impl Into<SharedString>) -> Self {
        self.avatar_url = Some(url.into());
        self
    }

    pub fn current_alias(mut self, alias: impl Into<SharedString>) -> Self {
        self.current_alias = Some(alias.into());
        self
    }

    pub fn alias_input(mut self, input: Entity<Input>) -> Self {
        self.alias_input = Some(input);
        self
    }

    pub fn on_save_alias(mut self, cb: impl Fn(String, &mut Window, &mut App) + 'static) -> Self {
        self.on_save_alias = Some(Rc::new(cb));
        self
    }

    pub fn on_remove_alias(mut self, cb: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_remove_alias = Some(Rc::new(cb));
        self
    }

    pub fn metadata_state(mut self, state: MetadataState) -> Self {
        self.metadata_state = state;
        self
    }

    pub fn history_state(mut self, state: HistoryState) -> Self {
        self.history_state = state;
        self
    }

    pub fn on_refresh_metadata(mut self, cb: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_refresh_metadata = Some(Rc::new(cb));
        self
    }

    pub fn on_refresh_history(mut self, cb: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_refresh_history = Some(Rc::new(cb));
        self
    }

    pub fn on_load_older(mut self, cb: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_load_older = Some(Rc::new(cb));
        self
    }

    fn render_header(&self) -> impl IntoElement {
        let fallback_text = self
            .display_name
            .chars()
            .take(2)
            .collect::<String>()
            .to_uppercase();

        let fallback_text_clone = fallback_text.clone();

        let avatar = if let Some(url) = &self.avatar_url {
            img(ImageSource::from(url.to_string()))
                .object_fit(ObjectFit::Cover)
                .w(px(72.0))
                .h(px(72.0))
                .rounded(px(12.0))
                .bg(rgba(0xffffff14)) // rgba(255, 255, 255, 0.08)
                .with_loading(move || {
                    div()
                        .w(px(72.0))
                        .h(px(72.0))
                        .rounded(px(12.0))
                        .bg(rgba(0xffffff14))
                        .into_any_element()
                })
                .with_fallback(move || {
                    div()
                        .w(px(72.0))
                        .h(px(72.0))
                        .rounded(px(12.0))
                        .bg(rgba(0xffffff14))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(rgba(0xffffffff))
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .child(fallback_text_clone.clone())
                        .into_any_element()
                })
                .into_any_element()
        } else {
            div()
                .w(px(72.0))
                .h(px(72.0))
                .rounded(px(12.0))
                .bg(rgba(0xffffff14))
                .flex()
                .items_center()
                .justify_center()
                .text_color(rgba(0xffffffff))
                .text_size(px(24.0))
                .font_weight(FontWeight::BOLD)
                .child(fallback_text)
                .into_any_element()
        };

        let platform_pill = div()
            .h(px(24.0))
            .px(px(10.0))
            .rounded(px(12.0))
            .bg(rgba(0x00000040))
            .text_color(rgba(0xffffffff))
            .text_size(px(12.0))
            .font_weight(FontWeight::BOLD)
            .flex()
            .items_center()
            .child(format!("{:?}", self.platform).to_uppercase());

        let mut badges = div().flex().flex_row().gap(px(8.0)).child(platform_pill);

        if let Some(alias) = &self.current_alias {
            let alias_pill = div()
                .h(px(24.0))
                .px(px(10.0))
                .rounded(px(12.0))
                .bg(rgba(0xffffff29)) // rgba(255, 255, 255, 0.16)
                .text_color(rgba(0xffffffff))
                .text_size(px(12.0))
                .font_weight(FontWeight::BOLD)
                .flex()
                .items_center()
                .child(format!("Alias: {}", alias));
            badges = badges.child(alias_pill);
        }

        let handle = self
            .username
            .clone()
            .unwrap_or_else(|| self.platform_user_id.clone());

        let mut header_bg = theme::platform_color(self.platform);
        header_bg.a = 0.15;

        div()
            .flex()
            .flex_row()
            .gap(px(16.0))
            .p(px(20.0))
            // bg needs gradient eventually, for now use fallback bg
            .bg(header_bg)
            .border_b_1()
            .border_color(rgba(0xffffff14))
            .child(div().flex_shrink_0().child(avatar))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .text_size(px(20.0)) // ~1.35em
                                    .text_color(rgba(0xe2e2e8ff))
                                    .child(self.display_name.clone()),
                            )
                            .child(PlatformIcon::new(self.platform).size(px(18.0))),
                    )
                    .child(
                        div()
                            .text_size(px(13.0)) // ~0.9em
                            .text_color(rgba(0xffffffbf)) // 0.75
                            .child(handle),
                    )
                    .child(badges),
            )
    }

    fn render_alias_editor(&self) -> impl IntoElement {
        let save_cb = self.on_save_alias.clone();
        let remove_cb = self.on_remove_alias.clone();
        let alias_input = self.alias_input.clone();
        let reset_input = self.alias_input.clone();
        let current_alias = self
            .current_alias
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default();

        div()
            .id("user-card-alias-editor")
            .mb(px(18.0))
            .p(px(14.0))
            .rounded(px(10.0))
            .border_1()
            .border_color(rgba(0xffffff14))
            .bg(rgba(0x00000029))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgba(0xe2e2e8ff))
                    .child("User alias"),
            )
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(rgba(0x8b8b99ff))
                    .child("Aliases change only local display names and mention suggestions."),
            )
            .when_some(alias_input, |editor, input| {
                editor.child(div().id("user-card-alias-input").w_full().child(input))
            })
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(8.0))
                    .child(
                        div()
                            .id("user-card-save-alias")
                            .cursor_pointer()
                            .rounded(px(6.0))
                            .bg(rgba(0x7c3aedff))
                            .text_color(rgba(0xffffffff))
                            .py(px(7.0))
                            .px(px(10.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::BOLD)
                            .child("Save alias")
                            .on_click({
                                let input = self.alias_input.clone();
                                move |_event, window, app| {
                                    let Some(input) = input.as_ref() else {
                                        return;
                                    };
                                    let alias = input.read(app).text().to_string();
                                    if let Some(cb) = &save_cb {
                                        cb(alias, window, app);
                                    }
                                }
                            }),
                    )
                    .child(
                        div()
                            .id("user-card-close-alias")
                            .cursor_pointer()
                            .rounded(px(6.0))
                            .bg(rgba(0xffffff14))
                            .text_color(rgba(0xe2e2e8ff))
                            .py(px(7.0))
                            .px(px(10.0))
                            .text_size(px(12.0))
                            .child("Reset")
                            .on_click(move |_event, _window, app| {
                                if let Some(input) = reset_input.as_ref() {
                                    input.update(app, |input, cx| {
                                        input.set_text(current_alias.clone(), cx);
                                    });
                                }
                            }),
                    )
                    .child(
                        div()
                            .id("user-card-remove-alias")
                            .cursor_pointer()
                            .rounded(px(6.0))
                            .bg(rgba(0xffffff0f))
                            .text_color(rgba(0xfca5a5ff))
                            .py(px(7.0))
                            .px(px(10.0))
                            .text_size(px(12.0))
                            .child("Remove")
                            .on_click(move |_event, window, app| {
                                if let Some(cb) = &remove_cb {
                                    cb(window, app);
                                }
                            }),
                    ),
            )
    }

    fn render_metadata(&self) -> impl IntoElement {
        let refresh_cb = self.on_refresh_metadata.clone();
        let header = div()
            .flex()
            .flex_row()
            .items_start()
            .justify_between()
            .gap(px(12.0))
            .mb(px(12.0))
            .child(
                div()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgba(0xe2e2e8ff))
                            .child("Account metadata"),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(rgba(0x8b8b99ff))
                            .child("Fetched through the backend for this platform."),
                    ),
            )
            .child(
                div()
                    .id("user-card-refresh-metadata")
                    .cursor_pointer()
                    .bg(rgba(0xffffff14))
                    .text_color(rgba(0xe2e2e8ff))
                    .rounded(px(6.0))
                    .py(px(7.0))
                    .px(px(10.0))
                    .text_size(px(12.0))
                    .child("Refresh")
                    .on_click(move |_event, window, app| {
                        if let Some(cb) = &refresh_cb {
                            cb(window, app);
                        }
                    }),
            );

        let content = match &self.metadata_state {
            MetadataState::Unsupported => div()
                .min_h(px(96.0))
                .p(px(16.0))
                .flex()
                .items_center()
                .justify_center()
                .text_center()
                .text_size(px(13.0))
                .text_color(rgba(0x8b8b99ff))
                .border_1()
                .border_color(rgba(0xffffff0f))
                .rounded(px(8.0))
                .bg(rgba(0x00000029))
                .child("Metadata is not supported for this platform yet.")
                .into_any_element(),
            MetadataState::Loading => div()
                .min_h(px(96.0))
                .p(px(16.0))
                .flex()
                .items_center()
                .justify_center()
                .text_center()
                .text_size(px(13.0))
                .text_color(rgba(0x8b8b99ff))
                .border_1()
                .border_color(rgba(0xffffff0f))
                .rounded(px(8.0))
                .bg(rgba(0x00000029))
                .child("Loading metadata…")
                .into_any_element(),
            MetadataState::Error(err) => {
                let retry_cb = self.on_refresh_metadata.clone();
                div()
                    .min_h(px(96.0))
                    .p(px(16.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(10.0))
                    .text_center()
                    .text_size(px(13.0))
                    .text_color(rgba(0xfca5a5ff))
                    .border_1()
                    .border_color(rgba(0xffffff0f))
                    .rounded(px(8.0))
                    .bg(rgba(0x00000029))
                    .child(err.clone())
                    .child(
                        div()
                            .id("user-card-retry-metadata")
                            .cursor_pointer()
                            .bg(rgba(0xffffff14))
                            .text_color(rgba(0xe2e2e8ff))
                            .rounded(px(6.0))
                            .py(px(6.0))
                            .px(px(10.0))
                            .text_size(px(12.0))
                            .child("Retry")
                            .on_click(move |_event, window, app| {
                                if let Some(cb) = &retry_cb {
                                    cb(window, app);
                                }
                            }),
                    )
                    .into_any_element()
            }
            MetadataState::Loaded(data) => {
                let items = vec![
                    ("Account age", data.account_age.clone()),
                    ("Follow age", data.follow_age.clone()),
                    ("Subscription duration", data.subscription_duration.clone()),
                    ("Sub age", data.sub_age.clone()),
                ];

                let list = div().flex().flex_row().flex_wrap().gap(px(10.0));
                let mut list_with_children = list;
                for (label, val) in items {
                    list_with_children = list_with_children.child(
                        div()
                            .min_w(px(150.0))
                            .p(px(12.0))
                            .border_1()
                            .border_color(rgba(0xffffff0f))
                            .rounded(px(8.0))
                            .bg(rgba(0x00000029))
                            .child(
                                div()
                                    .mb(px(6.0))
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgba(0x8b8b99ff))
                                    .child(label),
                            )
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .text_color(rgba(0xe2e2e8ff))
                                    .child(val),
                            ),
                    );
                }
                list_with_children.into_any_element()
            }
        };

        div().mb(px(18.0)).child(header).child(content)
    }

    fn render_history(&self) -> impl IntoElement {
        let refresh_cb = self.on_refresh_history.clone();
        let load_older_cb = self.on_load_older.clone();

        let header = div()
            .flex()
            .flex_row()
            .items_start()
            .justify_between()
            .gap(px(12.0))
            .mb(px(12.0))
            .child(
                div()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgba(0xe2e2e8ff))
                            .child("Chat logs"),
                    )
                    .child(
                        div()
                            .mt(px(4.0))
                            .text_size(px(12.0))
                            .text_color(rgba(0x8b8b99ff))
                            .child("Stored local history for this user"),
                    ),
            )
            .child(
                div()
                    .id("user-card-refresh-history")
                    .cursor_pointer()
                    .bg(rgba(0xffffff14))
                    .text_color(rgba(0xe2e2e8ff))
                    .rounded(px(6.0))
                    .py(px(7.0))
                    .px(px(10.0))
                    .text_size(px(12.0))
                    .child("Refresh")
                    .on_click(move |_event, window, app| {
                        if let Some(cb) = &refresh_cb {
                            cb(window, app);
                        }
                    }),
            );

        let content = match &self.history_state {
            HistoryState::LoadingInitial => div()
                .min_h(px(160.0))
                .p(px(16.0))
                .flex()
                .items_center()
                .justify_center()
                .text_center()
                .text_size(px(13.0))
                .text_color(rgba(0x8b8b99ff))
                .border_1()
                .border_color(rgba(0xffffff0f))
                .rounded(px(8.0))
                .bg(rgba(0x00000029))
                .child("Loading messages…")
                .into_any_element(),
            HistoryState::Error(err) => {
                let retry_cb = self.on_refresh_history.clone();
                div()
                    .min_h(px(160.0))
                    .p(px(16.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(10.0))
                    .text_center()
                    .text_size(px(13.0))
                    .text_color(rgba(0xfca5a5ff))
                    .border_1()
                    .border_color(rgba(0xffffff0f))
                    .rounded(px(8.0))
                    .bg(rgba(0x00000029))
                    .child(err.clone())
                    .child(
                        div()
                            .id("user-card-retry-history")
                            .cursor_pointer()
                            .bg(rgba(0xffffff14))
                            .text_color(rgba(0xe2e2e8ff))
                            .rounded(px(6.0))
                            .py(px(6.0))
                            .px(px(10.0))
                            .text_size(px(12.0))
                            .child("Retry")
                            .on_click(move |_event, window, app| {
                                if let Some(cb) = &retry_cb {
                                    cb(window, app);
                                }
                            }),
                    )
                    .into_any_element()
            }
            HistoryState::Empty => div()
                .min_h(px(160.0))
                .p(px(16.0))
                .flex()
                .items_center()
                .justify_center()
                .text_center()
                .text_size(px(13.0))
                .text_color(rgba(0x8b8b99ff))
                .border_1()
                .border_color(rgba(0xffffff0f))
                .rounded(px(8.0))
                .bg(rgba(0x00000029))
                .child("No stored messages for this user yet.")
                .into_any_element(),
            HistoryState::Loaded {
                messages,
                loading_older,
                has_more,
            } => {
                let mut list = div()
                    .border_1()
                    .border_color(rgba(0xffffff0f))
                    .rounded(px(8.0))
                    .bg(rgba(0x00000029))
                    .flex()
                    .flex_col()
                    .overflow_hidden();

                if *has_more || *loading_older {
                    let status_text = if *loading_older {
                        "Loading older messages…"
                    } else {
                        "Load older"
                    };

                    list = list.child(
                        div()
                            .id("user-card-load-older")
                            .min_h(px(32.0))
                            .p(px(8.0))
                            .px(px(12.0))
                            .border_b_1()
                            .border_color(rgba(0xffffff0c))
                            .text_size(px(11.0))
                            .text_color(rgba(0x8b8b99ff))
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(status_text)
                            .on_click(move |_event, window, app| {
                                if let Some(cb) = &load_older_cb {
                                    cb(window, app);
                                }
                            }),
                    );
                }

                let mut msg_list = div()
                    .id("user-card-history-scroll")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0();
                let total = messages.len();
                for (i, msg) in messages.iter().enumerate() {
                    let mut row = div()
                        .p(px(12.0))
                        .text_size(px(13.0))
                        .line_height(relative(1.4))
                        .text_color(rgba(0xe2e2e8ff));

                    if i < total - 1 {
                        row = row.border_b_1().border_color(rgba(0xffffff0a));
                    }

                    msg_list = msg_list.child(row.child(msg.content.clone()));
                }

                list.child(msg_list).into_any_element()
            }
        };

        div()
            .flex()
            .flex_col()
            .border_t_1()
            .border_color(rgba(0xffffff14))
            .pt(px(16.0))
            .child(header)
            .child(content)
    }
}

impl RenderOnce for UserCard {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div()
            .id("user-card-modal")
            .flex_1()
            .min_h_0()
            .w_full()
            .h_full()
            .bg(rgba(0x2a2a35ff)) // var(--c-bg-2, #2a2a35)
            .border_1()
            .border_color(rgba(0x3a3a45ff))
            .rounded(px(12.0))
            .overflow_hidden()
            .shadow_lg()
            .flex()
            .flex_col()
            .child(self.render_header())
            .child(
                div()
                    .id("user-card-body-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(px(20.0))
                    .flex()
                    .flex_col()
                    .child(self.render_alias_editor())
                    .child(self.render_metadata())
                    .child(self.render_history()),
            )
    }
}
