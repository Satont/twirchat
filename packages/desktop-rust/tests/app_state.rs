mod support;

use serde_json::to_value;
use support::new_state;
use twirchat_desktop_rust::app_state::{
    MainSection, OutgoingChatMessageStatus, UserCardHistoryPage, UserCardLoadState, UserCardTarget,
};
use twirchat_desktop_rust::protocol::rpc::UserChatHistoryCursor;
use twirchat_desktop_rust::protocol::{
    Account, BackendToDesktopMessage, Badge, ChannelStatus, ChatAuthor, ChatMessageType,
    LiveStatusPlatform, NormalizedChatMessage, Platform, PlatformStatus, PlatformStatusInfo,
    PlatformStatusMode, SevenTvEmote, WatchedChannel,
};
use twirchat_desktop_rust::storage::Storage;

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
fn user_card_modal_state_is_closed_by_default() {
    let state = twirchat_desktop_rust::app_state::AppState::default();

    assert!(!state.user_card.open);
    assert!(state.user_card.target.is_none());
    assert!(matches!(state.user_card.history, UserCardLoadState::Idle));
    assert!(matches!(state.user_card.metadata, UserCardLoadState::Idle));
    assert!(!state.user_card.has_more);
    assert_eq!(state.user_card.next_cursor, None);
    assert_eq!(state.user_card.generation, 0);
}

#[test]
fn home_channel_status_requests_match_vue_stream_status_scope() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.platforms_panel.accounts = vec![
        account("twitch-account", Platform::Twitch, "123", "FixtureStreamer"),
        account("kick-account", Platform::Kick, "456", "KickOne"),
        account("youtube-account", Platform::Youtube, "789", "TubeOne"),
    ];
    state.watched_channels = vec![
        watched_channel("watched-duplicate", Platform::Twitch, "fixturestreamer"),
        watched_channel("watched-kick", Platform::Kick, "OtherKick"),
        watched_channel("watched-youtube", Platform::Youtube, "TubeTwo"),
    ];

    let requests = state.home_channel_status_requests();

    assert_eq!(requests.len(), 3);
    assert!(requests.iter().any(|request| {
        request.platform == LiveStatusPlatform::Twitch
            && request.channel_login == "FixtureStreamer"
            && request.channel_id.as_deref() == Some("123")
    }));
    assert!(requests.iter().any(|request| {
        request.platform == LiveStatusPlatform::Kick
            && request.channel_login == "KickOne"
            && request.channel_id.as_deref() == Some("456")
    }));
    assert!(requests.iter().any(|request| {
        request.platform == LiveStatusPlatform::Kick
            && request.channel_login == "OtherKick"
            && request.channel_id.is_none()
    }));
    assert!(
        !requests
            .iter()
            .any(|request| request.channel_login == "TubeOne")
    );
    assert!(
        !requests
            .iter()
            .any(|request| request.channel_login == "TubeTwo")
    );
}

#[test]
fn home_channel_statuses_are_applied_case_insensitively() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();

    state.apply_home_channel_statuses(vec![ChannelStatus {
        platform: LiveStatusPlatform::Twitch,
        channel_login: "fixturestreamer".to_string(),
        is_live: true,
        title: "Test Stream".to_string(),
        category_name: Some("Just Chatting".to_string()),
        viewer_count: Some(1_234),
    }]);

    let status = state
        .home_channel_status(Platform::Twitch, "FixtureStreamer")
        .expect("status should be keyed by platform and lower-case login");
    assert!(status.is_live);
    assert_eq!(status.title, "Test Stream");
    assert_eq!(status.category_name.as_deref(), Some("Just Chatting"));
    assert_eq!(status.viewer_count, Some(1_234));
    assert!(
        state
            .home_channel_status(Platform::Youtube, "FixtureStreamer")
            .is_none()
    );
}

#[test]
fn user_card_modal_state_open_close_and_generation_guard() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    let first_target = user_card_target(
        Platform::Twitch,
        "viewer-1",
        "channel-1",
        "channel-one",
        "Viewer One",
        Some("viewerone"),
    );
    let first_generation = state.open_user_card(first_target.clone());

    assert!(state.user_card.open);
    assert_eq!(state.user_card.target, Some(first_target.clone()));
    assert_eq!(state.user_card.generation, first_generation);

    let history_request = state
        .start_user_card_history_load()
        .expect("history load should start when modal is open");
    let metadata_generation = state
        .start_user_card_metadata_load()
        .expect("metadata load should start when modal is open");

    assert_eq!(history_request.generation, first_generation);
    assert_eq!(metadata_generation, first_generation);
    assert!(matches!(
        state.user_card.history,
        UserCardLoadState::Loading { generation } if generation == first_generation
    ));
    assert!(matches!(
        state.user_card.metadata,
        UserCardLoadState::Loading { generation } if generation == first_generation
    ));

    assert!(state.apply_user_card_history_result(
        history_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "msg-1",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "1000",
            )],
            has_more: true,
            next_cursor: Some(UserChatHistoryCursor {
                created_at: 1000,
                id: "msg-1".to_string(),
            }),
        }),
    ));
    assert!(matches!(
        state.user_card.history,
        UserCardLoadState::Loaded { generation, .. } if generation == first_generation
    ));
    assert!(state.user_card.has_more);
    assert_eq!(
        state
            .user_card
            .next_cursor
            .as_ref()
            .map(|cursor| cursor.id.as_str()),
        Some("msg-1")
    );

    let second_target = user_card_target(
        Platform::Kick,
        "viewer-2",
        "channel-2",
        "channel-two",
        "Viewer Two",
        Some("viewertwo"),
    );
    let second_generation = state.open_user_card(second_target.clone());

    assert_eq!(state.user_card.target, Some(second_target));
    assert_eq!(state.user_card.generation, second_generation);
    assert!(matches!(state.user_card.history, UserCardLoadState::Idle));
    assert!(matches!(state.user_card.metadata, UserCardLoadState::Idle));
    assert!(!state.user_card.has_more);
    assert_eq!(state.user_card.next_cursor, None);
    assert!(!state.apply_user_card_history_result(
        history_request,
        Ok(UserCardHistoryPage {
            messages: vec![],
            has_more: false,
            next_cursor: None,
        }),
    ));

    let closed_generation = state.close_user_card();
    assert_eq!(state.user_card.generation, closed_generation);
    assert!(!state.user_card.open);
    assert!(state.user_card.target.is_none());
    assert!(matches!(state.user_card.history, UserCardLoadState::Idle));
    assert!(matches!(state.user_card.metadata, UserCardLoadState::Idle));
    assert!(!state.apply_user_card_metadata_result(
        second_generation,
        Ok(user_card_metadata_response(
            twirchat_desktop_rust::protocol::messages::UserCardMetadataPlatform::Kick,
            "viewer-2",
        )),
    ));
}

#[test]
fn user_card_async_older_history_merges_and_stale_results_are_ignored() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    let target = user_card_target(
        Platform::Twitch,
        "viewer-1",
        "channel-1",
        "channel-one",
        "Viewer One",
        Some("viewerone"),
    );
    let generation = state.open_user_card(target);
    let initial_request = state
        .start_user_card_history_load()
        .expect("initial history request should start");
    assert_eq!(initial_request.generation, generation);
    assert!(state.apply_user_card_history_result(
        initial_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "newer",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "2000",
            )],
            has_more: true,
            next_cursor: Some(UserChatHistoryCursor {
                created_at: 2000,
                id: "newer".to_string(),
            }),
        }),
    ));

    let older_request = state
        .start_user_card_older_history_load()
        .expect("older history request should start");
    assert_eq!(older_request.generation, generation);
    assert!(state.user_card.loading_older);
    assert!(state.apply_user_card_history_result(
        older_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "older",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "1000",
            )],
            has_more: false,
            next_cursor: None,
        }),
    ));

    let UserCardLoadState::Loaded { value, .. } = &state.user_card.history else {
        panic!("history should be loaded after older page applies");
    };
    assert_eq!(
        value
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        vec!["older", "newer"]
    );
    assert!(!state.user_card.loading_older);

    let newer_generation = state.open_user_card(user_card_target(
        Platform::Kick,
        "viewer-2",
        "channel-2",
        "channel-two",
        "Viewer Two",
        Some("viewertwo"),
    ));
    assert_ne!(generation, newer_generation);
    assert!(!state.apply_user_card_history_result(
        older_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "stale",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "3000",
            )],
            has_more: false,
            next_cursor: None,
        }),
    ));
    assert!(matches!(state.user_card.history, UserCardLoadState::Idle));
}

#[test]
fn user_card_async_same_generation_older_result_cannot_overwrite_refresh() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    let generation = state.open_user_card(user_card_target(
        Platform::Twitch,
        "viewer-1",
        "channel-1",
        "channel-one",
        "Viewer One",
        Some("viewerone"),
    ));
    let initial_request = state
        .start_user_card_history_load()
        .expect("initial load should start");
    assert!(state.apply_user_card_history_result(
        initial_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "newer-before-refresh",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "2000",
            )],
            has_more: true,
            next_cursor: Some(UserChatHistoryCursor {
                created_at: 2000,
                id: "newer-before-refresh".to_string(),
            }),
        }),
    ));

    let older_request = state
        .start_user_card_older_history_load()
        .expect("older page load should start");
    let refresh_request = state
        .start_user_card_history_load()
        .expect("same-generation refresh should start");
    assert_eq!(older_request.generation, generation);
    assert_eq!(refresh_request.generation, generation);

    assert!(state.apply_user_card_history_result(
        refresh_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "newer-after-refresh",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "3000",
            )],
            has_more: false,
            next_cursor: None,
        }),
    ));
    assert!(!state.apply_user_card_history_result(
        older_request,
        Ok(UserCardHistoryPage {
            messages: vec![user_message(
                "stale-older",
                Platform::Twitch,
                "channel-1",
                "viewer-1",
                Some("viewerone"),
                "Viewer One",
                "1000",
            )],
            has_more: false,
            next_cursor: None,
        }),
    ));

    let UserCardLoadState::Loaded { value, .. } = &state.user_card.history else {
        panic!("refreshed history should stay loaded");
    };
    assert_eq!(value.len(), 1);
    assert_eq!(value[0].id, "newer-after-refresh");
    assert!(!state.user_card.loading_older);
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

    state.apply_service_event(
        twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
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
        ),
    );

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
fn watched_send_inserts_optimistic_message_without_account_cache() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-1", Platform::Kick, "fixture-kick"));

    assert!(state.queue_watched_channel_send("watched-1", "hello optimistic"));

    let pending = state.take_pending_watched_channel_messages();
    assert_eq!(pending.len(), 1);
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("optimistic client id should be set")
        .clone();

    let watched = state
        .watched_channel_messages
        .get("watched-1")
        .expect("watched history should contain optimistic row");
    assert_eq!(watched.len(), 1);
    assert_eq!(watched[0].id, client_message_id);
    assert_eq!(watched[0].text, "hello optimistic");
    assert_eq!(
        state.outgoing_message_status(&client_message_id),
        Some(OutgoingChatMessageStatus::Pending)
    );
}

#[test]
fn watched_reply_target_attaches_to_pending_and_optimistic_send_then_clears() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-1", Platform::Kick, "fixture-kick"));
    let parent = user_message(
        "parent-1",
        Platform::Kick,
        "watched-1",
        "viewer-1",
        Some("viewerone"),
        "Parent Viewer",
        "1000",
    );
    state.set_watched_reply_target("watched-1", parent.clone());

    assert!(state.queue_watched_channel_send("watched-1", "reply body"));

    let pending = state.take_pending_watched_channel_messages();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].reply_to_message_id.as_deref(), Some("parent-1"));
    assert!(state.watched_reply_target("watched-1").is_none());
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("reply optimistic send should carry a client id");
    let optimistic = state
        .watched_channel_messages
        .get("watched-1")
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.id == *client_message_id)
        })
        .expect("optimistic reply should be inserted");
    let reply = optimistic
        .reply
        .as_ref()
        .expect("optimistic message should render a reply preview");
    assert_eq!(reply.parent_message_id, "parent-1");
    assert_eq!(reply.parent_message_text, parent.text);
    assert_eq!(reply.parent_author.display_name, "Parent Viewer");
}

#[test]
fn home_composer_watched_target_attaches_reply_id_when_channel_matches() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.platforms_panel.statuses.insert(
        Platform::Kick,
        PlatformStatusInfo {
            platform: Platform::Kick,
            status: PlatformStatus::Connected,
            error: None,
            mode: PlatformStatusMode::Authenticated,
            channel_login: Some("satont".to_string()),
        },
    );
    state
        .watched_channels
        .push(watched_channel("watched-home", Platform::Kick, "satont"));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));
    let parent = user_message(
        "home-parent-1",
        Platform::Kick,
        "watched-home",
        "viewer-1",
        Some("viewerone"),
        "Home Parent",
        "1000",
    );
    state.set_home_reply_target(parent);

    assert!(state.queue_composer_send("home reply"));

    let pending = state.take_pending_watched_channel_messages();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].channel_id, "watched-home");
    assert_eq!(
        pending[0].reply_to_message_id.as_deref(),
        Some("home-parent-1")
    );
    assert!(state.home_reply_target().is_none());
}

#[test]
fn watched_echo_replaces_optimistic_without_duplicates_in_watched_and_home() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-home", Platform::Kick, "satont"));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));

    assert!(state.queue_watched_channel_send("watched-home", "echo me"));
    let pending = state.take_pending_watched_channel_messages();
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("client id should be present")
        .clone();

    let server_message = NormalizedChatMessage {
        id: "server-msg-1".to_string(),
        platform: Platform::Kick,
        channel_id: "watched-home".to_string(),
        author: ChatAuthor {
            id: "kick-user-1".to_string(),
            username: Some("satont".to_string()),
            display_name: "Satont".to_string(),
            color: None,
            avatar_url: None,
            badges: vec![],
        },
        text: "echo me".to_string(),
        emotes: vec![],
        timestamp: "1700000010".to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    };

    state.apply_service_event(
        twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
            twirchat_desktop_rust::services::WatchedChannelsEvent::MessageBuffered {
                channel_id: "watched-home".to_string(),
                message: Box::new(server_message.clone()),
            },
        ),
    );

    let watched = state
        .watched_channel_messages
        .get("watched-home")
        .expect("watched history should exist");
    assert_eq!(
        watched
            .iter()
            .filter(|message| message.id == "server-msg-1")
            .count(),
        1
    );
    assert!(
        !watched
            .iter()
            .any(|message| message.id == client_message_id)
    );

    assert_eq!(
        state
            .messages
            .iter()
            .filter(|message| message.id == "server-msg-1")
            .count(),
        1
    );
    assert!(
        !state
            .messages
            .iter()
            .any(|message| message.id == client_message_id)
    );
    assert_eq!(state.outgoing_message_status("server-msg-1"), None);
    assert_eq!(state.outgoing_message_status(&client_message_id), None);
}

#[test]
fn watched_send_failure_marks_optimistic_message_as_error() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-1", Platform::Kick, "fixture-kick"));

    assert!(state.queue_watched_channel_send("watched-1", "fail me"));
    let pending = state.take_pending_watched_channel_messages();
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("client id should be present")
        .clone();

    state.apply_service_event(
        twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
            twirchat_desktop_rust::services::WatchedChannelsEvent::MessageSendFailed {
                channel_id: "watched-1".to_string(),
                client_message_id: client_message_id.clone(),
                error: "send failed".to_string(),
            },
        ),
    );

    assert_eq!(
        state.outgoing_message_status(&client_message_id),
        Some(OutgoingChatMessageStatus::Error)
    );
    assert!(
        state
            .watched_channel_messages
            .get("watched-1")
            .is_some_and(|messages| messages
                .iter()
                .any(|message| message.id == client_message_id))
    );
}

#[test]
fn watched_send_success_event_marks_message_sent() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-1", Platform::Kick, "fixture-kick"));

    assert!(state.queue_watched_channel_send("watched-1", "send me"));
    let pending = state.take_pending_watched_channel_messages();
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("client id should be present")
        .clone();

    state.apply_service_event(
        twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
            twirchat_desktop_rust::services::WatchedChannelsEvent::MessageSendSucceeded {
                channel_id: "watched-1".to_string(),
                client_message_id: client_message_id.clone(),
            },
        ),
    );

    assert_eq!(
        state.outgoing_message_status(&client_message_id),
        Some(OutgoingChatMessageStatus::Sent)
    );
}

#[test]
fn home_composer_owned_watched_channel_inserts_optimistic_message() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.platforms_panel.statuses.insert(
        Platform::Kick,
        PlatformStatusInfo {
            platform: Platform::Kick,
            status: PlatformStatus::Connected,
            error: None,
            mode: PlatformStatusMode::Authenticated,
            channel_login: Some("satont".to_string()),
        },
    );
    state
        .watched_channels
        .push(watched_channel("watched-home", Platform::Kick, "satont"));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));

    assert!(state.queue_composer_send("home optimistic"));

    let pending = state.take_pending_watched_channel_messages();
    assert_eq!(pending.len(), 1);
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("home optimistic send should carry a client id")
        .clone();
    assert_eq!(pending[0].channel_id, "watched-home");
    assert_eq!(pending[0].text, "home optimistic");
    assert_eq!(
        state.outgoing_message_status(&client_message_id),
        Some(OutgoingChatMessageStatus::Pending)
    );
    assert!(
        state.messages.iter().any(|message| {
            message.id == client_message_id && message.text == "home optimistic"
        })
    );
    assert!(
        state
            .watched_channel_messages
            .get("watched-home")
            .is_some_and(|messages| messages
                .iter()
                .any(|message| message.id == client_message_id))
    );
}

#[test]
fn optimistic_send_reuses_previous_own_badges() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.platforms_panel.statuses.insert(
        Platform::Kick,
        PlatformStatusInfo {
            platform: Platform::Kick,
            status: PlatformStatus::Connected,
            error: None,
            mode: PlatformStatusMode::Authenticated,
            channel_login: Some("satont".to_string()),
        },
    );
    state
        .watched_channels
        .push(watched_channel("watched-home", Platform::Kick, "satont"));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));
    state.watched_channel_messages.insert(
        "watched-home".to_string(),
        vec![NormalizedChatMessage {
            id: "previous-own".to_string(),
            platform: Platform::Kick,
            channel_id: "watched-home".to_string(),
            author: ChatAuthor {
                id: "kick-user-1".to_string(),
                username: Some("satont".to_string()),
                display_name: "Satont".to_string(),
                color: Some("#00ff00".to_string()),
                avatar_url: Some("https://example.test/avatar.png".to_string()),
                badges: vec![badge(
                    "broadcaster/1",
                    Some("https://example.test/badge.png"),
                )],
            },
            text: "previous".to_string(),
            emotes: vec![],
            timestamp: "1700000000".to_string(),
            message_type: ChatMessageType::Message,
            reply: None,
        }],
    );

    assert!(state.queue_composer_send("with badges"));
    let pending = state.take_pending_watched_channel_messages();
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("home optimistic send should carry a client id");
    let optimistic = state
        .watched_channel_messages
        .get("watched-home")
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.id == *client_message_id)
        })
        .expect("optimistic message should be inserted into watched history");

    assert_eq!(optimistic.author.badges.len(), 1);
    assert_eq!(optimistic.author.badges[0].id, "broadcaster/1");
    assert_eq!(
        optimistic.author.badges[0].image_url.as_deref(),
        Some("https://example.test/badge.png")
    );
    assert_eq!(
        optimistic.author.avatar_url.as_deref(),
        Some("https://example.test/avatar.png")
    );
    assert_eq!(optimistic.author.color.as_deref(), Some("#00ff00"));
}

#[test]
fn watched_send_uses_authenticated_account_when_channel_differs() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.watched_channels.push(watched_channel(
        "watched-other",
        Platform::Kick,
        "otherstreamer",
    ));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));
    state.watched_channel_messages.insert(
        "watched-other".to_string(),
        vec![NormalizedChatMessage {
            id: "previous-own".to_string(),
            platform: Platform::Kick,
            channel_id: "watched-other".to_string(),
            author: ChatAuthor {
                id: "kick-user-1".to_string(),
                username: Some("satont".to_string()),
                display_name: "Satont".to_string(),
                color: Some("#00ff00".to_string()),
                avatar_url: Some("https://example.test/avatar.png".to_string()),
                badges: vec![badge("subscriber/1", Some("https://example.test/sub.png"))],
            },
            text: "previous".to_string(),
            emotes: vec![],
            timestamp: "1700000000".to_string(),
            message_type: ChatMessageType::Message,
            reply: None,
        }],
    );

    assert!(state.queue_watched_channel_send("watched-other", "watched badges"));
    let pending = state.take_pending_watched_channel_messages();
    let client_message_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("watched optimistic send should carry a client id");
    let optimistic = state
        .watched_channel_messages
        .get("watched-other")
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.id == *client_message_id)
        })
        .expect("optimistic watched message should be inserted");

    assert_eq!(optimistic.author.id, "kick-user-1");
    assert_eq!(optimistic.author.username.as_deref(), Some("satont"));
    assert_eq!(optimistic.author.badges.len(), 1);
    assert_eq!(optimistic.author.badges[0].id, "subscriber/1");
    assert_eq!(
        optimistic.author.avatar_url.as_deref(),
        Some("https://example.test/avatar.png")
    );
    assert_eq!(optimistic.author.color.as_deref(), Some("#00ff00"));
}

#[test]
fn identical_optimistic_sends_reconcile_in_order_without_stale_duplicates() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state
        .watched_channels
        .push(watched_channel("watched-1", Platform::Kick, "satont"));
    state.platforms_panel.accounts.push(account(
        "kick-account",
        Platform::Kick,
        "kick-user-1",
        "satont",
    ));

    assert!(state.queue_watched_channel_send("watched-1", "same text"));
    assert!(state.queue_watched_channel_send("watched-1", "same text"));
    let pending = state.take_pending_watched_channel_messages();
    let first_client_id = pending[0]
        .client_message_id
        .as_ref()
        .expect("first optimistic send should carry a client id")
        .clone();
    let second_client_id = pending[1]
        .client_message_id
        .as_ref()
        .expect("second optimistic send should carry a client id")
        .clone();

    for client_message_id in [&first_client_id, &second_client_id] {
        state.apply_service_event(
            twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
                twirchat_desktop_rust::services::WatchedChannelsEvent::MessageSendSucceeded {
                    channel_id: "watched-1".to_string(),
                    client_message_id: client_message_id.clone(),
                },
            ),
        );
    }

    for server_id in ["server-1", "server-2"] {
        state.apply_service_event(
            twirchat_desktop_rust::services::ServiceEvent::WatchedChannels(
                twirchat_desktop_rust::services::WatchedChannelsEvent::MessageBuffered {
                    channel_id: "watched-1".to_string(),
                    message: Box::new(NormalizedChatMessage {
                        id: server_id.to_string(),
                        platform: Platform::Kick,
                        channel_id: "watched-1".to_string(),
                        author: ChatAuthor {
                            id: "kick-user-1".to_string(),
                            username: Some("satont".to_string()),
                            display_name: "Satont".to_string(),
                            color: None,
                            avatar_url: None,
                            badges: vec![],
                        },
                        text: "same text".to_string(),
                        emotes: vec![],
                        timestamp: "1700000010".to_string(),
                        message_type: ChatMessageType::Message,
                        reply: None,
                    }),
                },
            ),
        );
    }

    let watched = state
        .watched_channel_messages
        .get("watched-1")
        .expect("watched history should exist");
    assert_eq!(watched.len(), 2);
    assert!(watched.iter().any(|message| message.id == "server-1"));
    assert!(watched.iter().any(|message| message.id == "server-2"));
    assert!(!watched.iter().any(|message| message.id == first_client_id));
    assert!(!watched.iter().any(|message| message.id == second_client_id));
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
        old.author
            .badges
            .first()
            .and_then(|badge| badge.image_url.as_deref()),
        Some("https://example.test/vip.png")
    );
}

#[test]
fn startup_recent_messages_backfill_badge_images_from_stored_snapshot()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("startup-recent-badges.sqlite"))?;

    storage
        .messages()
        .save(&chat_message_with_timestamp_and_badges(
            "msg-old",
            "fixturestreamer",
            "old",
            "1700000000",
            vec![badge("vip/1", None), badge("moderator/1", None)],
        ))?;
    storage
        .messages()
        .save(&chat_message_with_timestamp_and_badges(
            "msg-source",
            "fixturestreamer",
            "source",
            "1700000001",
            vec![badge("vip/1", Some("https://example.test/vip.png"))],
        ))?;

    let state = twirchat_desktop_rust::app_state::AppState::from_storage(&storage);
    let old = state
        .messages
        .iter()
        .find(|message| message.id == "msg-old")
        .expect("stored old message should load on startup");

    assert_eq!(
        badge_image_url(old, "vip/1"),
        Some("https://example.test/vip.png"),
        "startup-loaded messages should reuse stored badge image URLs before any live message arrives"
    );
    assert_eq!(
        badge_image_url(old, "moderator/1"),
        None,
        "badges without any stored image source should keep the text fallback"
    );

    Ok(())
}

#[test]
fn startup_watched_history_backfills_badge_images_from_stored_snapshot()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("startup-watched-badges.sqlite"))?;
    let channel = storage.watched_channels().upsert(
        Platform::Twitch,
        "FixtureStreamer",
        "Fixture Streamer",
    )?;

    storage.watched_history().set(
        &channel.id,
        &[
            chat_message_with_timestamp_and_badges(
                "watched-old",
                "fixturestreamer",
                "old",
                "1700000000",
                vec![badge("moderator/1", None)],
            ),
            chat_message_with_timestamp_and_badges(
                "watched-source",
                "fixturestreamer",
                "source",
                "1700000001",
                vec![badge(
                    "moderator/1",
                    Some("https://example.test/moderator.png"),
                )],
            ),
        ],
    )?;

    let state = twirchat_desktop_rust::app_state::AppState::from_storage(&storage);
    let watched = state
        .watched_channel_messages
        .get(&channel.id)
        .expect("stored watched history should load on startup");
    let old = watched
        .iter()
        .find(|message| message.id == "watched-old")
        .expect("stored watched message should remain");

    assert_eq!(
        badge_image_url(old, "moderator/1"),
        Some("https://example.test/moderator.png"),
        "startup-loaded watched history should render badge images before a new live message arrives"
    );

    Ok(())
}

fn chat_message(id: &str, channel_id: &str, text: &str) -> NormalizedChatMessage {
    chat_message_with_badges(id, channel_id, text, vec![], false)
}

fn chat_message_with_timestamp_and_badges(
    id: &str,
    channel_id: &str,
    text: &str,
    timestamp: &str,
    badges: Vec<Badge>,
) -> NormalizedChatMessage {
    NormalizedChatMessage {
        timestamp: timestamp.to_string(),
        ..chat_message_with_badges(id, channel_id, text, badges, false)
    }
}

fn badge_image_url<'a>(message: &'a NormalizedChatMessage, id: &str) -> Option<&'a str> {
    message
        .author
        .badges
        .iter()
        .find(|badge| badge.id == id)
        .and_then(|badge| badge.image_url.as_deref())
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

#[test]
fn user_command_opens_user_card_and_suppresses_send() {
    let mut state = base_user_command_state();
    state.messages.push(user_message(
        "msg-1",
        Platform::Twitch,
        "channel-home",
        "viewer-1",
        Some("viewerone"),
        "TestViewer",
        "1000",
    ));

    let queued = state.queue_composer_send("/user TestViewer");

    assert!(queued);
    assert!(state.take_pending_backend_messages().is_empty());
    assert!(state.take_pending_watched_channel_messages().is_empty());
    assert!(state.user_card.open);
    let target = state
        .user_card
        .target
        .as_ref()
        .expect("user card target should open");
    assert_eq!(target.platform, Platform::Twitch);
    assert_eq!(target.platform_user_id, "viewer-1");
    assert_eq!(target.channel_id, "channel-home");
    assert_eq!(target.channel_slug, "channel-home");
    assert_eq!(target.display_name, "TestViewer");
    assert_eq!(target.username.as_deref(), Some("viewerone"));
    assert_eq!(target.current_alias, None);
}

#[test]
fn app_state_loads_aliases_and_updates_open_user_card_alias()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage =
        twirchat_desktop_rust::storage::Storage::open(&temp.path().join("aliases.sqlite"))?;
    storage
        .user_aliases()
        .upsert(Platform::Twitch, "viewer-1", "Friendly Alias")?;

    let mut state = twirchat_desktop_rust::app_state::AppState::from_storage(&storage);
    let message = user_message(
        "msg-1",
        Platform::Twitch,
        "channel-home",
        "viewer-1",
        Some("viewerone"),
        "Viewer One",
        "1000",
    );

    assert_eq!(state.alias_for_message(&message), Some("Friendly Alias"));
    let target = state.user_card_target_for_message(&message);
    assert_eq!(target.current_alias.as_deref(), Some("Friendly Alias"));

    state.open_user_card(target);
    state.set_user_alias(&storage, Platform::Twitch, "viewer-1", "New Alias")?;
    assert_eq!(state.alias_for_message(&message), Some("New Alias"));
    assert_eq!(
        state
            .user_card
            .target
            .as_ref()
            .and_then(|target| target.current_alias.as_deref()),
        Some("New Alias"),
    );

    state.set_user_alias(&storage, Platform::Twitch, "viewer-1", "   ")?;
    assert_eq!(state.alias_for_message(&message), None);
    assert_eq!(
        state
            .user_card
            .target
            .as_ref()
            .and_then(|target| target.current_alias.as_deref()),
        None,
    );

    Ok(())
}

#[test]
fn user_command_records_feedback_when_no_user_matches() {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();

    let queued = state.queue_composer_send("/user missing");

    assert!(queued);
    assert!(state.take_pending_backend_messages().is_empty());
    assert!(state.take_pending_watched_channel_messages().is_empty());
    assert!(
        state
            .runtime_errors()
            .iter()
            .any(|error| error.contains("No recent chat user matched /user missing"))
    );
    assert!(state.user_card.target.is_none());
    assert!(!state.user_card.open);
}

#[test]
fn user_command_prefers_exact_author_id_over_username_and_display_name() {
    let mut state = base_user_command_state();
    state.messages.push(user_message(
        "msg-older",
        Platform::Twitch,
        "channel-home",
        "viewer-2",
        Some("testviewer"),
        "Other Display",
        "1000",
    ));
    state.messages.push(user_message(
        "msg-newer",
        Platform::Twitch,
        "channel-home",
        "TestViewer",
        Some("someone-else"),
        "Different Display",
        "1001",
    ));

    let queued = state.queue_composer_send("/user TestViewer");

    assert!(queued);
    let target = state
        .user_card
        .target
        .as_ref()
        .expect("exact id match should open a target");
    assert_eq!(target.platform_user_id, "TestViewer");
    assert_eq!(target.display_name, "Different Display");
    assert_eq!(target.username.as_deref(), Some("someone-else"));
}

#[test]
fn user_command_prefers_active_scope_matches_over_home_messages() {
    let mut state = base_user_command_state();
    let watched_channel = watched_channel("watched-1", Platform::Twitch, "watched-streamer");
    state.watched_channels.push(watched_channel);
    state.select_channel_tab("watched-1");

    state.messages.push(user_message(
        "msg-home",
        Platform::Twitch,
        "channel-home",
        "home-viewer",
        Some("testviewer"),
        "Home Viewer",
        "2000",
    ));
    state.watched_channel_messages.insert(
        "watched-1".to_string(),
        vec![user_message(
            "msg-watched",
            Platform::Twitch,
            "watched-1",
            "watched-viewer",
            Some("watchedalias"),
            "TestViewer",
            "1000",
        )],
    );

    let queued = state.queue_composer_send("/user TestViewer");

    assert!(queued);
    let target = state
        .user_card
        .target
        .as_ref()
        .expect("watched scope match should open a target");
    assert_eq!(target.platform_user_id, "watched-viewer");
    assert_eq!(target.channel_id, "watched-1");
    assert_eq!(target.channel_slug, "watched-streamer");
}

fn base_user_command_state() -> twirchat_desktop_rust::app_state::AppState {
    let mut state = twirchat_desktop_rust::app_state::AppState::default();
    state.platforms_panel.statuses.insert(
        Platform::Twitch,
        PlatformStatusInfo {
            platform: Platform::Twitch,
            status: PlatformStatus::Connected,
            error: None,
            mode: PlatformStatusMode::Authenticated,
            channel_login: Some("channel-home".to_string()),
        },
    );
    state
}

fn watched_channel(id: &str, platform: Platform, channel_slug: &str) -> WatchedChannel {
    WatchedChannel {
        id: id.to_string(),
        platform,
        channel_slug: channel_slug.to_string(),
        display_name: channel_slug.to_string(),
        created_at: 1,
    }
}

fn account(id: &str, platform: Platform, platform_user_id: &str, username: &str) -> Account {
    Account {
        id: id.to_string(),
        platform,
        platform_user_id: platform_user_id.to_string(),
        username: username.to_string(),
        display_name: username.to_string(),
        avatar_url: None,
        scopes: Vec::new(),
        created_at: 1,
        updated_at: 1,
    }
}

fn user_card_target(
    platform: Platform,
    platform_user_id: &str,
    channel_id: &str,
    channel_slug: &str,
    display_name: &str,
    username: Option<&str>,
) -> UserCardTarget {
    UserCardTarget {
        platform,
        platform_user_id: platform_user_id.to_string(),
        channel_id: channel_id.to_string(),
        channel_slug: channel_slug.to_string(),
        display_name: display_name.to_string(),
        username: username.map(str::to_string),
        avatar_url: None,
        current_alias: None,
    }
}

fn user_message(
    id: &str,
    platform: Platform,
    channel_id: &str,
    author_id: &str,
    username: Option<&str>,
    display_name: &str,
    timestamp: &str,
) -> NormalizedChatMessage {
    NormalizedChatMessage {
        id: id.to_string(),
        platform,
        channel_id: channel_id.to_string(),
        author: ChatAuthor {
            id: author_id.to_string(),
            username: username.map(str::to_string),
            display_name: display_name.to_string(),
            color: None,
            avatar_url: None,
            badges: vec![],
        },
        text: display_name.to_string(),
        emotes: vec![],
        timestamp: timestamp.to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn user_card_metadata_response(
    platform: twirchat_desktop_rust::protocol::messages::UserCardMetadataPlatform,
    platform_user_id: &str,
) -> twirchat_desktop_rust::protocol::messages::UserCardMetadataResponse {
    use twirchat_desktop_rust::protocol::messages::{
        UserCardAccountAgeField, UserCardFieldStatus, UserCardFollowAgeField, UserCardSubAgeField,
        UserCardSubscriptionDurationField,
    };

    twirchat_desktop_rust::protocol::messages::UserCardMetadataResponse {
        platform,
        platform_user_id: platform_user_id.to_string(),
        fetched_at: 1234,
        account_age: UserCardAccountAgeField {
            status: UserCardFieldStatus::Available,
            created_at: Some("2020-01-01T00:00:00Z".to_string()),
            message: None,
        },
        follow_age: UserCardFollowAgeField {
            status: UserCardFieldStatus::Unavailable,
            followed_at: None,
            message: None,
        },
        subscription_duration: UserCardSubscriptionDurationField {
            status: UserCardFieldStatus::Unsupported,
            currently_subscribed: None,
            tier: None,
            is_gift: None,
            gifter_display_name: None,
            message: None,
        },
        sub_age: UserCardSubAgeField {
            status: UserCardFieldStatus::MissingPermission,
            months: None,
            message: None,
        },
    }
}
