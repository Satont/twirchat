use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use twirchat_desktop_rust::platforms::{PlatformEvent, PlatformEventSink, PlatformResult};
use twirchat_desktop_rust::protocol::{
    Badge, ChatAuthor, ChatMessageType, DesktopToBackendMessage, Emote, LayoutNode,
    NormalizedChatMessage, PanelContent, Platform, PlatformStatus, PlatformStatusInfo,
    PlatformStatusMode, SevenTvEmote, SplitDirection, WatchedChannelsLayout,
    WatchedChannelsLayoutMeta,
};
use twirchat_desktop_rust::services::{WatchedChannelAdapter, WatchedChannelsRuntime};
use twirchat_desktop_rust::storage::Storage;
use twirchat_desktop_rust::storage::accounts::UpsertAccount;
use twirchat_desktop_rust::storage::db::Param;

#[test]
fn watched_channels_runtime_persists_and_rehydrates() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("watched-runtime.sqlite"))?;
    let harness = AdapterHarness::default();
    let mut runtime = runtime_with_harness(&storage, harness.clone(), 2);

    let twitch = runtime.add_channel(
        Platform::Twitch,
        "#FixtureStreamer",
        Some("Fixture Streamer"),
    )?;
    let kick = runtime.add_channel(Platform::Kick, "@KickOne", None)?;

    let persisted = storage.watched_channels().find_all()?;
    assert_eq!(persisted.len(), 2);
    assert_eq!(persisted[0].channel_slug, "fixturestreamer");
    assert_eq!(persisted[1].channel_slug, "kickone");
    assert_eq!(runtime.channel_count(), 2);

    runtime.register_seven_tv_emote_set(
        Platform::Twitch,
        "fixturestreamer",
        vec![seven_tv_emote("7tv-kekw", "KEKW")],
    );
    harness.queue_message(
        Platform::Twitch,
        "fixturestreamer",
        chat_message("msg-1", Platform::Twitch, "fixturestreamer", "first"),
    );
    harness.queue_message(
        Platform::Twitch,
        "fixturestreamer",
        chat_message("msg-2", Platform::Twitch, "fixturestreamer", "second KEKW"),
    );
    harness.queue_message(
        Platform::Twitch,
        "fixturestreamer",
        chat_message("msg-3", Platform::Twitch, "fixturestreamer", "third KEKW"),
    );
    runtime.poll_channel(&twitch.id)?;

    let buffered = runtime.get_messages(&twitch.id);
    assert_eq!(buffered.len(), 2);
    assert_eq!(buffered[0].id, "msg-3");
    assert_eq!(buffered[1].id, "msg-2");
    assert!(
        buffered[0]
            .emotes
            .iter()
            .any(|emote| emote.id == "7tv-kekw")
    );
    let stored = storage.messages().get_recent(Some(5))?;
    assert!(
        stored
            .iter()
            .any(|message| message.id == "msg-3"
                && message.emotes.iter().any(|emote| emote.id == "7tv-kekw"))
    );

    storage
        .settings()
        .set_tab_channel_ids(&[twitch.id.clone(), kick.id.clone()])?;
    storage
        .watched_layout()
        .set(&twitch.id, &split_layout(&twitch.id, &kick.id))?;
    storage
        .watched_layout()
        .set(&kick.id, &single_layout(&kick.id))?;

    runtime.remove_channel(&kick.id)?;

    let remaining = storage.watched_channels().find_all()?;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, twitch.id);
    assert_eq!(
        storage.settings().get_tab_channel_ids()?,
        Some(vec![twitch.id.clone()])
    );
    assert!(!layout_value_exists(&storage, &kick.id)?);

    let cleaned_layout = storage.watched_layout().get(&twitch.id)?;
    assert!(layout_contains_watched(&cleaned_layout.root, &twitch.id));
    assert!(layout_contains_empty(&cleaned_layout.root));
    assert!(!layout_contains_watched(&cleaned_layout.root, &kick.id));

    let rehydrate_harness = AdapterHarness::default();
    let mut rehydrated = runtime_with_harness(&storage, rehydrate_harness.clone(), 2);
    let rehydrated_channels = rehydrated.auto_connect()?;
    assert_eq!(rehydrated_channels.len(), 1);
    assert!(rehydrated.contains_channel(&twitch.id));
    assert_eq!(rehydrated.channel_count(), 1);
    assert_eq!(
        rehydrate_harness
            .snapshot(Platform::Twitch, "fixturestreamer")
            .map(|record| record.connect_count),
        Some(1)
    );
    assert!(rehydrated.drain_backend_messages().iter().any(|message| {
        matches!(
            message,
            DesktopToBackendMessage::SeventvSubscribe {
                platform: Platform::Twitch,
                channel_id,
                platform_user_id: None,
            } if channel_id == "fixturestreamer"
        )
    }));

    Ok(())
}

#[test]
fn watched_channels_reconnects_and_resubscribes() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("watched-reconnect.sqlite"))?;
    let harness = AdapterHarness::default();
    harness.set_seven_tv_channel_id(Platform::Kick, "kickone", "424242");
    let mut runtime = runtime_with_harness(&storage, harness.clone(), 200);

    let twitch = runtime.add_channel(Platform::Twitch, "FixtureStreamer", Some("Fixture"))?;
    let kick = runtime.add_channel(Platform::Kick, "KickOne", Some("Kick One"))?;
    let youtube = runtime.add_channel(Platform::Youtube, "UCFixtureChannel", Some("YouTube"))?;
    let initial_messages = runtime.drain_backend_messages();
    assert!(initial_messages.iter().any(|message| {
        matches!(
            message,
            DesktopToBackendMessage::SeventvSubscribe {
                platform: Platform::Kick,
                channel_id,
                ..
            } if channel_id == "424242"
        )
    }));

    seed_twitch_account(&storage)?;
    let report = runtime.reconnect_by_platform(Platform::Twitch)?;
    assert_eq!(report.reconnected_channel_ids, vec![twitch.id.clone()]);
    assert!(report.errors.is_empty());

    assert_eq!(
        harness
            .snapshot(Platform::Twitch, "fixturestreamer")
            .map(|record| (record.connect_count, record.disconnect_count)),
        Some((2, 1))
    );
    assert_eq!(
        harness
            .snapshot(Platform::Kick, "kickone")
            .map(|record| (record.connect_count, record.disconnect_count)),
        Some((1, 0))
    );
    assert_eq!(
        harness
            .snapshot(Platform::Youtube, "ucfixturechannel")
            .map(|record| (record.connect_count, record.disconnect_count)),
        Some((1, 0))
    );

    let planned = runtime.drain_backend_messages();
    let subscriptions = planned
        .iter()
        .find_map(|message| match message {
            DesktopToBackendMessage::SeventvResubscribe { subscriptions } => Some(subscriptions),
            _ => None,
        })
        .ok_or("7TV resubscribe message was not planned")?;
    assert_eq!(subscriptions.len(), 3);
    assert!(subscriptions.iter().any(|subscription| {
        subscription.platform == Platform::Twitch
            && subscription.channel_id == "fixturestreamer"
            && subscription.platform_user_id.as_deref() == Some("twitch-user-1")
    }));
    assert!(subscriptions.iter().any(|subscription| {
        subscription.platform == Platform::Kick && subscription.channel_id == "424242"
    }));
    assert!(subscriptions.iter().any(|subscription| {
        subscription.platform == Platform::Youtube && subscription.channel_id == "ucfixturechannel"
    }));

    runtime.send_message(&kick.id, "hello watched", Some("reply-1"))?;
    let kick_record = harness
        .snapshot(Platform::Kick, "kickone")
        .ok_or("Kick adapter record missing")?;
    assert_eq!(kick_record.sent_messages.len(), 1);
    assert_eq!(kick_record.sent_messages[0].channel_id, "kickone");
    assert_eq!(
        kick_record.sent_messages[0].reply_to_message_id.as_deref(),
        Some("reply-1")
    );

    assert!(runtime.contains_channel(&youtube.id));

    Ok(())
}

fn runtime_with_harness<'a>(
    storage: &'a Storage,
    harness: AdapterHarness,
    buffer_size: usize,
) -> WatchedChannelsRuntime<'a> {
    WatchedChannelsRuntime::new(storage, move |channel| {
        Ok(Box::new(RecordingAdapter::new(
            channel.platform,
            channel.channel_slug.clone(),
            harness.clone(),
        )) as Box<dyn WatchedChannelAdapter>)
    })
    .with_buffer_size(buffer_size)
}

#[derive(Clone, Default)]
struct AdapterHarness {
    records: Rc<RefCell<BTreeMap<String, AdapterRecord>>>,
}

impl AdapterHarness {
    fn queue_message(
        &self,
        platform: Platform,
        channel_slug: &str,
        message: NormalizedChatMessage,
    ) {
        self.record_mut(platform, channel_slug)
            .events
            .push_back(PlatformEvent::Message(message));
    }

    fn set_seven_tv_channel_id(&self, platform: Platform, channel_slug: &str, channel_id: &str) {
        self.record_mut(platform, channel_slug).seven_tv_channel_id = Some(channel_id.to_string());
    }

    fn snapshot(&self, platform: Platform, channel_slug: &str) -> Option<AdapterRecord> {
        self.records
            .borrow()
            .get(&adapter_key(platform, channel_slug))
            .cloned()
    }

    fn record_mut(
        &self,
        platform: Platform,
        channel_slug: &str,
    ) -> std::cell::RefMut<'_, AdapterRecord> {
        let key = adapter_key(platform, channel_slug);
        std::cell::RefMut::map(self.records.borrow_mut(), |records| {
            records.entry(key).or_default()
        })
    }
}

#[derive(Clone, Default)]
struct AdapterRecord {
    connect_count: u32,
    disconnect_count: u32,
    sent_messages: Vec<SentMessage>,
    events: VecDeque<PlatformEvent>,
    seven_tv_channel_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SentMessage {
    channel_id: String,
    text: String,
    reply_to_message_id: Option<String>,
}

struct RecordingAdapter {
    platform: Platform,
    channel_slug: String,
    harness: AdapterHarness,
}

impl RecordingAdapter {
    fn new(platform: Platform, channel_slug: String, harness: AdapterHarness) -> Self {
        Self {
            platform,
            channel_slug,
            harness,
        }
    }
}

impl WatchedChannelAdapter for RecordingAdapter {
    fn platform(&self) -> Platform {
        self.platform
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        self.channel_slug = channel_slug.to_string();
        let mut record = self.harness.record_mut(self.platform, channel_slug);
        record.connect_count = record.connect_count.saturating_add(1);
        drop(record);
        sink.emit(PlatformEvent::Status(platform_status(
            self.platform,
            PlatformStatus::Connecting,
            channel_slug,
        )))?;
        sink.emit(PlatformEvent::Status(platform_status(
            self.platform,
            PlatformStatus::Connected,
            channel_slug,
        )))
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        let mut record = self.harness.record_mut(self.platform, &self.channel_slug);
        record.disconnect_count = record.disconnect_count.saturating_add(1);
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        self.harness
            .record_mut(self.platform, &self.channel_slug)
            .sent_messages
            .push(SentMessage {
                channel_id: channel_id.to_string(),
                text: text.to_string(),
                reply_to_message_id: reply_to_message_id.map(str::to_string),
            });
        Ok(())
    }

    fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        let events = self
            .harness
            .record_mut(self.platform, &self.channel_slug)
            .events
            .drain(..)
            .collect::<Vec<_>>();
        for event in events {
            sink.emit(event)?;
        }
        Ok(())
    }

    fn seven_tv_channel_id(&self, fallback_slug: &str) -> String {
        self.harness
            .snapshot(self.platform, &self.channel_slug)
            .and_then(|record| record.seven_tv_channel_id)
            .unwrap_or_else(|| fallback_slug.to_string())
    }
}

fn adapter_key(platform: Platform, channel_slug: &str) -> String {
    format!("{}:{channel_slug}", platform_label(platform))
}

fn platform_label(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::Youtube => "youtube",
        Platform::Kick => "kick",
    }
}

fn platform_status(
    platform: Platform,
    status: PlatformStatus,
    channel_slug: &str,
) -> PlatformStatusInfo {
    PlatformStatusInfo {
        platform,
        status,
        error: None,
        mode: PlatformStatusMode::Anonymous,
        channel_login: Some(channel_slug.to_string()),
    }
}

fn chat_message(
    id: &str,
    platform: Platform,
    channel_id: &str,
    text: &str,
) -> NormalizedChatMessage {
    NormalizedChatMessage {
        id: id.to_string(),
        platform,
        channel_id: channel_id.to_string(),
        author: ChatAuthor {
            id: "viewer-1".to_string(),
            username: Some("viewerone".to_string()),
            display_name: "Viewer One".to_string(),
            color: None,
            avatar_url: None,
            badges: vec![Badge {
                id: "moderator/1".to_string(),
                badge_type: "moderator".to_string(),
                text: "Moderator".to_string(),
                image_url: None,
            }],
        },
        text: text.to_string(),
        emotes: Vec::<Emote>::new(),
        timestamp: "1700000000".to_string(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn seven_tv_emote(id: &str, alias: &str) -> SevenTvEmote {
    SevenTvEmote {
        id: id.to_string(),
        alias: alias.to_string(),
        name: alias.to_string(),
        animated: false,
        zero_width: false,
        aspect_ratio: 1.0,
        image_url: format!("https://cdn.7tv.app/emote/{id}/4x.webp"),
    }
}

fn split_layout(first_channel_id: &str, second_channel_id: &str) -> WatchedChannelsLayout {
    WatchedChannelsLayout {
        version: 2,
        root: LayoutNode::Split {
            id: "root-split".to_string(),
            direction: SplitDirection::Horizontal,
            children: vec![
                LayoutNode::Panel {
                    id: "first-panel".to_string(),
                    content: PanelContent::Watched {
                        channel_id: first_channel_id.to_string(),
                    },
                    flex: 50.0,
                },
                LayoutNode::Panel {
                    id: "second-panel".to_string(),
                    content: PanelContent::Watched {
                        channel_id: second_channel_id.to_string(),
                    },
                    flex: 50.0,
                },
            ],
            flex: 100.0,
            min_size: None,
        },
        meta: Some(WatchedChannelsLayoutMeta {
            created_at: 1,
            updated_at: 1,
            migrated_from: None,
        }),
    }
}

fn single_layout(channel_id: &str) -> WatchedChannelsLayout {
    WatchedChannelsLayout {
        version: 2,
        root: LayoutNode::Panel {
            id: "single-panel".to_string(),
            content: PanelContent::Watched {
                channel_id: channel_id.to_string(),
            },
            flex: 100.0,
        },
        meta: Some(WatchedChannelsLayoutMeta {
            created_at: 1,
            updated_at: 1,
            migrated_from: None,
        }),
    }
}

fn layout_value_exists(
    storage: &Storage,
    tab_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let key = format!("watched_tab_layout_v2_{tab_id}");
    Ok(storage
        .connection()
        .query_one(
            "SELECT value FROM settings WHERE key = ? LIMIT 1",
            &[Param::Text(&key)],
        )?
        .is_some())
}

fn layout_contains_watched(node: &LayoutNode, channel_id: &str) -> bool {
    match node {
        LayoutNode::Panel { content, .. } => {
            matches!(content, PanelContent::Watched { channel_id: id } if id == channel_id)
        }
        LayoutNode::Split { children, .. } => children
            .iter()
            .any(|child| layout_contains_watched(child, channel_id)),
    }
}

fn layout_contains_empty(node: &LayoutNode) -> bool {
    match node {
        LayoutNode::Panel { content, .. } => matches!(content, PanelContent::Empty),
        LayoutNode::Split { children, .. } => children.iter().any(layout_contains_empty),
    }
}

fn seed_twitch_account(storage: &Storage) -> Result<(), Box<dyn std::error::Error>> {
    storage.accounts().upsert(UpsertAccount {
        id: "twitch:user-1",
        platform: Platform::Twitch,
        platform_user_id: "twitch-user-1",
        username: "fixturestreamer",
        display_name: "Fixture Streamer",
        avatar_url: None,
        access_token: "access-token",
        refresh_token: Some("refresh-token"),
        expires_at: Some(4_102_444_800),
        scopes: &["chat:read".to_string(), "chat:edit".to_string()],
    })?;
    Ok(())
}
