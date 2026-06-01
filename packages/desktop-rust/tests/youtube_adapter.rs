use twirchat::platforms::youtube::{
    MockYouTubeTransport, YouTubeAdapter, YouTubeAuthor, YouTubeStreamItem, YouTubeStreamSignal,
    YouTubeTextMessage, YouTubeTransportKind,
};
use twirchat::platforms::{PlatformAdapter, PlatformEvent, PlatformEventSink};
use twirchat::protocol::types::{
    NormalizedChatMessage, Platform, PlatformStatus, PlatformStatusMode,
};
use twirchat::storage::Storage;
use twirchat::storage::accounts::UpsertAccount;

#[test]
fn youtube_adapter_uses_non_polling_transport() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("youtube-streaming.sqlite"))?;
    seed_youtube_account(&storage, Some(4_102_444_800))?;

    let mut transport =
        MockYouTubeTransport::new().with_resolved_channel("UCfixturechannel", "live-chat-one");
    transport.push_signal(YouTubeStreamSignal::Item(Box::new(
        YouTubeStreamItem::Text(youtube_text_message(
            "yt-msg-1",
            "UCfixturechannel",
            "live-chat-one",
            "hello grpc",
        )),
    )));

    let mut adapter = YouTubeAdapter::new(&storage, transport);
    let mut sink = CapturingSink::default();

    adapter.connect("@FixtureChannel", &mut sink)?;
    assert_eq!(
        adapter.transport_kind(),
        YouTubeTransportKind::ServerStreaming
    );
    assert_eq!(adapter.transport().resolve_calls.len(), 1);
    assert_eq!(adapter.transport().subscribe_calls.len(), 1);
    assert_eq!(
        adapter.transport().subscribe_calls[0].live_chat_id,
        "live-chat-one"
    );
    assert!(adapter.transport().subscribe_auth[0].is_authenticated());
    assert!(matches!(
        adapter.auth_state(),
        twirchat::platforms::youtube::YouTubeAuthState::Authenticated { username, .. }
            if username == "@fixturechannel"
    ));

    adapter.process_server_signals(&mut sink)?;
    adapter.send_message("UCfixturechannel", "sent through stream", None)?;

    let stored_channels = storage.channels().find_all()?;
    assert_eq!(
        stored_channels.get(&Platform::Youtube).cloned(),
        Some(vec!["@fixturechannel".into()])
    );
    assert_eq!(adapter.transport().sent_messages.len(), 1);
    assert_eq!(
        adapter.transport().sent_messages[0].live_chat_id,
        "live-chat-one"
    );

    let statuses = sink.statuses();
    assert!(statuses.iter().any(|status| {
        status.status == PlatformStatus::Connecting
            && status.mode == PlatformStatusMode::Authenticated
            && status.channel_login.as_deref() == Some("@FixtureChannel")
    }));
    assert!(statuses.iter().any(|status| {
        status.status == PlatformStatus::Connected
            && status.mode == PlatformStatusMode::Authenticated
    }));

    let messages = sink.messages();
    let message = messages
        .iter()
        .find(|message| message.id == "yt-msg-1")
        .ok_or("expected streamed YouTube message")?;
    assert_eq!(message.platform, Platform::Youtube);
    assert_eq!(message.channel_id, "UCfixturechannel");
    assert_eq!(message.text, "hello grpc");
    assert_eq!(message.author.badges[0].badge_type, "moderator");

    let local_echo = storage
        .messages()
        .get_recent(Some(10))?
        .into_iter()
        .find(|message| message.id.starts_with("local:youtube:UCfixturechannel:"))
        .ok_or("local YouTube sent-message echo missing")?;
    assert_eq!(local_echo.text, "sent through stream");

    Ok(())
}

#[test]
fn youtube_adapter_reconnects_and_resubscribes() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("youtube-reconnect.sqlite"))?;

    let mut transport = MockYouTubeTransport::new();
    transport.push_resolved_channel_with_video("UCfixturechannel", "live-chat-one", "video-one");
    transport.push_resolved_channel_with_video("UCfixturechannel", "live-chat-two", "video-two");

    let mut adapter = YouTubeAdapter::new(&storage, transport);
    let mut sink = CapturingSink::default();

    adapter.connect("UCfixturechannel", &mut sink)?;
    assert_eq!(
        adapter
            .active_stream()
            .map(|stream| stream.stream_id.as_str()),
        Some("stream-1")
    );

    adapter
        .transport_mut()
        .push_signal(YouTubeStreamSignal::StreamError {
            message: "server stream closed".into(),
        });
    adapter.process_server_signals(&mut sink)?;

    assert_eq!(adapter.reconnect_attempts(), 1);
    assert_eq!(adapter.transport().close_count, 1);
    assert_eq!(adapter.transport().resolve_calls.len(), 2);
    assert_eq!(adapter.transport().subscribe_calls.len(), 2);
    assert_eq!(
        adapter
            .transport()
            .subscribe_calls
            .iter()
            .map(|call| call.live_chat_id.as_str())
            .collect::<Vec<_>>(),
        vec!["live-chat-one", "live-chat-two"]
    );
    assert_eq!(
        adapter
            .active_stream()
            .map(|stream| stream.stream_id.as_str()),
        Some("stream-2")
    );

    adapter
        .transport_mut()
        .push_signal(YouTubeStreamSignal::Item(Box::new(
            YouTubeStreamItem::Text(youtube_text_message(
                "yt-msg-after-reconnect",
                "UCfixturechannel",
                "live-chat-two",
                "back",
            )),
        )));
    adapter.process_server_signals(&mut sink)?;

    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Error
            && status.error.as_deref() == Some("server stream closed")
    }));
    assert!(sink.statuses().iter().any(|status| {
        status.status == PlatformStatus::Connecting
            && status.error.as_deref() == Some("server stream closed")
    }));
    assert_eq!(
        sink.statuses()
            .iter()
            .filter(|status| status.status == PlatformStatus::Connected)
            .count(),
        2
    );
    assert!(
        sink.messages()
            .iter()
            .any(|message| message.id == "yt-msg-after-reconnect")
    );

    Ok(())
}

#[derive(Default)]
struct CapturingSink {
    events: Vec<PlatformEvent>,
}

impl CapturingSink {
    fn statuses(&self) -> Vec<&twirchat::protocol::types::PlatformStatusInfo> {
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
}

impl PlatformEventSink for CapturingSink {
    fn emit(&mut self, event: PlatformEvent) -> twirchat::platforms::PlatformResult<()> {
        self.events.push(event);
        Ok(())
    }
}

trait TestTransportAuth {
    fn is_authenticated(&self) -> bool;
}

impl TestTransportAuth for twirchat::platforms::youtube::YouTubeTransportAuth {
    fn is_authenticated(&self) -> bool {
        matches!(
            self,
            twirchat::platforms::youtube::YouTubeTransportAuth::Authenticated { .. }
        )
    }
}

fn seed_youtube_account(
    storage: &Storage,
    expires_at: Option<u64>,
) -> Result<(), Box<dyn std::error::Error>> {
    storage.accounts().upsert(UpsertAccount {
        id: "youtube:user-1",
        platform: Platform::Youtube,
        platform_user_id: "UCfixturechannel",
        username: "@fixturechannel",
        display_name: "Fixture Channel",
        avatar_url: Some("https://cdn.example/youtube-avatar.png"),
        access_token: "youtube-access-token",
        refresh_token: Some("youtube-refresh-token"),
        expires_at,
        scopes: &["https://www.googleapis.com/auth/youtube.force-ssl".into()],
    })?;
    Ok(())
}

fn youtube_text_message(
    id: &str,
    channel_id: &str,
    live_chat_id: &str,
    text: &str,
) -> YouTubeTextMessage {
    YouTubeTextMessage {
        id: id.into(),
        channel_id: channel_id.into(),
        live_chat_id: live_chat_id.into(),
        author: YouTubeAuthor {
            channel_id: "viewer-1".into(),
            display_name: "Viewer One".into(),
            username: Some("viewerone".into()),
            avatar_url: Some("https://cdn.example/viewer.png".into()),
            is_verified: false,
            is_chat_owner: false,
            is_chat_sponsor: false,
            is_chat_moderator: true,
        },
        text: text.into(),
        timestamp: "1700000000".into(),
        badges: Vec::new(),
    }
}
