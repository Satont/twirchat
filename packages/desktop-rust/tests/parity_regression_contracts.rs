mod support;

use serde_json::{Map, Value};
use support::{new_state, read_source};
use twirchat_desktop_rust::app_state::RuntimeStatus;
use twirchat_desktop_rust::protocol::messages::BackendToDesktopMessage;
use twirchat_desktop_rust::protocol::types::{
    ChatAuthor, ChatMessageType, EventUser, NormalizedChatMessage, NormalizedEvent,
    NormalizedEventType, Platform,
};
use twirchat_desktop_rust::services::{BackendWsEvent, LifecycleEvent, ServiceEvent};

#[test]
fn chat_gear_opens_appearance_popover_state_instead_of_settings_section() {
    let chat_rs = read_source("src/ui/chat.rs");

    assert!(
        !chat_rs.contains("MainSection::Settings"),
        "chat gear still jumps to settings instead of appearance state"
    );
    assert!(
        [
            "ChatAppearancePopover",
            "AppearancePopover",
            "appearance_popup",
            "appearance popover",
        ]
        .iter()
        .any(|needle| chat_rs.contains(needle)),
        "chat gear should route through appearance popup state"
    );
}

#[test]
fn tabs_are_derived_from_watched_runtime_state_not_hardcoded_labels() {
    let tabs_rs = read_source("src/ui/shell/tabs.rs");

    assert!(
        !tabs_rs.contains("(\"home\", \"Home\", None)"),
        "home tab is still hardcoded instead of derived from state"
    );
    assert!(
        !tabs_rs.contains("(\"satont\", \"satont\", Some"),
        "watched tabs are still hardcoded instead of deriving from runtime state"
    );
    assert!(
        [
            "watched_channels",
            "watched_layouts",
            "tab_channel_names",
            "watched_live_status"
        ]
        .iter()
        .any(|needle| tabs_rs.contains(needle)),
        "tabs should be built from watched/runtime state, not local labels"
    );
}

#[test]
fn settings_state_is_mutable_and_observable_from_app_state() {
    let settings_rs = read_source("src/settings/mod.rs");
    for setter in [
        "set_theme",
        "set_font_family",
        "set_self_ping",
        "set_auto_check_updates",
        "update_overlay_config",
    ] {
        assert!(
            settings_rs.contains(setter),
            "settings manager should expose {setter}"
        );
    }

    let app_state_rs = read_source("src/app_state/mod.rs");
    assert!(
        [
            "pub settings: AppSettings",
            "pub settings: SettingsManager",
            "fn settings(&self)",
            "pub fn settings(&self)",
            "settings_state",
        ]
        .iter()
        .any(|needle| app_state_rs.contains(needle)),
        "AppState should expose observable settings state"
    );
}

#[test]
fn watched_runtime_messages_are_consumed_by_app_state_visible_structures() {
    let app_state_rs = read_source("src/app_state/mod.rs");

    assert!(
        app_state_rs.contains("ServiceEvent::WatchedChannels"),
        "AppState should consume watched runtime events"
    );
    assert!(
        [
            "WatchedChannelsEvent::MessageBuffered",
            "WatchedChannelsEvent::StatusChanged",
            "WatchedChannelsEvent::BackendMessagePlanned",
        ]
        .iter()
        .any(|needle| app_state_rs.contains(needle)),
        "watched runtime messages should land in visible AppState structures"
    );
}

#[test]
fn backend_runtime_messages_reach_visible_app_state_structures() {
    let mut state = new_state();
    let initial_messages = state.messages.len();
    let initial_events = state.events.len();
    let initial_unread = state.unread_events();
    let initial_service_events_seen = state.service_events_seen();

    state.apply_service_event(ServiceEvent::Lifecycle(LifecycleEvent::RuntimeStarted));
    state.apply_service_event(ServiceEvent::BackendWs(BackendWsEvent::MessageDecoded {
        message: BackendToDesktopMessage::ChatMessage {
            data: json_to_value(sample_chat_message()),
        },
    }));
    state.apply_service_event(ServiceEvent::BackendWs(BackendWsEvent::MessageDecoded {
        message: BackendToDesktopMessage::ChatEvent {
            data: json_to_value(sample_event()),
        },
    }));

    assert_eq!(state.runtime_status(), RuntimeStatus::Running);
    assert_eq!(state.service_events_seen(), initial_service_events_seen + 3);
    assert_eq!(state.messages.len(), initial_messages + 1);
    assert!(state.messages.iter().any(|message| message.id == "msg-1"));
    assert_eq!(state.events.len(), initial_events + 1);
    assert!(state.events.iter().any(|event| event.id == "evt-1"));
    assert_eq!(state.unread_events(), initial_unread + 1);
}

#[test]
fn chat_visual_contract_distinguishes_modern_and_compact_density_flags() {
    let chat_rs = read_source("src/ui/chat.rs");

    for needle in [
        "ChatTheme::Modern",
        "ChatTheme::Compact",
        "show_platform_color_stripe",
        "show_platform_icon",
        "show_timestamp",
        "show_avatars",
        "show_badges",
    ] {
        assert!(
            chat_rs.contains(needle),
            "chat visuals should key off {needle}"
        );
    }
}

fn json_to_value<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("test fixture should serialize")
}

fn sample_chat_message() -> NormalizedChatMessage {
    NormalizedChatMessage {
        id: String::from("msg-1"),
        platform: Platform::Twitch,
        channel_id: String::from("channel-1"),
        author: ChatAuthor {
            id: String::from("author-1"),
            username: Some(String::from("author1")),
            display_name: String::from("Author One"),
            color: Some(String::from("#a78bfa")),
            avatar_url: None,
            badges: vec![],
        },
        text: String::from("hello world"),
        emotes: vec![],
        timestamp: String::from("2026-05-11T00:00:00Z"),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn sample_event() -> NormalizedEvent {
    NormalizedEvent {
        id: String::from("evt-1"),
        platform: Platform::Twitch,
        event_type: NormalizedEventType::Follow,
        user: EventUser {
            id: String::from("user-1"),
            display_name: String::from("Viewer One"),
            avatar_url: None,
        },
        data: Map::new(),
        timestamp: String::from("2026-05-11T00:00:00Z"),
    }
}
