use std::fs;
use std::path::PathBuf;
use twirchat_desktop_rust::platforms::kick::{
    KickAdapter, KickAdapterErrorKind, KickAuthState, KickAvatarLookupRequest,
    KickAvatarLookupSource, KickBadge, KickChatMessage, KickChatMessageKind, KickFollowEvent,
    KickMessageSender, KickOriginalMessage, KickOriginalSender, KickReplyMetadata,
    KickSenderIdentity, KickSubscriptionEvent, KickTransportAuth, MockKickClient,
};
use twirchat_desktop_rust::platforms::{PlatformAdapter, PlatformEvent, PlatformEventSink};
use twirchat_desktop_rust::protocol::types::{
    ChatAuthor, ChatMessageType, NormalizedChatMessage, NormalizedEvent, Platform, PlatformStatus,
    PlatformStatusInfo, PlatformStatusMode,
};
use twirchat_desktop_rust::storage::accounts::UpsertAccount;
use twirchat_desktop_rust::storage::{Storage, TokenPair};

#[test]
fn kick_chat_message_deserializes_pusher_payload_shape() -> Result<(), Box<dyn std::error::Error>> {
    let payload = r##"
    {
      "id": "message-1",
      "chatroom_id": 777,
      "content": "hello from kick",
      "type": "message",
      "created_at": "2026-05-11T12:00:00Z",
      "sender": {
        "id": 987,
        "username": "viewerone",
        "slug": "viewerone",
        "identity": {
          "color": "#53fc18",
          "badges": [
            { "type": "subscriber", "text": "Subscriber", "count": 3 }
          ]
        },
        "profile_picture": "https://cdn.example/avatar.png"
      }
    }
    "##;

    let message: KickChatMessage = serde_json::from_str(payload)?;

    assert_eq!(message.message_type, KickChatMessageKind::Message);
    assert_eq!(message.sender.identity.color.as_deref(), Some("#53fc18"));
    assert_eq!(message.sender.identity.badges[0].badge_type, "subscriber");
    assert_eq!(message.sender.identity.badges[0].count, Some(3));
    Ok(())
}

#[test]
fn kick_chat_message_deserializes_message_ref_metadata() -> Result<(), Box<dyn std::error::Error>> {
    let payload = r##"
    {
      "id": "5b56b824-a245-4f65-9a23-7f46956829f4",
      "chatroom_id": 3124040,
      "content": "123",
      "type": "message",
      "created_at": "2026-05-12T08:14:22+00:00",
      "sender": {
        "id": 3195252,
        "username": "Satont",
        "slug": "satont",
        "identity": {
          "color": "#FBCFD8",
          "badges": [{ "type": "broadcaster", "text": "Broadcaster" }]
        }
      },
      "metadata": { "message_ref": "1778573662155" }
    }
    "##;

    let message: KickChatMessage = serde_json::from_str(payload)?;

    assert_eq!(message.message_type, KickChatMessageKind::Message);
    assert_eq!(message.content, "123");
    assert_eq!(message.sender.username, "Satont");
    assert!(message.metadata.is_some());
    Ok(())
}

#[test]
fn kick_adapter_mock_full_capability_matrix() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("kick-capability.sqlite"))?;
    seed_kick_account(&storage, Some(1))?;
    seed_reply_parent(&storage)?;

    let mut client = MockKickClient::new().with_chatroom("FixtureStreamer", 777, 42_4242);
    client.push_refreshed_token(TokenPair {
        access_token: "kick-access-token-refreshed".into(),
        refresh_token: Some("kick-refresh-token-next".into()),
        expires_at: Some(4_102_444_800),
    });
    client.push_message(KickChatMessage {
        id: "kick-msg-1".into(),
        chatroom_id: 777,
        content: "hello [emote:37232:PeepoClap] reply".into(),
        message_type: KickChatMessageKind::Reply,
        created_at: "1700000000".into(),
        sender: KickMessageSender {
            id: 987,
            username: "viewerone".into(),
            slug: "viewerone".into(),
            identity: KickSenderIdentity {
                color: Some("#53fc18".into()),
                badges: vec![
                    KickBadge {
                        badge_type: "moderator".into(),
                        text: "Moderator".into(),
                        count: None,
                    },
                    KickBadge {
                        badge_type: "subscriber".into(),
                        text: "Subscriber".into(),
                        count: Some(3),
                    },
                ],
            },
            profile_picture: Some("https://cdn.example/kick-viewer.png".into()),
        },
        metadata: Some(KickReplyMetadata {
            original_sender: Some(KickOriginalSender {
                id: "123".into(),
                username: "originalviewer".into(),
            }),
            original_message: Some(KickOriginalMessage {
                id: "original-kick-msg".into(),
                content: "original Kick message".into(),
            }),
        }),
    });
    client.push_follow_event(KickFollowEvent {
        channel_id: 42_4242,
        user_id: 555,
        username: "newfollower".into(),
        display_name: "New Follower".into(),
        avatar_url: Some("https://cdn.example/follower.png".into()),
        followed_at: "1700000100".into(),
    });
    client.push_subscription_event(KickSubscriptionEvent {
        channel_id: 42_4242,
        user_id: 666,
        username: "subber".into(),
        display_name: "Subber".into(),
        avatar_url: None,
        gifted_by: None,
        duration: Some(1),
        created_at: "1700000200".into(),
    });
    client.push_subscription_event(KickSubscriptionEvent {
        channel_id: 42_4242,
        user_id: 777,
        username: "gifted".into(),
        display_name: "Gifted User".into(),
        avatar_url: None,
        gifted_by: Some("Gift Giver".into()),
        duration: Some(1),
        created_at: "1700000300".into(),
    });

    let mut adapter = KickAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    adapter.connect("FixtureStreamer", &mut sink)?;
    assert!(matches!(
        adapter.auth_state(),
        KickAuthState::Authenticated { username, .. } if username == "fixturestreamer"
    ));
    assert_eq!(
        adapter.chatroom().map(|chatroom| chatroom.chatroom_id),
        Some(777)
    );
    assert_eq!(adapter.client().subscribed_chatrooms.len(), 1);
    assert!(matches!(
        adapter.client().subscribe_auth[0],
        KickTransportAuth::Authenticated { .. }
    ));

    adapter.poll(&mut sink)?;
    adapter.send_message("424242", "reply from rust", Some("parent-kick-msg"))?;

    let stream_status = adapter.stream_status("FixtureStreamer")?;
    assert!(stream_status.is_live);
    assert_eq!(stream_status.channel_id, "424242");

    let stored_channels = storage.channels().find_all()?;
    assert_eq!(
        stored_channels.get(&Platform::Kick).cloned(),
        Some(vec!["fixturestreamer".into()])
    );

    assert_eq!(adapter.client().refresh_calls.len(), 1);
    assert_eq!(adapter.client().sent_messages.len(), 1);
    let sent = &adapter.client().sent_messages[0];
    assert_eq!(sent.broadcaster_user_id, 42_4242);
    assert_eq!(sent.reply_to_message_id.as_deref(), Some("parent-kick-msg"));
    assert!(matches!(
        sent.auth,
        KickTransportAuth::Authenticated {
            ref access_token,
            ..
        } if access_token == "kick-access-token-refreshed"
    ));

    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connecting
            && status.mode == PlatformStatusMode::Authenticated
            && status.channel_login.as_deref() == Some("fixturestreamer")
    }));
    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connected
            && status.mode == PlatformStatusMode::Authenticated
    }));

    let message = sink
        .messages()
        .into_iter()
        .find(|message| message.id == "kick-msg-1")
        .ok_or("normalized Kick chat message missing")?;
    assert_eq!(message.platform, Platform::Kick);
    assert_eq!(message.channel_id, "424242");
    assert_eq!(message.text, "hello PeepoClap reply");
    assert_eq!(message.author.badges.len(), 2);
    assert!(
        message.author.badges[0]
            .image_url
            .as_deref()
            .is_some_and(|image| image.starts_with("<svg"))
    );
    assert_eq!(message.emotes[0].name, "PeepoClap");
    assert_eq!(message.emotes[0].positions[0].start, 6);
    assert_eq!(
        message
            .reply
            .as_ref()
            .map(|reply| reply.parent_message_id.as_str()),
        Some("original-kick-msg")
    );

    let events = sink.events();
    assert!(
        events
            .iter()
            .any(|event| event.id.starts_with("kick:follow:555"))
    );
    assert!(events.iter().any(|event| event.event_type
        == twirchat_desktop_rust::protocol::types::NormalizedEventType::Sub));
    assert!(events.iter().any(|event| event.event_type
        == twirchat_desktop_rust::protocol::types::NormalizedEventType::GiftSub));

    let local_echo = storage
        .messages()
        .get_recent(Some(10))?
        .into_iter()
        .find(|message| message.id.starts_with("local:kick:424242:"))
        .ok_or("local Kick sent-message echo missing")?;
    assert_eq!(local_echo.text, "reply from rust");
    let reply = local_echo.reply.ok_or("local reply context missing")?;
    assert_eq!(reply.parent_message_id, "parent-kick-msg");
    assert_eq!(reply.parent_author.display_name, "Original Kick Viewer");

    write_evidence(
        "task-13-kick-capability-matrix.json",
        &serde_json::json!({
            "authMode": "authenticated",
            "chatroomId": adapter.chatroom().map(|chatroom| chatroom.chatroom_id),
            "messages": sink.messages().len(),
            "events": sink.events().len(),
            "refreshCalls": adapter.client().refresh_calls.len(),
            "sentReply": sent.reply_to_message_id,
            "streamStatus": stream_status.channel_id,
            "localEchoReply": reply.parent_message_id
        }),
    )?;

    Ok(())
}

#[test]
fn kick_adapter_missing_chatroom_reports_error() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("kick-missing-chatroom.sqlite"))?;

    let mut client = MockKickClient::new();
    client.push_missing_chatroom_once("Kick chatroom ID not found for channel \"recoverable\"");
    client.add_chatroom("recoverable", 888, 99_001);

    let mut adapter = KickAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    let error = adapter
        .connect("recoverable", &mut sink)
        .expect_err("first lookup should surface recoverable missing chatroom");
    assert!(error.message.contains("chatroom ID not found"));

    let typed = adapter
        .last_error()
        .ok_or("typed Kick missing-chatroom error missing")?;
    let typed_kind = typed.kind.clone();
    let typed_recoverable = typed.recoverable;
    let typed_channel_slug = typed.channel_slug.clone();
    assert_eq!(typed_kind, KickAdapterErrorKind::MissingChatroom);
    assert!(typed_recoverable);
    assert_eq!(typed_channel_slug.as_deref(), Some("recoverable"));
    assert!(adapter.chatroom().is_none());
    assert_eq!(adapter.client().subscribed_chatrooms.len(), 0);
    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Error
            && status
                .error
                .as_deref()
                .is_some_and(|error| error.contains("chatroom ID not found"))
    }));

    adapter.connect("recoverable", &mut sink)?;
    assert_eq!(
        adapter.chatroom().map(|chatroom| chatroom.chatroom_id),
        Some(888)
    );
    assert!(adapter.last_error().is_none());
    assert_eq!(adapter.client().chatroom_resolutions.len(), 2);
    assert_eq!(adapter.client().subscribed_chatrooms.len(), 1);

    let stored_channels = storage.channels().find_all()?;
    assert_eq!(
        stored_channels.get(&Platform::Kick).cloned(),
        Some(vec!["recoverable".into()])
    );

    write_evidence(
        "task-13-kick-missing-chatroom.json",
        &serde_json::json!({
            "firstError": error.message,
            "recoverable": typed_recoverable,
            "retryChatroomId": adapter.chatroom().map(|chatroom| chatroom.chatroom_id),
            "resolutionAttempts": adapter.client().chatroom_resolutions.len(),
            "statePreserved": stored_channels.get(&Platform::Kick).cloned().unwrap_or_default()
        }),
    )?;

    Ok(())
}

#[test]
fn kick_adapter_resolves_missing_sender_avatar() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("kick-avatar-resolver.sqlite"))?;

    let mut client = MockKickClient::new();
    client.add_avatar("avatarless", " https://cdn.example/resolved-avatar.png ");
    client.push_message(kick_chat_message(
        "kick-avatar-missing",
        321,
        "Avatarless",
        "avatarless",
        None,
    ));

    let mut adapter = KickAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    adapter.poll(&mut sink)?;

    let message = sink
        .messages()
        .into_iter()
        .find(|message| message.id == "kick-avatar-missing")
        .ok_or("resolved-avatar Kick chat message missing")?;
    assert_eq!(
        message.author.avatar_url.as_deref(),
        Some("https://cdn.example/resolved-avatar.png")
    );
    assert_eq!(
        adapter.client().avatar_resolutions,
        vec![KickAvatarLookupRequest {
            author_id: "321".into(),
            lookup_source: KickAvatarLookupSource::Slug,
            slug_or_username: "avatarless".into(),
        }]
    );

    Ok(())
}

#[test]
fn kick_adapter_treats_blank_sender_avatar_as_missing() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("kick-blank-avatar.sqlite"))?;

    let mut client = MockKickClient::new();
    client.push_message(kick_chat_message(
        "kick-avatar-blank",
        654,
        "BlankAvatar",
        "blank-avatar",
        Some("   ".into()),
    ));

    let mut adapter = KickAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    adapter.poll(&mut sink)?;

    let message = sink
        .messages()
        .into_iter()
        .find(|message| message.id == "kick-avatar-blank")
        .ok_or("blank-avatar Kick chat message missing")?;
    assert_eq!(message.author.avatar_url, None);
    assert_eq!(adapter.client().avatar_resolutions.len(), 1);

    Ok(())
}

#[test]
fn kick_adapter_treats_blank_account_avatar_as_missing_for_local_echo()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("kick-blank-account-avatar.sqlite"))?;
    seed_kick_account_with_avatar(&storage, Some(4_102_444_800), Some("   "))?;

    let client = MockKickClient::new().with_chatroom("FixtureStreamer", 777, 42_4242);
    let mut adapter = KickAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    adapter.connect("FixtureStreamer", &mut sink)?;
    adapter.send_message("424242", "local echo without blank avatar", None)?;

    let local_echo = storage
        .messages()
        .get_recent(Some(10))?
        .into_iter()
        .find(|message| message.id.starts_with("local:kick:424242:"))
        .ok_or("local Kick sent-message echo missing")?;
    assert_eq!(local_echo.author.avatar_url, None);

    Ok(())
}

#[derive(Default)]
struct CapturingSink {
    events: Vec<PlatformEvent>,
}

impl CapturingSink {
    fn statuses(&self) -> Vec<&PlatformStatusInfo> {
        self.events
            .iter()
            .filter_map(|event| match event {
                PlatformEvent::Status(status) => Some(status),
                PlatformEvent::Message(_) | PlatformEvent::Event(_) => None,
            })
            .collect()
    }

    fn messages(&self) -> Vec<&NormalizedChatMessage> {
        self.events
            .iter()
            .filter_map(|event| match event {
                PlatformEvent::Message(message) => Some(message),
                PlatformEvent::Event(_) | PlatformEvent::Status(_) => None,
            })
            .collect()
    }

    fn events(&self) -> Vec<&NormalizedEvent> {
        self.events
            .iter()
            .filter_map(|event| match event {
                PlatformEvent::Event(event) => Some(event),
                PlatformEvent::Message(_) | PlatformEvent::Status(_) => None,
            })
            .collect()
    }
}

impl PlatformEventSink for CapturingSink {
    fn emit(
        &mut self,
        event: PlatformEvent,
    ) -> twirchat_desktop_rust::platforms::PlatformResult<()> {
        self.events.push(event);
        Ok(())
    }
}

fn kick_chat_message(
    id: &str,
    sender_id: u64,
    username: &str,
    slug: &str,
    profile_picture: Option<String>,
) -> KickChatMessage {
    KickChatMessage {
        id: id.into(),
        chatroom_id: 777,
        content: "hello from Kick".into(),
        message_type: KickChatMessageKind::Message,
        created_at: "1700000000".into(),
        sender: KickMessageSender {
            id: sender_id,
            username: username.into(),
            slug: slug.into(),
            identity: KickSenderIdentity {
                color: None,
                badges: Vec::new(),
            },
            profile_picture,
        },
        metadata: None,
    }
}

fn seed_kick_account(
    storage: &Storage,
    expires_at: Option<u64>,
) -> Result<(), Box<dyn std::error::Error>> {
    seed_kick_account_with_avatar(
        storage,
        expires_at,
        Some("https://cdn.example/kick-avatar.png"),
    )
}

fn seed_kick_account_with_avatar(
    storage: &Storage,
    expires_at: Option<u64>,
    avatar_url: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    storage.accounts().upsert(UpsertAccount {
        id: "kick:user-1",
        platform: Platform::Kick,
        platform_user_id: "424242",
        username: "fixturestreamer",
        display_name: "Fixture Streamer",
        avatar_url,
        access_token: "kick-access-token-old",
        refresh_token: Some("kick-refresh-token"),
        expires_at,
        scopes: &["chat:write".into(), "user:read".into()],
    })?;
    Ok(())
}

fn seed_reply_parent(storage: &Storage) -> Result<(), Box<dyn std::error::Error>> {
    storage.messages().save(&NormalizedChatMessage {
        id: "parent-kick-msg".into(),
        platform: Platform::Kick,
        channel_id: "424242".into(),
        author: ChatAuthor {
            id: "parent-viewer".into(),
            username: Some("originalkickviewer".into()),
            display_name: "Original Kick Viewer".into(),
            color: None,
            avatar_url: None,
            badges: Vec::new(),
        },
        text: "original kick text".into(),
        emotes: Vec::new(),
        timestamp: "1699999999".into(),
        message_type: ChatMessageType::Message,
        reply: None,
    })?;
    Ok(())
}

fn write_evidence(name: &str, value: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.sisyphus/evidence")
        .join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}
