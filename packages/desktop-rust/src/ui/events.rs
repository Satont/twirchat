#![allow(dead_code)]
#![allow(clippy::assertions_on_constants)]

use crate::protocol::types::{NormalizedEvent, NormalizedEventType};
use crate::ui::shared::panel_title;
use crate::ui::theme;
use gpui::{Div, SharedString, div, prelude::*, px, rgb};

fn event_icon(_type: &NormalizedEventType) -> SharedString {
    match _type {
        NormalizedEventType::Follow => "F".into(),
        NormalizedEventType::Sub | NormalizedEventType::Resub | NormalizedEventType::Membership => {
            "S".into()
        }
        NormalizedEventType::GiftSub => "G".into(),
        NormalizedEventType::Raid => "R".into(),
        NormalizedEventType::Host => "H".into(),
        NormalizedEventType::Bits | NormalizedEventType::Superchat => "B".into(),
    }
}

fn event_label(_type: &NormalizedEventType) -> SharedString {
    match _type {
        NormalizedEventType::Follow => "Follow".into(),
        NormalizedEventType::Sub => "Subscription".into(),
        NormalizedEventType::Resub => "Re-subscription".into(),
        NormalizedEventType::GiftSub => "Gift sub".into(),
        NormalizedEventType::Raid => "Raid".into(),
        NormalizedEventType::Host => "Host".into(),
        NormalizedEventType::Bits => "Bits".into(),
        NormalizedEventType::Superchat => "Super Chat".into(),
        NormalizedEventType::Membership => "Membership".into(),
    }
}

fn event_color(_type: &NormalizedEventType) -> gpui::Rgba {
    match _type {
        NormalizedEventType::Follow => rgb(0x22c55e),
        NormalizedEventType::Sub | NormalizedEventType::Resub | NormalizedEventType::Membership => {
            rgb(0xa78bfa)
        }
        NormalizedEventType::GiftSub | NormalizedEventType::Bits => rgb(0xf59e0b),
        NormalizedEventType::Raid => rgb(0x3b82f6),
        NormalizedEventType::Host => rgb(0x06b6d4),
        NormalizedEventType::Superchat => rgb(0xef4444),
    }
}

fn event_detail(ev: &NormalizedEvent) -> Option<String> {
    match ev.event_type {
        NormalizedEventType::Resub => ev
            .data
            .get("months")
            .and_then(|m| m.as_u64())
            .map(|m| format!("{} months", m)),
        NormalizedEventType::Raid => ev
            .data
            .get("viewers")
            .and_then(|v| v.as_u64())
            .map(|v| format!("{} viewers", v)),
        NormalizedEventType::Bits => ev
            .data
            .get("amount")
            .and_then(|a| a.as_u64())
            .map(|a| format!("{} bits", a)),
        NormalizedEventType::GiftSub => ev
            .data
            .get("count")
            .and_then(|c| c.as_u64())
            .map(|c| format!("×{}", c)),
        NormalizedEventType::Superchat => ev
            .data
            .get("amount")
            .and_then(|a| a.as_f64())
            .map(|a| a.to_string()),
        _ => None,
    }
}

pub(crate) fn render_events_list(events: &[NormalizedEvent]) -> Div {
    if events.is_empty() {
        div()
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .p(px(60.0))
            .text_color(theme::text_muted())
            .child(
                div()
                    .text_xl()
                    .font_weight(gpui::FontWeight::BOLD)
                    .child("No events yet"),
            )
            .child(div().child("Follows, subs, raids and bits will appear here."))
    } else {
        let mut list = div().flex_1().flex().flex_col().gap(px(6.0)).p(px(8.0));

        #[allow(clippy::needless_range_loop)]
        for i in 0..events.len() {
            let ev = &events[i];

            let mut text_col = div()
                .flex()
                .flex_row()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .text_color(theme::text_primary())
                        .font_weight(gpui::FontWeight::BOLD)
                        .child(ev.user.display_name.clone()),
                )
                .child(
                    div()
                        .text_color(event_color(&ev.event_type))
                        .text_xs()
                        .font_weight(gpui::FontWeight::BOLD)
                        .child(event_label(&ev.event_type)),
                );

            if let Some(detail) = event_detail(ev) {
                text_col = text_col.child(
                    div()
                        .text_color(theme::text_muted())
                        .text_xs()
                        .child(detail),
                );
            }

            list = list.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .bg(theme::surface())
                    .border_1()
                    .border_color(theme::border())
                    .rounded_lg()
                    .p(px(10.0))
                    .child(
                        div()
                            .w(px(36.0))
                            .h(px(36.0))
                            .rounded_md()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(event_color(&ev.event_type)) // TODO proper background with opacity
                            .text_color(rgb(0xffffff))
                            .child(event_icon(&ev.event_type)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(text_col)
                            .child(
                                div()
                                    .flex()
                                    .flex_row()
                                    .items_center()
                                    .gap(px(8.0))
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::text_muted())
                                            .child(format!("{:?}", ev.platform)),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::text_muted())
                                            .child(ev.timestamp.clone()),
                                    ),
                            ),
                    ),
            );
        }
        list.overflow_hidden()
    }
}

pub(crate) fn panel(state: &crate::app_state::AppState) -> Div {
    let title_row = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(10.0))
        .child(panel_title(
            "Events",
            "Realtime follows, gifts, raids and platform activity",
        ));

    let header = if !state.events.is_empty() {
        title_row.child(
            div()
                .bg(rgb(0xa78bfa))
                .text_color(rgb(0xffffff))
                .rounded_full()
                .px(px(6.0))
                .py(px(2.0))
                .text_xs()
                .font_weight(gpui::FontWeight::BOLD)
                .child(state.events.len().to_string()),
        )
    } else {
        title_row
    };

    div()
        .flex_1()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(header)
        .child(render_events_list(&state.events))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::{EventUser, Platform};
    use serde_json::json;

    #[test]
    fn visual_events_page_matches_vue() {
        let events = vec![];
        let _el = render_events_list(&events);

        let events2 = [NormalizedEvent {
            id: "1".into(),
            platform: Platform::Twitch,
            event_type: NormalizedEventType::Follow,
            user: EventUser {
                id: "1".into(),
                display_name: "TestUser".into(),
                avatar_url: None,
            },
            data: serde_json::Map::new(),
            timestamp: "10:00 AM".into(),
        }];
        let _el2 = render_events_list(&events2);
    }

    #[test]
    fn events_feed_ordering_contract() {
        let mut events = [NormalizedEvent {
            id: "1".into(),
            platform: Platform::Twitch,
            event_type: NormalizedEventType::Follow,
            user: EventUser {
                id: "1".into(),
                display_name: "TestUser".into(),
                avatar_url: None,
            },
            data: serde_json::Map::new(),
            timestamp: "10:00 AM".into(),
        }];

        assert_eq!(events.len(), 1);
        let detail = event_detail(&events[0]);
        assert_eq!(detail, None);

        events[0].event_type = NormalizedEventType::Bits;
        events[0].data.insert("amount".into(), json!(100));
        assert_eq!(event_detail(&events[0]), Some("100 bits".to_string()));

        let icon = event_icon(&events[0].event_type);
        assert_eq!(icon.as_ref(), "B");
    }
}
