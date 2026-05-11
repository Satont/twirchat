use std::fs;
use std::path::PathBuf;
use twirchat_desktop_rust::platforms::twitch::{
    MockTwitchClient, StreamUpdate, TwitchAdapter, TwitchAuthState, TwitchChatEvent,
    TwitchChatMessage, TwitchEmoteSpan,
};
use twirchat_desktop_rust::platforms::{PlatformAdapter, PlatformEvent, PlatformEventSink};
use twirchat_desktop_rust::protocol::types::{
    ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform, PlatformStatus,
    PlatformStatusMode,
};
use twirchat_desktop_rust::storage::accounts::UpsertAccount;
use twirchat_desktop_rust::storage::{Storage, TokenState};

#[test]
fn twitch_adapter_mock_full_capability_matrix() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("twitch-capability.sqlite"))?;
    seed_twitch_account(&storage, Some(4_102_444_800))?;
    seed_reply_parent(&storage)?;

    let mut client = MockTwitchClient::new()
        .with_badge("moderator/1", "https://cdn.example/mod.png")
        .with_badge("subscriber/12", "https://cdn.example/sub.png")
        .with_category("509658", "Just Chatting")
        .with_category("21779", "League of Legends");
    client.push_message(TwitchChatMessage {
        id: "msg-live".into(),
        channel: "#FixtureStreamer".into(),
        user_id: "viewer-1".into(),
        username: "viewerlogin".into(),
        display_name: "Viewer Login".into(),
        color: Some("#9146ff".into()),
        text: "Kappa hello".into(),
        timestamp: "1700000000".into(),
        badges: vec![
            ("moderator".into(), "1".into()),
            ("subscriber".into(), "12".into()),
        ],
        emotes: vec![TwitchEmoteSpan {
            id: "25".into(),
            name: "Kappa".into(),
            start: 0,
            end: 4,
        }],
        is_action: false,
        reply: None,
        bits: Some(100),
    });
    client.push_event(TwitchChatEvent::Raid {
        id: "raid-1".into(),
        channel_id: "fixturestreamer".into(),
        user_id: "raider-1".into(),
        display_name: "Raider".into(),
        viewer_count: 9,
        system_message: Some("Raider is raiding".into()),
    });

    let mut adapter = TwitchAdapter::new(&storage, client);
    let mut sink = CapturingSink::default();

    adapter.connect("FixtureStreamer", &mut sink)?;
    assert!(
        matches!(adapter.auth_state(), TwitchAuthState::Authenticated { login, .. } if login == "fixturestreamer")
    );
    assert_eq!(
        adapter.client().connected_channel.as_deref(),
        Some("fixturestreamer")
    );
    assert_eq!(adapter.badge_cache().len(), 2);

    adapter.poll(&mut sink)?;
    adapter.send_message("fixturestreamer", "reply from rust", Some("parent-msg"))?;

    let categories = adapter.search_categories("chat")?;
    assert_eq!(categories.len(), 1);
    assert_eq!(categories[0].name, "Just Chatting");

    let update = adapter.update_stream(&StreamUpdate {
        channel_id: "fixturestreamer".into(),
        title: Some("Updated from Rust".into()),
        category_id: Some("509658".into()),
    })?;
    assert_eq!(update.updated_title.as_deref(), Some("Updated from Rust"));

    let status = adapter.stream_status("fixturestreamer")?;
    assert!(status.is_live);
    assert_eq!(status.category_name.as_deref(), Some("Just Chatting"));

    let sent = &adapter.client().sent_messages;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].reply_to_message_id.as_deref(), Some("parent-msg"));
    assert_eq!(adapter.client().stream_updates.len(), 1);

    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connecting
            && status.mode == PlatformStatusMode::Authenticated
            && status.channel_login.as_deref() == Some("fixturestreamer")
    }));
    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connected
            && status.mode == PlatformStatusMode::Authenticated
    }));

    let captured_messages = sink.messages();
    let live_message = captured_messages
        .iter()
        .find(|message| message.id == "msg-live")
        .ok_or("live message missing")?;
    assert_eq!(live_message.channel_id, "fixturestreamer");
    assert_eq!(live_message.author.badges.len(), 2);
    assert_eq!(
        live_message.author.badges[0].image_url.as_deref(),
        Some("https://cdn.example/mod.png")
    );
    assert_eq!(
        live_message.emotes[0].image_url,
        "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0"
    );

    let local_echo = storage
        .messages()
        .get_recent(Some(10))?
        .into_iter()
        .find(|message| message.id.starts_with("local:twitch:fixturestreamer:"))
        .ok_or("local sent-message echo missing")?;
    assert_eq!(local_echo.text, "reply from rust");
    let reply = local_echo.reply.ok_or("reply context missing")?;
    assert_eq!(reply.parent_message_id, "parent-msg");
    assert_eq!(reply.parent_author.display_name, "Original Viewer");

    assert!(sink.events().iter().any(|event| event.id == "raid-1"));
    assert!(
        sink.events()
            .iter()
            .any(|event| event.id.starts_with("twitch:bits:viewer-1"))
    );

    write_evidence(
        "task-11-twitch-capability-matrix.json",
        &serde_json::json!({
            "authMode": "authenticated",
            "badges": adapter.badge_cache().len(),
            "messages": sink.messages().len(),
            "events": sink.events().len(),
            "categories": categories.len(),
            "streamUpdates": adapter.client().stream_updates.len(),
            "localEchoReply": reply.parent_message_id
        }),
    )?;

    Ok(())
}

#[test]
fn twitch_adapter_expired_token_requires_reauth() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("twitch-expired.sqlite"))?;
    seed_twitch_account(&storage, Some(1))?;
    let mut adapter = TwitchAdapter::new(&storage, MockTwitchClient::new());
    let mut sink = CapturingSink::default();

    adapter.connect("fixturestreamer", &mut sink)?;
    let reason = match adapter.auth_state() {
        TwitchAuthState::ReauthRequired { reason, .. } => reason.clone(),
        other => return Err(format!("expected reauth required, got {other:?}").into()),
    };
    let err = adapter
        .send_message("fixturestreamer", "should fail", None)
        .expect_err("expired token must prevent send");
    assert!(err.message.contains("requires reauth"));

    let accounts = storage.accounts().find_all_with_token_state()?;
    assert_eq!(accounts.len(), 1, "expired account must be preserved");
    assert!(matches!(accounts[0].token_state, TokenState::Valid(_)));
    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connected
            && status.mode == PlatformStatusMode::Anonymous
            && status.error.as_deref() == Some(reason.as_str())
    }));

    write_evidence(
        "task-11-twitch-expired-token.json",
        &serde_json::json!({
            "accountPreserved": accounts[0].account.id,
            "adapterAuthState": "reauth_required",
            "reason": reason
        }),
    )?;

    Ok(())
}

#[derive(Default)]
struct CapturingSink {
    events: Vec<PlatformEvent>,
}

impl CapturingSink {
    fn statuses(&self) -> Vec<&twirchat_desktop_rust::protocol::types::PlatformStatusInfo> {
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

    fn events(&self) -> Vec<&twirchat_desktop_rust::protocol::types::NormalizedEvent> {
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

fn seed_twitch_account(
    storage: &Storage,
    expires_at: Option<u64>,
) -> Result<(), Box<dyn std::error::Error>> {
    storage.accounts().upsert(UpsertAccount {
        id: "twitch:user-1",
        platform: Platform::Twitch,
        platform_user_id: "user-1",
        username: "fixturestreamer",
        display_name: "Fixture Streamer",
        avatar_url: Some("https://cdn.example/avatar.png"),
        access_token: "access-token",
        refresh_token: Some("refresh-token"),
        expires_at,
        scopes: &["chat:read".into(), "chat:edit".into()],
    })?;
    Ok(())
}

fn seed_reply_parent(storage: &Storage) -> Result<(), Box<dyn std::error::Error>> {
    storage.messages().save(&NormalizedChatMessage {
        id: "parent-msg".into(),
        platform: Platform::Twitch,
        channel_id: "fixturestreamer".into(),
        author: ChatAuthor {
            id: "viewer-parent".into(),
            username: Some("originalviewer".into()),
            display_name: "Original Viewer".into(),
            color: None,
            avatar_url: None,
            badges: Vec::new(),
        },
        text: "original text".into(),
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
