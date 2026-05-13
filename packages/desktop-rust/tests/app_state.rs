mod support;

use serde_json::to_value;
use support::new_state;
use twirchat_desktop_rust::app_state::MainSection;
use twirchat_desktop_rust::protocol::{
    BackendToDesktopMessage, ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform,
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
        .last()
        .expect("live message should be appended");
    assert_eq!(latest.id, "msg-1");
    assert!(latest.emotes.iter().any(|emote| emote.id == "7tv-kekw"));
}

fn chat_message(id: &str, channel_id: &str, text: &str) -> NormalizedChatMessage {
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
            badges: vec![],
        },
        text: text.to_string(),
        emotes: vec![],
        timestamp: "1700000000".to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}
