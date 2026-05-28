use super::adapter::{
    KickAvatarLookupRequest, KickChatClient, KickChatMessage, KickChatroom, KickFollowEvent,
    KickSendMessageRequest, KickStreamStatusRequest, KickSubscriptionEvent, KickTransportAuth,
};
use crate::platforms::{PlatformError, PlatformResult};
use crate::protocol::types::Platform;
use crate::runtime::config::RuntimeConfig;
use crate::storage::{Storage, TokenPair};
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::net::TcpStream;
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket, connect};

const KICK_PUSHER_WS: &str = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";
const KICK_AVATAR_FETCH_TIMEOUT: Duration = Duration::from_secs(3);

pub struct RealKickClient {
    http: Client,
    backend_url: String,
    client_secret: String,
    socket: Option<WebSocket<MaybeTlsStream<TcpStream>>>,
    chatroom: Option<KickChatroom>,
    incoming_messages: VecDeque<KickChatMessage>,
    follow_events: VecDeque<KickFollowEvent>,
    subscription_events: VecDeque<KickSubscriptionEvent>,
    pending_subscribe: bool,
}

impl RealKickClient {
    pub fn new(storage: &Storage) -> PlatformResult<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;
        let runtime = RuntimeConfig::new(crate::runtime::config::RuntimeConfigInput {
            client_secret: storage.client_identity().get_client_secret().ok(),
            ..Default::default()
        });

        Ok(Self {
            http,
            backend_url: runtime.backend_url().to_string(),
            client_secret: runtime.client_secret().to_string(),
            socket: None,
            chatroom: None,
            incoming_messages: VecDeque::new(),
            follow_events: VecDeque::new(),
            subscription_events: VecDeque::new(),
            pending_subscribe: false,
        })
    }

    fn pump_socket(&mut self) -> PlatformResult<()> {
        if self.socket.is_none() {
            return Ok(());
        }

        loop {
            let message = {
                let socket = self
                    .socket
                    .as_mut()
                    .expect("socket should exist while pumping");
                match socket.read() {
                    Ok(message) => message,
                    Err(tungstenite::Error::Io(error))
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(error) => {
                        self.socket = None;
                        return Err(PlatformError::new(Platform::Kick, error.to_string()));
                    }
                }
            };

            match message {
                Message::Text(text) => self.handle_pusher_event(&text)?,
                Message::Ping(payload) => {
                    if let Some(socket) = self.socket.as_mut() {
                        socket.send(Message::Pong(payload)).map_err(|error| {
                            PlatformError::new(Platform::Kick, error.to_string())
                        })?;
                    }
                }
                Message::Close(_) => {
                    self.socket = None;
                    return Err(PlatformError::new(Platform::Kick, "Kick websocket closed"));
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn handle_pusher_event(&mut self, raw: &str) -> PlatformResult<()> {
        let envelope: PusherEvent = match serde_json::from_str(raw) {
            Ok(envelope) => envelope,
            Err(error) => {
                eprintln!(
                    "[kick/live] failed to decode Pusher envelope: {} raw={}",
                    error,
                    body_snippet(raw)
                );
                return Ok(());
            }
        };

        match envelope.event.as_str() {
            "pusher:connection_established" => {
                eprintln!("[kick/live] websocket connected; sending subscription");
                self.send_subscribe()?;
            }
            "pusher:ping" => {
                if let Some(socket) = self.socket.as_mut() {
                    socket
                        .send(Message::Text(
                            json!({ "event": "pusher:pong", "data": {} }).to_string(),
                        ))
                        .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;
                }
            }
            "pusher_internal:subscription_succeeded" => {
                self.pending_subscribe = false;
                eprintln!("[kick/live] websocket subscription succeeded");
            }
            r"App\Events\ChatMessageEvent" => match envelope.decode_data() {
                Ok(message) => {
                    eprintln!("[kick/live] received chat message from websocket");
                    self.incoming_messages.push_back(message);
                }
                Err(error) => eprintln!(
                    "[kick/live] failed to decode chat message payload: {} data={}",
                    error.message,
                    body_snippet(&envelope.data.to_string())
                ),
            },
            r"App\Events\FollowersUpdated" => match envelope.decode_data() {
                Ok(event) => {
                    eprintln!("[kick/live] received follow event from websocket");
                    self.follow_events.push_back(event);
                }
                Err(error) => eprintln!(
                    "[kick/live] failed to decode follow event payload: {} data={}",
                    error.message,
                    body_snippet(&envelope.data.to_string())
                ),
            },
            r"App\Events\SubscriptionEvent" => match envelope.decode_data() {
                Ok(event) => {
                    eprintln!("[kick/live] received subscription event from websocket");
                    self.subscription_events.push_back(event);
                }
                Err(error) => eprintln!(
                    "[kick/live] failed to decode subscription event payload: {} data={}",
                    error.message,
                    body_snippet(&envelope.data.to_string())
                ),
            },
            _ => {
                if !envelope.event.starts_with("pusher") {
                    eprintln!("[kick/live] unhandled Pusher event: {}", envelope.event);
                }
            }
        }

        Ok(())
    }

    fn send_subscribe(&mut self) -> PlatformResult<()> {
        let Some(chatroom) = &self.chatroom else {
            return Err(PlatformError::new(
                Platform::Kick,
                "Kick chatroom not resolved",
            ));
        };
        let Some(socket) = self.socket.as_mut() else {
            return Err(PlatformError::new(
                Platform::Kick,
                "Kick websocket not connected",
            ));
        };

        let payload = json!({
            "event": "pusher:subscribe",
            "data": {
                "auth": "",
                "channel": format!("chatrooms.{}.v2", chatroom.chatroom_id),
            }
        });
        socket
            .send(Message::Text(payload.to_string()))
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;
        self.pending_subscribe = true;
        Ok(())
    }

    fn connect_socket(&mut self) -> PlatformResult<()> {
        eprintln!("[kick/live] connecting websocket to Kick Pusher");
        let (mut socket, _) = connect(KICK_PUSHER_WS)
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;

        match socket.get_mut() {
            MaybeTlsStream::Plain(stream) => configure_stream(stream),
            MaybeTlsStream::Rustls(stream) => configure_stream(stream.get_mut()),
            _ => {}
        }

        self.socket = Some(socket);
        eprintln!("[kick/live] websocket connection established");
        self.pump_socket()?;
        Ok(())
    }

    fn backend_headers(&self) -> PlatformResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        if !self.client_secret.is_empty() {
            headers.insert(
                "X-Client-Secret",
                HeaderValue::from_str(&self.client_secret)
                    .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?,
            );
        }
        Ok(headers)
    }
}

impl KickChatClient for RealKickClient {
    fn resolve_chatroom(&mut self, channel_slug: &str) -> PlatformResult<KickChatroom> {
        eprintln!("[kick/live] resolving chatroom for slug={channel_slug}");
        let response = self
            .http
            .get(format!("{}/api/kick/chatroom", self.backend_url))
            .query(&[("slug", channel_slug)])
            .send()
            .map_err(|error| {
                eprintln!("[kick/live] chatroom request failed before response: {error}");
                PlatformError::new(Platform::Kick, error.to_string())
            })?;

        let status = response.status();
        eprintln!("[kick/live] chatroom response status: {status}");

        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Kick,
                format!(
                    "Kick chatroom lookup failed with {status}: {}",
                    body_snippet(&body)
                ),
            ));
        }

        let body: KickChatroomResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;
        eprintln!(
            "[kick/live] resolved slug={} chatroom_id={} broadcaster_user_id={}",
            channel_slug, body.chatroom_id, body.broadcaster_user_id
        );
        Ok(KickChatroom {
            channel_slug: channel_slug.to_string(),
            chatroom_id: body.chatroom_id,
            broadcaster_user_id: body.broadcaster_user_id,
        })
    }

    fn resolve_avatar_url(
        &mut self,
        request: KickAvatarLookupRequest,
    ) -> PlatformResult<Option<String>> {
        eprintln!(
            "[kick/live] resolving avatar for author_id={} lookup={}",
            request.author_id, request.slug_or_username
        );
        let response = self
            .http
            .get(format!("{}/api/kick/chatroom", self.backend_url))
            .query(&[("slug", request.slug_or_username.as_str())])
            .timeout(KICK_AVATAR_FETCH_TIMEOUT)
            .send()
            .map_err(|error| {
                eprintln!("[kick/live] backend avatar request failed before response: {error}");
                PlatformError::new(Platform::Kick, error.to_string())
            })?;

        let status = response.status();
        if !status.is_success() {
            eprintln!(
                "[kick/live] avatar lookup returned status={} author_id={}",
                status, request.author_id
            );
            return Ok(None);
        }

        let body: KickChatroomResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;
        let avatar_url = normalize_avatar_url(body.avatar_url.as_deref());
        if avatar_url.is_some() {
            eprintln!(
                "[kick/live] resolved avatar for author_id={}",
                request.author_id
            );
        }
        Ok(avatar_url)
    }

    fn subscribe_chatroom(
        &mut self,
        chatroom: &KickChatroom,
        _auth: &KickTransportAuth,
    ) -> PlatformResult<()> {
        eprintln!(
            "[kick/live] subscribing websocket for slug={} chatroom_id={}",
            chatroom.channel_slug, chatroom.chatroom_id
        );
        self.chatroom = Some(chatroom.clone());
        self.connect_socket()
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
        }
        Ok(())
    }

    fn drain_messages(&mut self) -> PlatformResult<Vec<KickChatMessage>> {
        self.pump_socket()?;
        Ok(self.incoming_messages.drain(..).collect())
    }

    fn drain_follow_events(&mut self) -> PlatformResult<Vec<KickFollowEvent>> {
        Ok(self.follow_events.drain(..).collect())
    }

    fn drain_subscription_events(&mut self) -> PlatformResult<Vec<KickSubscriptionEvent>> {
        Ok(self.subscription_events.drain(..).collect())
    }

    fn send_message(
        &mut self,
        request: KickSendMessageRequest,
        auth: &KickTransportAuth,
    ) -> PlatformResult<String> {
        let KickTransportAuth::Authenticated { access_token, .. } = auth else {
            return Err(PlatformError::new(
                Platform::Kick,
                "Cannot send Kick message without authenticated transport",
            ));
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {access_token}"))
                .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let response = self
            .http
            .post("https://api.kick.com/public/v1/chat")
            .headers(headers)
            .json(&json!({
                "broadcaster_user_id": request.broadcaster_user_id,
                "content": request.content,
                "type": "user",
                "reply_to_message_id": request.reply_to_message_id,
            }))
            .send()
            .map_err(|error| {
                eprintln!("[kick/live] send message request failed before response: {error}");
                PlatformError::new(Platform::Kick, error.to_string())
            })?;

        let status = response.status();
        eprintln!("[kick/live] send message response status: {status}");

        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Kick,
                format!("Kick send failed with {status}: {}", body_snippet(&body)),
            ));
        }

        Ok(String::from("sent"))
    }

    fn refresh_access_token(
        &mut self,
        _account_id: &str,
        refresh_token: &str,
    ) -> PlatformResult<TokenPair> {
        let response = self
            .http
            .post(format!("{}/api/auth/kick/refresh", self.backend_url))
            .json(&json!({ "refreshToken": refresh_token }))
            .send()
            .map_err(|error| {
                eprintln!("[kick/live] refresh request failed before response: {error}");
                PlatformError::new(Platform::Kick, error.to_string())
            })?;

        let status = response.status();
        eprintln!("[kick/live] refresh response status: {status}");

        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Kick,
                format!("Kick refresh failed with {status}: {}", body_snippet(&body)),
            ));
        }

        let body: KickRefreshResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;

        Ok(TokenPair {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expires_at: body
                .expires_in
                .map(|expires_in| current_unix_timestamp().saturating_add(expires_in)),
        })
    }

    fn stream_status(
        &mut self,
        request: KickStreamStatusRequest,
    ) -> PlatformResult<crate::protocol::types::StreamStatus> {
        let response = self
            .http
            .get(format!("{}/api/stream-status", self.backend_url))
            .headers(self.backend_headers()?)
            .query(&[
                ("platform", "kick"),
                ("channelId", request.channel_slug.as_str()),
            ])
            .send()
            .map_err(|error| {
                eprintln!("[kick/live] stream status request failed before response: {error}");
                PlatformError::new(Platform::Kick, error.to_string())
            })?;

        let status = response.status();
        eprintln!("[kick/live] stream status response status: {status}");

        if !status.is_success() {
            let body = response.text().unwrap_or_else(|error| error.to_string());
            return Err(PlatformError::new(
                Platform::Kick,
                format!(
                    "Kick stream status failed with {status}: {}",
                    body_snippet(&body)
                ),
            ));
        }

        let body: KickStreamStatusResponse = response
            .json()
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?;

        Ok(crate::protocol::types::StreamStatus {
            platform: Platform::Kick,
            channel_id: request.channel_slug,
            is_live: body.is_live,
            title: body.title,
            category_id: body.category_id,
            category_name: body.category_name,
            viewer_count: body.viewer_count,
        })
    }
}

#[derive(Deserialize)]
struct KickChatroomResponse {
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
    #[serde(rename = "chatroomId")]
    chatroom_id: u64,
    #[serde(rename = "broadcasterUserId")]
    broadcaster_user_id: u64,
}

#[derive(Deserialize)]
struct KickRefreshResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct KickStreamStatusResponse {
    #[serde(rename = "isLive")]
    is_live: bool,
    title: String,
    #[serde(rename = "categoryId")]
    category_id: Option<String>,
    #[serde(rename = "categoryName")]
    category_name: Option<String>,
    #[serde(rename = "viewerCount")]
    viewer_count: Option<u64>,
}

#[derive(Deserialize)]
struct PusherEvent {
    event: String,
    #[allow(dead_code)]
    channel: Option<String>,
    data: Value,
}

impl PusherEvent {
    fn decode_data<T: serde::de::DeserializeOwned>(&self) -> PlatformResult<T> {
        let value = match &self.data {
            Value::String(text) => serde_json::from_str(text)
                .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))?,
            value => value.clone(),
        };
        serde_json::from_value(value)
            .map_err(|error| PlatformError::new(Platform::Kick, error.to_string()))
    }
}

fn configure_stream(stream: &mut TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
}

fn body_snippet(value: &str) -> String {
    const MAX_LENGTH: usize = 500;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_LENGTH {
        trimmed.to_string()
    } else {
        let snippet: String = trimmed.chars().take(MAX_LENGTH).collect();
        format!("{snippet}...")
    }
}

fn normalize_avatar_url(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.into())
    }
}

fn current_unix_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
