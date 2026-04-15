use crate::platforms::adapter::{AdapterEvent, AdapterState, PlatformAdapter};
use crate::{
    AppError, Badge, Emote, EmotePosition, MessageType, NormalizedChatMessage,
    NormalizedChatMessageAuthor, NormalizedChatMessageReply, NormalizedChatMessageReplyAuthor,
    NormalizedEvent, NormalizedEventType, NormalizedEventUser, Platform,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const KICK_API_BASE: &str = "https://kick.com/api/v2";
const KICK_PUSHER_WS: &str = "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";
const MAX_BACKOFF: u64 = 60;

#[derive(Debug, Deserialize)]
struct KickChannelResponse {
    id: u64,
    chatroom: KickChatroomInfo,
}

#[derive(Debug, Deserialize)]
struct KickChatroomInfo {
    id: u64,
}

#[derive(Debug, Deserialize)]
struct PusherEnvelope {
    event: String,
    #[serde(default)]
    data: Value,
}

#[derive(Debug, Deserialize)]
struct KickChatMessage {
    id: String,
    #[serde(rename = "chatroom_id")]
    _chatroom_id: u64,
    content: String,
    #[serde(rename = "type")]
    message_type: String,
    created_at: String,
    sender: KickSender,
    metadata: Option<KickReplyMetadata>,
}

#[derive(Debug, Deserialize)]
struct KickSender {
    id: u64,
    username: String,
    identity: KickIdentity,
    profile_picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KickIdentity {
    color: String,
    badges: Vec<KickBadge>,
}

#[derive(Debug, Deserialize)]
struct KickBadge {
    #[serde(rename = "type")]
    badge_type: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct KickReplyMetadata {
    original_sender: KickReplyOriginalSender,
    original_message: KickReplyOriginalMessage,
}

#[derive(Debug, Deserialize)]
struct KickReplyOriginalSender {
    id: String,
    username: String,
}

#[derive(Debug, Deserialize)]
struct KickReplyOriginalMessage {
    id: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct KickFollowEvent {
    channel_id: u64,
    user_id: u64,
    username: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
    followed_at: String,
}

#[derive(Debug, Deserialize)]
struct KickSubscriptionEvent {
    channel_id: u64,
    user_id: u64,
    username: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
    gifted_by: Option<String>,
    duration: Option<u32>,
    created_at: String,
}

#[derive(Default)]
struct KickConnectionState {
    task: Option<JoinHandle<()>>,
    stop_tx: Option<tokio::sync::watch::Sender<bool>>,
}

pub struct KickAdapter {
    state: Arc<Mutex<KickConnectionState>>,
    http: reqwest::Client,
    broadcaster_user_id: Arc<std::sync::Mutex<Option<String>>>,
}

impl KickAdapter {
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(KickConnectionState::default())),
            http: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 TwirChat/1.0")
                .build()
                .unwrap_or_default(),
            broadcaster_user_id: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    #[must_use]
    pub fn broadcaster_user_id(&self) -> Option<String> {
        match self.broadcaster_user_id.lock() {
            Ok(guard) => guard.clone(),
            Err(error) => {
                tracing::error!(?error, "failed to lock kick broadcaster user id");
                None
            }
        }
    }

    async fn fetch_chatroom(
        http: &reqwest::Client,
        username: &str,
    ) -> Result<(u64, u64), AppError> {
        let url = format!("{KICK_API_BASE}/channels/{username}");
        let resp = http
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::Adapter(format!("kick api fetch: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Adapter(format!(
                "kick api returned {} for channel '{username}'",
                resp.status()
            )));
        }

        let channel: KickChannelResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Adapter(format!("kick api parse: {e}")))?;

        Ok((channel.id, channel.chatroom.id))
    }

    fn build_chat_message(msg: &KickChatMessage, channel_slug: &str) -> NormalizedChatMessage {
        let badges: Vec<Badge> = msg
            .sender
            .identity
            .badges
            .iter()
            .map(|b| Badge {
                id: b.badge_type.clone(),
                badge_type: b.badge_type.clone(),
                text: b.text.clone(),
                image_url: None,
            })
            .collect();

        // Kick encodes emotes as [emote:ID:NAME] — extract positions before stripping tags
        let emote_re = regex_lite::Regex::new(r"\[emote:(\d+):([^\]]+)\]").expect("valid regex");
        let mut emotes: Vec<Emote> = Vec::new();
        let mut offset_delta = 0usize;

        for cap in emote_re.captures_iter(&msg.content) {
            let full_match = cap.get(0).expect("full match");
            let emote_id = cap.get(1).expect("emote id").as_str().to_owned();
            let emote_name = cap.get(2).expect("emote name").as_str().to_owned();

            let clean_start = full_match.start().saturating_sub(offset_delta);
            let clean_end = clean_start + emote_name.len().saturating_sub(1);

            emotes.push(Emote {
                id: emote_id.clone(),
                name: emote_name.clone(),
                image_url: format!("https://files.kick.com/emotes/{emote_id}/fullsize"),
                positions: vec![EmotePosition {
                    start: clean_start,
                    end: clean_end,
                }],
                aspect_ratio: None,
            });

            offset_delta += full_match.len().saturating_sub(emote_name.len());
        }

        let clean_text = emote_re.replace_all(&msg.content, "$2").into_owned();

        let reply = if msg.message_type == "reply" {
            msg.metadata.as_ref().map(|m| NormalizedChatMessageReply {
                parent_message_id: m.original_message.id.clone(),
                parent_message_text: m.original_message.content.clone(),
                parent_author: NormalizedChatMessageReplyAuthor {
                    id: m.original_sender.id.clone(),
                    username: m.original_sender.username.clone(),
                    display_name: m.original_sender.username.clone(),
                },
            })
        } else {
            None
        };

        NormalizedChatMessage {
            id: msg.id.clone(),
            platform: Platform::Kick,
            channel_id: channel_slug.to_owned(),
            author: NormalizedChatMessageAuthor {
                id: msg.sender.id.to_string(),
                username: Some(msg.sender.username.clone()),
                display_name: msg.sender.username.clone(),
                color: if msg.sender.identity.color.is_empty() {
                    None
                } else {
                    Some(msg.sender.identity.color.clone())
                },
                avatar_url: msg.sender.profile_picture.clone(),
                badges,
            },
            text: clean_text,
            emotes,
            timestamp: msg.created_at.clone(),
            message_type: MessageType::Message,
            reply,
        }
    }

    fn build_follow_event(ev: &KickFollowEvent) -> NormalizedEvent {
        let mut data = Map::new();
        data.insert("channelId".to_owned(), json!(ev.channel_id));

        NormalizedEvent {
            id: format!("kick:follow:{}:{}", ev.user_id, ev.followed_at),
            platform: Platform::Kick,
            event_type: NormalizedEventType::Follow,
            user: NormalizedEventUser {
                id: ev.user_id.to_string(),
                display_name: ev
                    .display_name
                    .clone()
                    .unwrap_or_else(|| ev.username.clone()),
                avatar_url: ev.avatar_url.clone(),
            },
            data,
            timestamp: ev.followed_at.clone(),
        }
    }

    fn build_subscription_event(ev: &KickSubscriptionEvent) -> NormalizedEvent {
        let is_gift = ev.gifted_by.is_some();
        let mut data = Map::new();
        data.insert("channelId".to_owned(), json!(ev.channel_id));
        if let Some(gb) = &ev.gifted_by {
            data.insert("giftedBy".to_owned(), json!(gb));
        }
        if let Some(d) = ev.duration {
            data.insert("duration".to_owned(), json!(d));
        }

        NormalizedEvent {
            id: format!("kick:sub:{}:{}", ev.user_id, ev.created_at),
            platform: Platform::Kick,
            event_type: if is_gift {
                NormalizedEventType::GiftSub
            } else {
                NormalizedEventType::Sub
            },
            user: NormalizedEventUser {
                id: ev.user_id.to_string(),
                display_name: ev
                    .display_name
                    .clone()
                    .unwrap_or_else(|| ev.username.clone()),
                avatar_url: ev.avatar_url.clone(),
            },
            data,
            timestamp: ev.created_at.clone(),
        }
    }

    #[allow(clippy::too_many_lines)]
    async fn handle_pusher_event(
        envelope: &PusherEnvelope,
        chatroom_id: u64,
        _broadcaster_id: u64,
        channel: &str,
        event_tx: &tokio::sync::mpsc::Sender<AdapterEvent>,
        ws_sink: &mut futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
    ) {
        match envelope.event.as_str() {
            "pusher:connection_established" => {
                let sub = json!({
                    "event": "pusher:subscribe",
                    "data": {
                        "auth": "",
                        "channel": format!("chatrooms.{chatroom_id}.v2")
                    }
                });
                let _ = ws_sink.send(Message::Text(sub.to_string())).await;
            }
            "pusher:ping" => {
                let pong = json!({"event": "pusher:pong", "data": {}});
                let _ = ws_sink.send(Message::Text(pong.to_string())).await;
            }
            "pusher_internal:subscription_succeeded" => {
                let _ = event_tx
                    .send(AdapterEvent::Status {
                        platform: Platform::Kick,
                        channel: channel.to_owned(),
                        state: AdapterState::Connected,
                    })
                    .await;
            }
            r"App\Events\ChatMessageEvent" => {
                let parsed: Option<KickChatMessage> = parse_pusher_data(&envelope.data);
                if let Some(msg) = parsed {
                    let normalized = Self::build_chat_message(&msg, channel);
                    let _ = event_tx
                        .send(AdapterEvent::Message(Box::new(normalized)))
                        .await;
                }
            }
            r"App\Events\ChatroomClearEvent" => {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let mut data = Map::new();
                data.insert("moderationAction".to_owned(), json!("clearchat"));
                data.insert("scope".to_owned(), json!("channel"));
                let ev = NormalizedEvent {
                    id: format!("kick:clearchat:{now_ms}"),
                    platform: Platform::Kick,
                    event_type: NormalizedEventType::Host,
                    user: NormalizedEventUser {
                        id: String::new(),
                        display_name: "moderation".to_owned(),
                        avatar_url: None,
                    },
                    data,
                    timestamp: format!("{now_ms}"),
                };
                let _ = event_tx.send(AdapterEvent::Event(Box::new(ev))).await;
            }
            r"App\Events\MessageDeletedEvent" => {
                let message_id = envelope
                    .data
                    .get("message")
                    .and_then(|v| v.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();

                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let mut data = Map::new();
                data.insert("moderationAction".to_owned(), json!("clearmsg"));
                data.insert("targetMessageId".to_owned(), json!(message_id));

                let ev = NormalizedEvent {
                    id: format!("kick:deletemsg:{now_ms}"),
                    platform: Platform::Kick,
                    event_type: NormalizedEventType::Host,
                    user: NormalizedEventUser {
                        id: String::new(),
                        display_name: "moderation".to_owned(),
                        avatar_url: None,
                    },
                    data,
                    timestamp: format!("{now_ms}"),
                };
                let _ = event_tx.send(AdapterEvent::Event(Box::new(ev))).await;
            }
            r"App\Events\FollowersUpdated" => {
                let parsed: Option<KickFollowEvent> = parse_pusher_data(&envelope.data);
                if let Some(ev) = parsed {
                    let normalized = Self::build_follow_event(&ev);
                    let _ = event_tx
                        .send(AdapterEvent::Event(Box::new(normalized)))
                        .await;
                }
            }
            r"App\Events\SubscriptionEvent" => {
                let parsed: Option<KickSubscriptionEvent> = parse_pusher_data(&envelope.data);
                if let Some(ev) = parsed {
                    let normalized = Self::build_subscription_event(&ev);
                    let _ = event_tx
                        .send(AdapterEvent::Event(Box::new(normalized)))
                        .await;
                }
            }
            _ => {}
        }
    }
}

impl Default for KickAdapter {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_pusher_data<T: for<'de> Deserialize<'de>>(data: &Value) -> Option<T> {
    match data {
        Value::String(s) => serde_json::from_str(s).ok(),
        _ => serde_json::from_value(data.clone()).ok(),
    }
}

#[async_trait::async_trait]
impl PlatformAdapter for KickAdapter {
    async fn connect(
        &self,
        channel: &str,
        event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    ) -> Result<(), AppError> {
        let _ = event_tx
            .send(AdapterEvent::Status {
                platform: Platform::Kick,
                channel: channel.to_owned(),
                state: AdapterState::Connecting,
            })
            .await;

        let (broadcaster_id, chatroom_id) = Self::fetch_chatroom(&self.http, channel).await?;

        match self.broadcaster_user_id.lock() {
            Ok(mut guard) => {
                *guard = Some(broadcaster_id.to_string());
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock kick broadcaster user id");
            }
        }

        let channel_owned = channel.to_owned();
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);

        let task = tokio::spawn(async move {
            run_kick_ws_loop(
                channel_owned,
                broadcaster_id,
                chatroom_id,
                event_tx,
                stop_rx,
            )
            .await;
        });

        let mut state = self.state.lock().await;
        if let Some(old_stop) = state.stop_tx.take() {
            let _ = old_stop.send(true);
        }
        if let Some(old_task) = state.task.take() {
            old_task.abort();
        }
        state.task = Some(task);
        state.stop_tx = Some(stop_tx);
        drop(state);

        Ok(())
    }

    async fn disconnect(&self, _channel: &str) -> Result<(), AppError> {
        match self.broadcaster_user_id.lock() {
            Ok(mut guard) => {
                *guard = None;
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock kick broadcaster user id");
            }
        }

        let mut state = self.state.lock().await;
        if let Some(stop_tx) = state.stop_tx.take() {
            let _ = stop_tx.send(true);
        }
        if let Some(task) = state.task.take() {
            task.abort();
        }
        drop(state);
        Ok(())
    }

    async fn send_message(
        &self,
        _channel_id: &str,
        _text: &str,
        _reply_to: Option<&str>,
    ) -> Result<(), AppError> {
        Err(AppError::Adapter(
            "kick message sending is not implemented".to_owned(),
        ))
    }

    fn platform(&self) -> Platform {
        Platform::Kick
    }
}

async fn run_kick_ws_loop(
    channel: String,
    broadcaster_id: u64,
    chatroom_id: u64,
    event_tx: tokio::sync::mpsc::Sender<AdapterEvent>,
    mut stop_rx: tokio::sync::watch::Receiver<bool>,
) {
    let mut backoff_secs: u64 = 1;

    loop {
        if *stop_rx.borrow() {
            break;
        }

        match connect_async(KICK_PUSHER_WS).await {
            Err(e) => {
                eprintln!("[KickAdapter] WS connect error: {e}");
            }
            Ok((ws_stream, _)) => {
                backoff_secs = 1;
                let (mut sink, mut stream) = ws_stream.split();

                loop {
                    tokio::select! {
                        _ = stop_rx.changed() => {
                            if *stop_rx.borrow() {
                                let _ = sink.close().await;
                                let _ = event_tx.send(AdapterEvent::Status {
                                    platform: Platform::Kick,
                                    channel: channel.clone(),
                                    state: AdapterState::Disconnected,
                                }).await;
                                return;
                            }
                        }
                        msg = stream.next() => {
                            match msg {
                                None | Some(Ok(Message::Close(_))) => break,
                                Some(Err(e)) => {
                                    eprintln!("[KickAdapter] WS error: {e}");
                                    break;
                                }
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(envelope) = serde_json::from_str::<PusherEnvelope>(&text) {
                                        KickAdapter::handle_pusher_event(
                                            &envelope,
                                            chatroom_id,
                                            broadcaster_id,
                                            &channel,
                                            &event_tx,
                                            &mut sink,
                                        ).await;
                                    }
                                }
                                Some(Ok(Message::Ping(data))) => {
                                    let _ = sink.send(Message::Pong(data)).await;
                                }
                                Some(Ok(_)) => {}
                            }
                        }
                    }
                }

                let _ = event_tx
                    .send(AdapterEvent::Status {
                        platform: Platform::Kick,
                        channel: channel.clone(),
                        state: AdapterState::Disconnected,
                    })
                    .await;
            }
        }

        if *stop_rx.borrow() {
            break;
        }

        let delay = Duration::from_secs(backoff_secs);
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF);

        tokio::select! {
            () = tokio::time::sleep(delay) => {}
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_chat_message_json() -> &'static str {
        r##"{
            "id": "abc-123",
            "chatroom_id": 9999,
            "content": "Hello world",
            "type": "message",
            "created_at": "2024-01-01T00:00:00.000Z",
            "sender": {
                "id": 42,
                "username": "testuser",
                "identity": {
                    "color": "#FF0000",
                    "badges": [
                        { "type": "subscriber", "text": "Sub" }
                    ]
                },
                "profile_picture": null
            }
        }"##
    }

    #[test]
    fn parse_kick_chat_message_into_normalized() {
        let msg: KickChatMessage =
            serde_json::from_str(sample_chat_message_json()).expect("parse KickChatMessage");
        let normalized = KickAdapter::build_chat_message(&msg, "streamer");

        assert_eq!(normalized.id, "abc-123");
        assert_eq!(normalized.platform, Platform::Kick);
        assert_eq!(normalized.channel_id, "streamer");
        assert_eq!(normalized.author.id, "42");
        assert_eq!(normalized.author.username.as_deref(), Some("testuser"));
        assert_eq!(normalized.author.display_name, "testuser");
        assert_eq!(normalized.author.color.as_deref(), Some("#FF0000"));
        assert_eq!(normalized.author.badges.len(), 1);
        assert_eq!(normalized.author.badges[0].badge_type, "subscriber");
        assert_eq!(normalized.text, "Hello world");
        assert!(matches!(normalized.message_type, MessageType::Message));
        assert!(normalized.reply.is_none());
        assert!(normalized.emotes.is_empty());
    }

    #[test]
    fn parse_kick_chat_message_with_emote() {
        let json_str = r#"{
            "id": "emote-test",
            "chatroom_id": 1,
            "content": "[emote:37232:PeepoClap] hello",
            "type": "message",
            "created_at": "2024-01-01T00:00:00.000Z",
            "sender": {
                "id": 1,
                "username": "user",
                "identity": { "color": "", "badges": [] }
            }
        }"#;

        let msg: KickChatMessage = serde_json::from_str(json_str).expect("parse");
        let normalized = KickAdapter::build_chat_message(&msg, "streamer");

        assert_eq!(normalized.text, "PeepoClap hello");
        assert_eq!(normalized.emotes.len(), 1);
        assert_eq!(normalized.emotes[0].id, "37232");
        assert_eq!(normalized.emotes[0].name, "PeepoClap");
        assert_eq!(normalized.emotes[0].positions[0].start, 0);
        assert_eq!(normalized.emotes[0].positions[0].end, 8);
    }

    #[test]
    fn parse_pusher_envelope_string_data() {
        let raw = r#"{"event":"App\\Events\\ChatMessageEvent","data":"{\"id\":\"x\"}"}"#;
        let envelope: PusherEnvelope = serde_json::from_str(raw).expect("parse envelope");
        assert_eq!(envelope.event, r"App\Events\ChatMessageEvent");
        assert!(envelope.data.is_string());
    }
}
