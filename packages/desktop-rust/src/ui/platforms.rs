use crate::app_state::mock_data::PrototypeData;
use crate::theme;
use crate::ui::shared::panel_title;
use gpui::{Div, div, prelude::*, px, rgb};

pub(crate) fn panel(data: &PrototypeData) -> Div {
    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(panel_title(
            "Platforms",
            "Connected accounts and joined channels",
        ))
        .child(account_summary(data))
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

fn account_summary(data: &PrototypeData) -> Div {
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
        .children(data.accounts.iter().map(|account| {
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
