use crate::mock;
use crate::models::{
    Account, ChannelTab, ChatMessage, PlatformCard, SettingRow, StreamChip, UiEvent,
};
use crate::state::{AppState, MainSection};
use crate::theme;
use gpui::{App, ClickEvent, Context, Div, Render, Window, div, prelude::*, px, rgb, uniform_list};
use std::ops::Range;

pub struct TwirChatApp {
    state: AppState,
    accounts: Vec<Account>,
    tabs: Vec<ChannelTab>,
    chips: Vec<StreamChip>,
    messages: Vec<ChatMessage>,
    events: Vec<UiEvent>,
    platform_cards: Vec<PlatformCard>,
    settings: Vec<SettingRow>,
}

impl TwirChatApp {
    pub fn new() -> Self {
        Self {
            state: AppState::new(),
            accounts: mock::accounts(),
            tabs: mock::channel_tabs(),
            chips: mock::header_chips(),
            messages: mock::chat_messages(),
            events: mock::events(),
            platform_cards: mock::platform_cards(),
            settings: mock::settings(),
        }
    }

    fn set_section(&mut self, section: MainSection) {
        self.state.select_section(section)
    }

    fn toggle_sidebar(&mut self) {
        self.state.toggle_sidebar()
    }

    fn set_tab(&mut self, tab_id: String) {
        self.state.select_channel_tab(tab_id)
    }

    fn nav_button(
        &self,
        cx: &mut Context<Self>,
        section: MainSection,
        icon: &'static str,
        label: &'static str,
        badge: Option<String>,
    ) -> impl IntoElement {
        let entity = cx.entity().clone();
        let active = self.state.active_section == section;

        let mut item = div()
            .id(format!("nav-{label}"))
            .w_full()
            .rounded_lg()
            .px(px(4.0))
            .py(px(8.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(4.0))
            .cursor_pointer()
            .text_color(if active {
                theme::accent()
            } else {
                rgb(0x6f6f7d)
            })
            .bg(if active {
                rgb(0x1f1735)
            } else {
                theme::nav_background()
            })
            .on_click(
                move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                    entity.update(app, |this, _cx| this.set_section(section));
                },
            )
            .child(div().text_size(px(17.0)).child(icon));

        if !self.state.sidebar_collapsed {
            item = item.child(div().text_size(px(9.0)).child(label));
        }

        if let Some(badge) = badge {
            item = item.child(
                div()
                    .mt(px(2.0))
                    .min_w(px(16.0))
                    .rounded_md()
                    .px(px(4.0))
                    .py(px(1.0))
                    .bg(if matches!(section, MainSection::Platforms) {
                        rgb(0x163522)
                    } else {
                        rgb(0x451825)
                    })
                    .text_color(if matches!(section, MainSection::Platforms) {
                        theme::green()
                    } else {
                        theme::red()
                    })
                    .text_size(px(9.0))
                    .child(badge),
            );
        }

        item
    }

    fn render_nav_rail(&self, cx: &mut Context<Self>) -> Div {
        let entity = cx.entity().clone();
        let width = if self.state.sidebar_collapsed {
            44.0
        } else {
            68.0
        };

        div()
            .w(px(width))
            .h_full()
            .bg(theme::nav_background())
            .border_r_1()
            .border_color(rgb(0x21212a))
            .pt(px(12.0))
            .pb(px(16.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(4.0))
            .child(
                div()
                    .text_color(theme::accent())
                    .text_size(px(20.0))
                    .mb(px(12.0))
                    .child("🖥"),
            )
            .child(
                div()
                    .w_full()
                    .px(px(7.0))
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(self.nav_button(cx, MainSection::Chat, "💬", "Chat", None))
                    .child(self.nav_button(cx, MainSection::Events, "🔔", "Events", None))
                    .child(self.nav_button(
                        cx,
                        MainSection::Platforms,
                        "🌐",
                        "Platforms",
                        Some(String::from("2")),
                    ))
                    .child(self.nav_button(cx, MainSection::Settings, "⚙", "Settings", None)),
            )
            .child(div().flex_1())
            .child(
                div()
                    .id("sidebar-toggle")
                    .w(px(32.0))
                    .h(px(32.0))
                    .rounded_md()
                    .cursor_pointer()
                    .text_color(rgb(0x777786))
                    .flex()
                    .items_center()
                    .justify_center()
                    .on_click(
                        move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                            entity.update(app, |this, _cx| this.toggle_sidebar());
                        },
                    )
                    .child(if self.state.sidebar_collapsed {
                        "›"
                    } else {
                        "‹"
                    }),
            )
    }

    fn render_tab_bar(&self, cx: &mut Context<Self>) -> Div {
        let entity = cx.entity().clone();
        let active_id = self.state.active_channel_tab_id.clone();

        div()
            .w_full()
            .bg(theme::nav_background())
            .border_b_1()
            .border_color(theme::border())
            .px(px(8.0))
            .pt(px(4.0))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(2.0))
            .children(self.tabs.iter().cloned().map(move |tab| {
                let entity = entity.clone();
                let is_active = tab.id == active_id;
                let tab_id = tab.id.clone();
                let accent = tab
                    .platform
                    .map(theme::platform_color)
                    .unwrap_or(theme::accent());

                div()
                    .id(format!("tab-{tab_id}"))
                    .cursor_pointer()
                    .rounded_t_lg()
                    .px(px(10.0))
                    .pt(px(4.0))
                    .pb(px(5.0))
                    .border_b_2()
                    .border_color(if is_active {
                        accent
                    } else {
                        theme::nav_background()
                    })
                    .bg(if is_active {
                        rgb(0x171721)
                    } else {
                        theme::nav_background()
                    })
                    .text_color(if is_active {
                        accent
                    } else {
                        theme::text_muted()
                    })
                    .on_click(
                        move |_event: &ClickEvent, _window: &mut Window, app: &mut App| {
                            entity.update(app, |this, _cx| this.set_tab(tab_id.clone()));
                        },
                    )
                    .child(tab.label)
            }))
            .child(
                div()
                    .px(px(8.0))
                    .pt(px(4.0))
                    .pb(px(5.0))
                    .text_color(theme::text_muted())
                    .child("+"),
            )
    }

    fn render_status_chip(&self, chip: &StreamChip, accent_bg: bool) -> Div {
        div()
            .rounded_full()
            .px(px(8.0))
            .py(px(3.0))
            .bg(if accent_bg {
                rgb(0x1c1b22)
            } else {
                theme::surface_2()
            })
            .border_1()
            .border_color(if chip.live {
                theme::platform_color(chip.platform)
            } else {
                theme::border()
            })
            .text_size(px(11.0))
            .text_color(theme::text_primary())
            .child(match chip.viewer_count {
                Some(count) => format!("● {} {}", chip.channel_name, Self::format_viewers(count)),
                None => format!("● {}", chip.channel_name),
            })
    }

    fn render_header_chip(&self, chip: &StreamChip) -> Div {
        div()
            .rounded_full()
            .px(px(8.0))
            .py(px(3.0))
            .bg(theme::surface_2())
            .border_1()
            .border_color(theme::border())
            .text_color(theme::text_primary())
            .text_size(px(11.0))
            .child(match chip.viewer_count {
                Some(count) => format!("● {} {}", chip.channel_name, Self::format_viewers(count)),
                None => format!("● {}", chip.channel_name),
            })
    }

    fn render_message_row(message: &ChatMessage) -> Div {
        if message.system {
            return div()
                .w_full()
                .px(px(12.0))
                .py(px(1.0))
                .flex()
                .flex_row()
                .items_center()
                .gap(px(6.0))
                .child(div().w(px(2.0)).h(px(20.0)).bg(theme::green()))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(rgb(0x8eb79b))
                        .child(format!("{}", message.text)),
                );
        }

        div()
            .w_full()
            .px(px(12.0))
            .py(px(0.5))
            .flex()
            .flex_row()
            .items_start()
            .gap(px(6.0))
            .child(
                div()
                    .w(px(2.0))
                    .h(px(20.0))
                    .bg(theme::platform_color(message.platform)),
            )
            .child(
                div()
                    .text_size(px(9.0))
                    .text_color(theme::text_muted())
                    .child(message.timestamp.clone()),
            )
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme::platform_color(message.platform))
                    .child(message.platform.glyph()),
            )
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(rgb(message.author_color_hex))
                    .child(format!("{}:", message.author)),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(2.0))
                    .children(message.badges.iter().map(|badge| {
                        div()
                            .rounded_md()
                            .px(px(3.0))
                            .py(px(0.5))
                            .bg(rgb(0x25252f))
                            .text_color(theme::text_muted())
                            .text_size(px(8.0))
                            .child(badge.clone())
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .text_size(px(12.0))
                    .text_color(theme::text_primary())
                    .child(message.text.clone()),
            )
    }

    fn render_composer(&self) -> Div {
        div()
            .w_full()
            .bg(theme::surface())
            .border_t_1()
            .border_color(theme::border())
            .pt(px(6.0))
            .px(px(12.0))
            .pb(px(8.0))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap(px(5.0))
                    .child(self.render_status_chip(&self.chips[0], true))
                    .child(self.render_status_chip(&self.chips[1], true)),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .flex_1()
                            .h(px(38.0))
                            .rounded_lg()
                            .bg(theme::surface_2())
                            .border_1()
                            .border_color(theme::border())
                            .px(px(12.0))
                            .flex()
                            .items_center()
                            .text_size(px(12.0))
                            .text_color(rgb(0x777786))
                            .child("Send a message... (Enter↵ to send, Shift+Enter for newline)"),
                    )
                    .child(
                        div()
                            .w(px(28.0))
                            .h(px(28.0))
                            .rounded_md()
                            .text_color(theme::text_muted())
                            .flex()
                            .items_center()
                            .justify_center()
                            .child("☺"),
                    )
                    .child(
                        div()
                            .w(px(34.0))
                            .h(px(34.0))
                            .rounded_lg()
                            .bg(theme::accent_strong())
                            .text_color(theme::text_primary())
                            .flex()
                            .items_center()
                            .justify_center()
                            .child("➤"),
                    ),
            )
    }

    fn render_chat_panel(&self, cx: &mut Context<Self>) -> Div {
        div()
            .flex_1()
            .flex()
            .flex_col()
            .bg(theme::background())
            .child(
                div()
                    .w_full()
                    .h(px(42.0))
                    .border_b_1()
                    .border_color(theme::border())
                    .px(px(16.0))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .text_color(theme::text_muted())
                            .text_size(px(12.0))
                            .child("LIVE CHAT"),
                    )
                    .child(self.render_header_chip(&self.chips[0]))
                    .child(self.render_header_chip(&self.chips[1]))
                    .child(div().flex_1())
                    .child(
                        div()
                            .text_color(theme::text_muted())
                            .text_size(px(11.0))
                            .child("142 messages"),
                    )
                    .child(div().text_color(theme::text_muted()).child("⚙"))
                    .child(div().text_color(theme::text_muted()).child("+"))
                    .child(div().text_color(theme::text_muted()).child("⋮")),
            )
            .child(
                div().flex_1().bg(theme::background()).child(
                    uniform_list(
                        "chat-messages",
                        self.messages.len(),
                        cx.processor(|this: &mut Self, range: Range<usize>, _window, _cx| {
                            range
                                .map(|index| Self::render_message_row(&this.messages[index]))
                                .collect::<Vec<_>>()
                        }),
                    )
                    .h_full(),
                ),
            )
            .child(self.render_composer())
    }

    fn render_events_panel(&self) -> Div {
        div()
            .flex_1()
            .p(px(24.0))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .child(self.panel_title(
                "Events",
                "Realtime follows, gifts, raids and platform activity",
            ))
            .children(self.events.iter().map(|event| {
                div()
                    .rounded_lg()
                    .bg(theme::surface())
                    .border_1()
                    .border_color(theme::border())
                    .p(px(16.0))
                    .flex()
                    .flex_row()
                    .gap(px(12.0))
                    .child(
                        div()
                            .w(px(36.0))
                            .h(px(36.0))
                            .rounded_md()
                            .bg(rgb(event.accent_hex))
                            .text_color(theme::text_primary())
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(event.platform.glyph()),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_color(theme::text_primary())
                                    .child(event.title.clone()),
                            )
                            .child(
                                div()
                                    .text_color(theme::text_muted())
                                    .child(event.detail.clone()),
                            ),
                    )
                    .child(
                        div()
                            .text_color(theme::text_muted())
                            .child(event.timestamp.clone()),
                    )
            }))
    }

    fn render_platforms_panel(&self) -> Div {
        div()
            .flex_1()
            .p(px(24.0))
            .flex()
            .flex_col()
            .gap(px(16.0))
            .child(self.panel_title("Platforms", "Connected accounts and joined channels"))
            .child(self.render_account_summary())
            .children(self.platform_cards.iter().map(|card| {
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

    fn render_settings_panel(&self) -> Div {
        div()
            .flex_1()
            .p(px(24.0))
            .flex()
            .flex_col()
            .gap(px(16.0))
            .child(self.panel_title("Settings", "Appearance and desktop preview controls"))
            .children(self.settings.iter().map(|row| {
                div()
                    .rounded_lg()
                    .bg(theme::surface())
                    .border_1()
                    .border_color(theme::border())
                    .p(px(18.0))
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .child(
                        div()
                            .text_color(theme::text_primary())
                            .child(row.label.clone()),
                    )
                    .child(
                        div()
                            .rounded_md()
                            .bg(theme::surface_2())
                            .border_1()
                            .border_color(theme::border())
                            .px(px(10.0))
                            .py(px(8.0))
                            .text_color(theme::accent())
                            .child(row.value.clone()),
                    )
                    .child(
                        div()
                            .text_color(theme::text_muted())
                            .child(row.hint.clone()),
                    )
            }))
    }

    fn panel_title(&self, title: &'static str, subtitle: &'static str) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .child(
                div()
                    .text_color(theme::text_primary())
                    .text_size(px(20.0))
                    .child(title),
            )
            .child(
                div()
                    .text_color(theme::text_muted())
                    .text_size(px(13.0))
                    .child(subtitle),
            )
    }

    fn render_account_summary(&self) -> Div {
        div()
            .rounded_lg()
            .bg(theme::surface())
            .border_1()
            .border_color(theme::border())
            .p(px(18.0))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(
                div()
                    .text_color(theme::text_primary())
                    .child("Connected accounts"),
            )
            .children(self.accounts.iter().map(|account| {
                div()
                    .rounded_md()
                    .bg(theme::surface_2())
                    .border_1()
                    .border_color(theme::border())
                    .px(px(10.0))
                    .py(px(8.0))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .w(px(24.0))
                            .h(px(24.0))
                            .rounded_md()
                            .bg(theme::platform_color(account.platform))
                            .text_color(theme::background())
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(account.platform.glyph()),
                    )
                    .child(div().flex_1().child(format!(
                        "{} · {} ({})",
                        account.platform.label(),
                        account.display_name,
                        account.username
                    )))
                    .child(
                        div()
                            .text_color(if account.connected {
                                theme::green()
                            } else {
                                theme::text_muted()
                            })
                            .child(if account.connected {
                                "online"
                            } else {
                                "offline"
                            }),
                    )
            }))
    }

    fn render_content(&self, cx: &mut Context<Self>) -> Div {
        match self.state.active_section {
            MainSection::Chat => div()
                .flex_1()
                .flex()
                .flex_col()
                .bg(theme::background())
                .child(self.render_tab_bar(cx))
                .child(self.render_chat_panel(cx)),
            MainSection::Events => self.render_events_panel(),
            MainSection::Platforms => self.render_platforms_panel(),
            MainSection::Settings => self.render_settings_panel(),
        }
    }

    fn format_viewers(viewers: usize) -> String {
        if viewers >= 1_000_000 {
            format!("{:.1}M", viewers as f32 / 1_000_000.0)
        } else if viewers >= 1_000 {
            format!("{:.1}K", viewers as f32 / 1_000.0)
        } else {
            viewers.to_string()
        }
    }
}

impl Render for TwirChatApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        div().size_full().bg(rgb(0x070709)).p(px(8.0)).child(
            div()
                .size_full()
                .rounded_xl()
                .border_1()
                .border_color(rgb(0x2a2a33))
                .bg(theme::background())
                .text_color(theme::text_primary())
                .flex()
                .flex_row()
                .child(self.render_nav_rail(cx))
                .child(self.render_content(cx)),
        )
    }
}
