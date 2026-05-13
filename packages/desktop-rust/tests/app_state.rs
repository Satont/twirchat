mod support;

use serde_json::to_value;
use support::new_state;
use twirchat_desktop_rust::app_state::MainSection;
use twirchat_desktop_rust::protocol::{
    BackendToDesktopMessage, Badge, ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform,
    SevenTvEmote,
};

#[test]
fn changing_active_section_updates_state() {
    let mut state = new_state();
    state.select_section(MainSection::Platforms);

    assert_eq!(state.active_section(), MainSection::Platforms);
}

#[test]
fn app_state_section_change_notifies_ui() {
    let mut state = new_state();
    state.select_section(MainSection::Settings);

    assert_eq!(state.active_section(), MainSection::Settings);
}

#[test]
fn backend_live_message_gets_enriched_by_seven_tv_catalog() {
    let mut state = new_state();
    state.messages.clear();

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::BackendWs(
        twirchat_desktop_rust::services::BackendWsEvent::MessageDecoded {
            message: BackendToDesktopMessage::SeventvEmoteSet {
                platform: Platform::Twitch,
                channel_id: "fixturestreamer".to_string(),
                emotes: vec![SevenTvEmote {
                    id: "7tv-kekw".to_string(),
                    alias: "KEKW".to_string(),
                    name: "KEKW".to_string(),
                    animated: false,
                    zero_width: false,
                    aspect_ratio: 1.0,
                    image_url: "https://cdn.7tv.app/emote/7tv-kekw/4x.webp".to_string(),
                }],
            },
        },
    ));

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::BackendWs(
        twirchat_desktop_rust::services::BackendWsEvent::MessageDecoded {
            message: BackendToDesktopMessage::ChatMessage {
                data: to_value(chat_message("msg-1", "fixturestreamer", "hello KEKW"))
                    .expect("chat message should serialize"),
            },
        },
    ));

    let latest = state
        .messages
        .iter()
        .find(|message| message.id == "msg-1")
        .expect("live message should be appended");
    assert_eq!(latest.id, "msg-1");
    assert!(latest.emotes.iter().any(|emote| emote.id == "7tv-kekw"));
}

#[test]
fn duplicate_live_message_merges_richer_emotes() {
    let mut state = new_state();
    state.messages.clear();

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::BackendWs(
        twirchat_desktop_rust::services::BackendWsEvent::MessageDecoded {
            message: BackendToDesktopMessage::ChatMessage {
                data: to_value(chat_message("msg-merge", "fixturestreamer", "hello KEKW"))
                    .expect("chat message should serialize"),
            },
        },
    ));

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::BackendWs(
        twirchat_desktop_rust::services::BackendWsEvent::MessageDecoded {
            message: BackendToDesktopMessage::SeventvEmoteSet {
                platform: Platform::Twitch,
                channel_id: "fixturestreamer".to_string(),
                emotes: vec![SevenTvEmote {
                    id: "7tv-kekw".to_string(),
                    alias: "KEKW".to_string(),
                    name: "KEKW".to_string(),
                    animated: false,
                    zero_width: false,
                    aspect_ratio: 1.0,
                    image_url: "https://cdn.7tv.app/emote/7tv-kekw/4x.webp".to_string(),
                }],
            },
        },
    ));

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
        twirchat_desktop_rust::services::WatchedChannelsEvent::MessageBuffered {
            channel_id: "watched-1".to_string(),
            message: Box::new(chat_message_with_badges(
                "msg-merge",
                "fixturestreamer",
                "hello KEKW",
                vec![badge("vip/1", None)],
                true,
            )),
        },
    ));

    let duplicates = state
        .messages
        .iter()
        .filter(|message| message.id == "msg-merge")
        .count();
    assert_eq!(duplicates, 1);
    let merged = state.messages.first().expect("merged message should exist");
    assert!(merged.emotes.iter().any(|emote| emote.id == "7tv-kekw"));
}

#[test]
fn live_badge_image_backfills_older_messages() {
    let mut state = new_state();
    state.messages.clear();

    state.messages.push(chat_message_with_badges(
        "msg-old",
        "fixturestreamer",
        "old",
        vec![badge("vip/1", None)],
        false,
    ));

    state.apply_service_event(twirchat_desktop_rust::services::ServiceEvent::BackendWs(
        twirchat_desktop_rust::services::BackendWsEvent::MessageDecoded {
            message: BackendToDesktopMessage::ChatMessage {
                data: to_value(chat_message_with_badges(
                    "msg-new",
                    "fixturestreamer",
                    "new",
                    vec![badge("vip/1", Some("https://example.test/vip.png"))],
                    false,
                ))
                .expect("chat message should serialize"),
            },
        },
    ));

    let old = state
        .messages
        .iter()
        .find(|message| message.id == "msg-old")
        .expect("old message should remain");
    assert_eq!(
        old.author.badges.first().and_then(|badge| badge.image_url.as_deref()),
        Some("https://example.test/vip.png")
    );
}

fn chat_message(id: &str, channel_id: &str, text: &str) -> NormalizedChatMessage {
    chat_message_with_badges(id, channel_id, text, vec![], false)
}

fn chat_message_with_badges(
    id: &str,
    channel_id: &str,
    text: &str,
    badges: Vec<Badge>,
    include_emote: bool,
) -> NormalizedChatMessage {
    NormalizedChatMessage {
        id: id.to_string(),
        platform: Platform::Twitch,
        channel_id: channel_id.to_string(),
        author: ChatAuthor {
            id: "viewer-1".to_string(),
            username: Some("viewerone".to_string()),
            display_name: "Viewer One".to_string(),
            color: None,
            avatar_url: None,
            badges,
        },
        text: text.to_string(),
        emotes: if include_emote {
            vec![twirchat_desktop_rust::protocol::Emote {
                id: "7tv-kekw".to_string(),
                name: "KEKW".to_string(),
                image_url: "https://cdn.7tv.app/emote/7tv-kekw/4x.webp".to_string(),
                positions: vec![twirchat_desktop_rust::protocol::EmotePosition {
                    start: 6,
                    end: 9,
                }],
                aspect_ratio: Some(1.0),
            }]
        } else {
            vec![]
        },
        timestamp: "1700000000".to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn badge(id: &str, image_url: Option<&str>) -> Badge {
    Badge {
        id: id.to_string(),
        badge_type: "vip".to_string(),
        text: "VIP".to_string(),
        image_url: image_url.map(str::to_string),
    }
}
