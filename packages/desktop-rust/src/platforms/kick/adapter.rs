use crate::auth::{AuthError, AuthProvider, AuthResult};
use crate::platforms::{
    PlatformAdapter, PlatformError, PlatformEvent, PlatformEventSink, PlatformResult,
};
use crate::protocol::types::{
    Badge, ChatAuthor, ChatMessageType, ChatReply, Emote, EmotePosition, EventUser,
    NormalizedChatMessage, NormalizedEvent, NormalizedEventType, Platform, PlatformStatus,
    PlatformStatusInfo, PlatformStatusMode, ReplyAuthor, StreamStatus,
};
use crate::storage::{Storage, TokenPair, TokenState};
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const KICK_TOKEN_REFRESH_WINDOW_SECONDS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KickAuthState {
    Anonymous,
    Authenticated {
        account_id: String,
        platform_user_id: String,
        username: String,
        display_name: String,
        avatar_url: Option<String>,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<u64>,
    },
    ReauthRequired {
        account_id: String,
        reason: String,
    },
}

impl KickAuthState {
    pub fn mode(&self) -> PlatformStatusMode {
        match self {
            Self::Anonymous | Self::ReauthRequired { .. } => PlatformStatusMode::Anonymous,
            Self::Authenticated { .. } => PlatformStatusMode::Authenticated,
        }
    }

    pub fn is_authenticated(&self) -> bool {
        matches!(self, Self::Authenticated { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KickAdapterErrorKind {
    MissingChatroom,
    MissingBroadcaster,
    AuthRequired,
    Transport,
    Storage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickAdapterError {
    pub kind: KickAdapterErrorKind,
    pub channel_slug: Option<String>,
    pub message: String,
    pub recoverable: bool,
}

impl KickAdapterError {
    fn new(
        kind: KickAdapterErrorKind,
        channel_slug: Option<String>,
        message: impl Into<String>,
        recoverable: bool,
    ) -> Self {
        Self {
            kind,
            channel_slug,
            message: message.into(),
            recoverable,
        }
    }

    fn platform_error(&self) -> PlatformError {
        PlatformError::new(Platform::Kick, self.message.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickChatroom {
    pub channel_slug: String,
    pub chatroom_id: u64,
    pub broadcaster_user_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickBadge {
    pub badge_type: String,
    pub text: String,
    pub count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickEmote {
    pub id: String,
    pub name: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickMessageSender {
    pub id: u64,
    pub username: String,
    pub slug: String,
    pub color: Option<String>,
    pub badges: Vec<KickBadge>,
    pub profile_picture: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickOriginalSender {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickOriginalMessage {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickReplyMetadata {
    pub original_sender: KickOriginalSender,
    pub original_message: KickOriginalMessage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KickChatMessageKind {
    Message,
    Reply,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickChatMessage {
    pub id: String,
    pub chatroom_id: u64,
    pub content: String,
    pub message_type: KickChatMessageKind,
    pub created_at: String,
    pub sender: KickMessageSender,
    pub metadata: Option<KickReplyMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickFollowEvent {
    pub channel_id: u64,
    pub user_id: u64,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub followed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickSubscriptionEvent {
    pub channel_id: u64,
    pub user_id: u64,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub gifted_by: Option<String>,
    pub duration: Option<u64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KickTransportAuth {
    Anonymous,
    Authenticated {
        account_id: String,
        platform_user_id: String,
        username: String,
        display_name: String,
        access_token: String,
    },
    ReauthRequired {
        account_id: String,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickSendMessageRequest {
    pub broadcaster_user_id: u64,
    pub content: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickStreamStatusRequest {
    pub channel_slug: String,
    pub broadcaster_user_id: Option<u64>,
}

pub trait KickChatClient {
    fn resolve_chatroom(&mut self, channel_slug: &str) -> PlatformResult<KickChatroom>;
    fn subscribe_chatroom(
        &mut self,
        chatroom: &KickChatroom,
        auth: &KickTransportAuth,
    ) -> PlatformResult<()>;
    fn disconnect(&mut self) -> PlatformResult<()>;
    fn drain_messages(&mut self) -> PlatformResult<Vec<KickChatMessage>>;
    fn drain_follow_events(&mut self) -> PlatformResult<Vec<KickFollowEvent>>;
    fn drain_subscription_events(&mut self) -> PlatformResult<Vec<KickSubscriptionEvent>>;
    fn send_message(
        &mut self,
        request: KickSendMessageRequest,
        auth: &KickTransportAuth,
    ) -> PlatformResult<String>;
    fn refresh_access_token(
        &mut self,
        account_id: &str,
        refresh_token: &str,
    ) -> PlatformResult<TokenPair>;
    fn stream_status(&mut self, request: KickStreamStatusRequest) -> PlatformResult<StreamStatus>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct KickAuthProvider;

impl AuthProvider for KickAuthProvider {
    fn platform(&self) -> Platform {
        Platform::Kick
    }

    fn display_name(&self) -> &'static str {
        "Kick"
    }

    fn redirect_uri(&self) -> &str {
        "http://localhost:45825/auth/kick/callback"
    }

    fn build_authorization_url(&self, code_challenge: &str, state: &str) -> AuthResult<String> {
        Ok(format!(
            "https://id.kick.com/oauth/authorize?response_type=code&client_id=twirchat-desktop&redirect_uri={}&scope=chat%3Awrite+user%3Aread&code_challenge={code_challenge}&code_challenge_method=S256&state={state}",
            self.redirect_uri()
        ))
    }

    fn exchange_callback(
        &self,
        _code: &str,
        _code_verifier: &str,
    ) -> AuthResult<crate::auth::AuthenticatedAccount> {
        Err(AuthError::Provider {
            platform: Platform::Kick,
            message: "native Kick adapter does not perform network OAuth exchange".into(),
        })
    }
}

pub struct KickAdapter<'a, C> {
    storage: &'a Storage,
    client: C,
    auth_provider: KickAuthProvider,
    channel_slug: Option<String>,
    chatroom: Option<KickChatroom>,
    is_connected: bool,
    should_reconnect: bool,
    auth_state: KickAuthState,
    last_error: Option<KickAdapterError>,
}

impl<'a, C> KickAdapter<'a, C> {
    pub fn new(storage: &'a Storage, client: C) -> Self {
        Self {
            storage,
            client,
            auth_provider: KickAuthProvider,
            channel_slug: None,
            chatroom: None,
            is_connected: false,
            should_reconnect: true,
            auth_state: KickAuthState::Anonymous,
            last_error: None,
        }
    }

    pub fn auth_state(&self) -> &KickAuthState {
        &self.auth_state
    }

    pub fn chatroom(&self) -> Option<&KickChatroom> {
        self.chatroom.as_ref()
    }

    pub fn last_error(&self) -> Option<&KickAdapterError> {
        self.last_error.as_ref()
    }

    pub fn client(&self) -> &C {
        &self.client
    }

    pub fn client_mut(&mut self) -> &mut C {
        &mut self.client
    }
}

impl<C: KickChatClient> KickAdapter<'_, C> {
    pub fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        for message in self.client.drain_messages()? {
            sink.emit(PlatformEvent::Message(self.normalize_message(message)))?;
        }

        for event in self.client.drain_follow_events()? {
            sink.emit(PlatformEvent::Event(normalize_follow_event(event)))?;
        }

        for event in self.client.drain_subscription_events()? {
            sink.emit(PlatformEvent::Event(normalize_subscription_event(event)))?;
        }

        Ok(())
    }

    pub fn stream_status(&mut self, channel_slug: &str) -> PlatformResult<StreamStatus> {
        let request = KickStreamStatusRequest {
            channel_slug: normalize_channel_slug(channel_slug),
            broadcaster_user_id: self
                .chatroom
                .as_ref()
                .map(|chatroom| chatroom.broadcaster_user_id),
        };
        self.client.stream_status(request)
    }

    fn connect_once(&mut self) -> PlatformResult<()> {
        let channel_slug = self
            .channel_slug
            .clone()
            .ok_or_else(|| PlatformError::new(Platform::Kick, "Kick channel slug was not set"))?;
        let chatroom = self
            .client
            .resolve_chatroom(&channel_slug)
            .map_err(|error| {
                self.record_lookup_error(&channel_slug, error.message)
                    .platform_error()
            })?;

        if chatroom.chatroom_id == 0 {
            return Err(self
                .record_lookup_error(
                    &channel_slug,
                    format!("Kick chatroom ID not found for channel \"{channel_slug}\""),
                )
                .platform_error());
        }
        if chatroom.broadcaster_user_id == 0 {
            let error = KickAdapterError::new(
                KickAdapterErrorKind::MissingBroadcaster,
                Some(channel_slug.clone()),
                format!("Kick broadcaster user ID not found for channel \"{channel_slug}\""),
                true,
            );
            self.last_error = Some(error.clone());
            return Err(error.platform_error());
        }

        self.client
            .subscribe_chatroom(&chatroom, &self.transport_auth())?;
        self.chatroom = Some(chatroom);
        self.is_connected = true;
        self.last_error = None;
        Ok(())
    }

    fn record_lookup_error(&mut self, channel_slug: &str, message: String) -> KickAdapterError {
        let error = KickAdapterError::new(
            KickAdapterErrorKind::MissingChatroom,
            Some(channel_slug.into()),
            message,
            true,
        );
        self.chatroom = None;
        self.is_connected = false;
        self.last_error = Some(error.clone());
        error
    }

    fn resolve_auth_state(&self) -> PlatformResult<KickAuthState> {
        let accounts = self
            .storage
            .accounts()
            .find_all_with_token_state()
            .map_err(storage_error)?;
        let Some(entry) = accounts
            .into_iter()
            .find(|entry| entry.account.platform == Platform::Kick)
        else {
            return Ok(KickAuthState::Anonymous);
        };

        match entry.token_state {
            TokenState::Valid(tokens) => {
                if tokens.access_token.is_empty() {
                    return Ok(KickAuthState::ReauthRequired {
                        account_id: entry.account.id,
                        reason: "Kick access token is empty".into(),
                    });
                }

                Ok(KickAuthState::Authenticated {
                    account_id: entry.account.id,
                    platform_user_id: entry.account.platform_user_id,
                    username: entry.account.username,
                    display_name: entry.account.display_name,
                    avatar_url: entry.account.avatar_url,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: tokens.expires_at,
                })
            }
            TokenState::ReauthRequired { reason } => Ok(KickAuthState::ReauthRequired {
                account_id: entry.account.id,
                reason,
            }),
        }
    }

    fn require_authenticated(&self, action: &str) -> PlatformResult<()> {
        match &self.auth_state {
            KickAuthState::Authenticated { .. } => Ok(()),
            KickAuthState::ReauthRequired { reason, .. } => Err(PlatformError::new(
                Platform::Kick,
                format!("Cannot {action}; Kick account requires reauth: {reason}"),
            )),
            KickAuthState::Anonymous => Err(PlatformError::new(
                Platform::Kick,
                format!("Cannot {action} in anonymous Kick mode"),
            )),
        }
    }

    fn refresh_token_before_send(&mut self) -> PlatformResult<()> {
        let KickAuthState::Authenticated {
            account_id,
            refresh_token,
            expires_at,
            ..
        } = &self.auth_state
        else {
            return Ok(());
        };

        if !token_needs_refresh(*expires_at) {
            return Ok(());
        }

        let account_id = account_id.clone();
        let Some(refresh_token) = refresh_token.clone() else {
            return Err(PlatformError::new(
                Platform::Kick,
                "Cannot send Kick message; account token is expired or expiring and no refresh token is stored",
            ));
        };
        let refreshed = self
            .client
            .refresh_access_token(&account_id, &refresh_token)?;
        self.storage
            .accounts()
            .update_tokens(
                &account_id,
                &refreshed.access_token,
                refreshed.refresh_token.as_deref(),
                refreshed.expires_at,
            )
            .map_err(storage_error)?;
        self.auth_state = self.resolve_auth_state()?;
        Ok(())
    }

    fn transport_auth(&self) -> KickTransportAuth {
        match &self.auth_state {
            KickAuthState::Anonymous => KickTransportAuth::Anonymous,
            KickAuthState::Authenticated {
                account_id,
                platform_user_id,
                username,
                display_name,
                access_token,
                ..
            } => KickTransportAuth::Authenticated {
                account_id: account_id.clone(),
                platform_user_id: platform_user_id.clone(),
                username: username.clone(),
                display_name: display_name.clone(),
                access_token: access_token.clone(),
            },
            KickAuthState::ReauthRequired { account_id, reason } => {
                KickTransportAuth::ReauthRequired {
                    account_id: account_id.clone(),
                    reason: reason.clone(),
                }
            }
        }
    }

    fn normalize_message(&self, message: KickChatMessage) -> NormalizedChatMessage {
        let (text, emotes) = parse_kick_emotes(&message.content);
        NormalizedChatMessage {
            id: message.id,
            platform: Platform::Kick,
            channel_id: self
                .chatroom
                .as_ref()
                .map(|chatroom| chatroom.broadcaster_user_id.to_string())
                .unwrap_or_else(|| message.chatroom_id.to_string()),
            author: ChatAuthor {
                id: message.sender.id.to_string(),
                username: Some(message.sender.username.clone()),
                display_name: message.sender.username,
                color: message.sender.color,
                avatar_url: message.sender.profile_picture,
                badges: message
                    .sender
                    .badges
                    .into_iter()
                    .map(normalize_badge)
                    .collect(),
            },
            text,
            emotes,
            timestamp: message.created_at,
            message_type: ChatMessageType::Message,
            reply: normalize_reply(message.message_type, message.metadata),
        }
    }

    fn emit_status(
        &self,
        sink: &mut dyn PlatformEventSink,
        status: PlatformStatus,
        error: Option<String>,
    ) -> PlatformResult<()> {
        sink.emit(PlatformEvent::Status(PlatformStatusInfo {
            platform: Platform::Kick,
            status,
            error,
            mode: self.auth_state.mode(),
            channel_login: self.channel_slug.clone(),
        }))
    }

    fn emit_local_sent_message(
        &self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
        local_id: String,
    ) -> PlatformResult<Option<NormalizedChatMessage>> {
        let KickAuthState::Authenticated {
            account_id,
            platform_user_id,
            username,
            display_name,
            avatar_url,
            ..
        } = &self.auth_state
        else {
            return Ok(None);
        };

        let reply = match reply_to_message_id {
            Some(message_id) => self.find_reply_context(channel_id, message_id)?,
            None => None,
        };

        Ok(Some(NormalizedChatMessage {
            id: format!("local:kick:{channel_id}:{local_id}"),
            platform: Platform::Kick,
            channel_id: channel_id.into(),
            author: ChatAuthor {
                id: if platform_user_id.is_empty() {
                    account_id.clone()
                } else {
                    platform_user_id.clone()
                },
                username: Some(username.clone()),
                display_name: display_name.clone(),
                color: None,
                avatar_url: avatar_url.clone(),
                badges: Vec::new(),
            },
            text: text.into(),
            emotes: Vec::new(),
            timestamp: current_unix_timestamp_string(),
            message_type: ChatMessageType::Message,
            reply,
        }))
    }

    fn find_reply_context(
        &self,
        channel_id: &str,
        reply_to_message_id: &str,
    ) -> PlatformResult<Option<ChatReply>> {
        let recent = self
            .storage
            .messages()
            .get_recent(Some(250))
            .map_err(storage_error)?;
        Ok(recent
            .into_iter()
            .find(|message| {
                message.platform == Platform::Kick
                    && message.channel_id == channel_id
                    && message.id == reply_to_message_id
            })
            .map(|message| ChatReply {
                parent_message_id: message.id,
                parent_message_text: message.text,
                parent_author: ReplyAuthor {
                    id: message.author.id,
                    username: message.author.username.unwrap_or_default(),
                    display_name: message.author.display_name,
                },
            }))
    }
}

impl<C: KickChatClient> PlatformAdapter for KickAdapter<'_, C> {
    type Auth = KickAuthProvider;

    fn platform(&self) -> Platform {
        Platform::Kick
    }

    fn auth_provider(&self) -> &Self::Auth {
        &self.auth_provider
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        let normalized_slug = normalize_channel_slug(channel_slug);
        self.channel_slug = Some(normalized_slug.clone());
        self.chatroom = None;
        self.is_connected = false;
        self.should_reconnect = true;
        self.auth_state = self.resolve_auth_state()?;

        self.storage
            .channels()
            .save(Platform::Kick, &normalized_slug)
            .map_err(storage_error)?;

        self.emit_status(
            sink,
            PlatformStatus::Connecting,
            reauth_reason(&self.auth_state),
        )?;
        match self.connect_once() {
            Ok(()) => self.emit_status(
                sink,
                PlatformStatus::Connected,
                reauth_reason(&self.auth_state),
            ),
            Err(error) => {
                self.emit_status(sink, PlatformStatus::Error, Some(error.message.clone()))?;
                Err(error)
            }
        }
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        self.should_reconnect = false;
        self.client.disconnect()?;
        self.chatroom = None;
        self.is_connected = false;
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        self.require_authenticated("send Kick messages")?;
        if !self.is_connected {
            return Err(PlatformError::new(
                Platform::Kick,
                "Kick chat not connected",
            ));
        }
        self.refresh_token_before_send()?;

        let broadcaster_user_id = self
            .chatroom
            .as_ref()
            .map(|chatroom| chatroom.broadcaster_user_id)
            .or_else(|| parse_u64(channel_id))
            .ok_or_else(|| {
                PlatformError::new(Platform::Kick, "Kick broadcaster user id was not resolved")
            })?;
        let request = KickSendMessageRequest {
            broadcaster_user_id,
            content: text.into(),
            reply_to_message_id: reply_to_message_id.map(str::to_string),
        };
        let local_id = self.client.send_message(request, &self.transport_auth())?;
        let normalized_channel_id = broadcaster_user_id.to_string();
        if let Some(message) = self.emit_local_sent_message(
            &normalized_channel_id,
            text,
            reply_to_message_id,
            local_id,
        )? {
            self.storage
                .messages()
                .save(&message)
                .map_err(storage_error)?;
        }
        Ok(())
    }
}

fn normalize_follow_event(event: KickFollowEvent) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert("channelId".into(), Value::from(event.channel_id));

    NormalizedEvent {
        id: format!("kick:follow:{}:{}", event.user_id, event.followed_at),
        platform: Platform::Kick,
        event_type: NormalizedEventType::Follow,
        user: EventUser {
            id: event.user_id.to_string(),
            display_name: non_empty_display_name(&event.display_name, &event.username),
            avatar_url: event.avatar_url,
        },
        data,
        timestamp: event.followed_at,
    }
}

fn normalize_subscription_event(event: KickSubscriptionEvent) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert("channelId".into(), Value::from(event.channel_id));
    if let Some(duration) = event.duration {
        data.insert("duration".into(), Value::from(duration));
    }
    if let Some(gifted_by) = event.gifted_by.clone() {
        data.insert("giftedBy".into(), Value::String(gifted_by));
    }

    NormalizedEvent {
        id: format!("kick:sub:{}:{}", event.user_id, event.created_at),
        platform: Platform::Kick,
        event_type: if event.gifted_by.is_some() {
            NormalizedEventType::GiftSub
        } else {
            NormalizedEventType::Sub
        },
        user: EventUser {
            id: event.user_id.to_string(),
            display_name: non_empty_display_name(&event.display_name, &event.username),
            avatar_url: event.avatar_url,
        },
        data,
        timestamp: event.created_at,
    }
}

fn normalize_badge(badge: KickBadge) -> Badge {
    Badge {
        id: badge.badge_type.clone(),
        badge_type: badge.badge_type.clone(),
        text: badge.text,
        image_url: kick_badge_svg(&badge.badge_type),
    }
}

fn normalize_reply(
    message_type: KickChatMessageKind,
    metadata: Option<KickReplyMetadata>,
) -> Option<ChatReply> {
    if message_type != KickChatMessageKind::Reply {
        return None;
    }
    metadata.map(|metadata| ChatReply {
        parent_message_id: metadata.original_message.id,
        parent_message_text: metadata.original_message.content,
        parent_author: ReplyAuthor {
            id: metadata.original_sender.id,
            username: metadata.original_sender.username.clone(),
            display_name: metadata.original_sender.username,
        },
    })
}

fn parse_kick_emotes(content: &str) -> (String, Vec<Emote>) {
    let mut clean = String::new();
    let mut emotes = Vec::new();
    let mut rest = content;

    while let Some(start) = rest.find("[emote:") {
        clean.push_str(&rest[..start]);
        let tag_rest = &rest[start..];
        let Some(end) = tag_rest.find(']') else {
            clean.push_str(tag_rest);
            return (clean, emotes);
        };
        let tag = &tag_rest[..=end];
        let inner = &tag[7..tag.len().saturating_sub(1)];
        let mut parts = inner.splitn(2, ':');
        let Some(id) = parts.next().filter(|value| !value.is_empty()) else {
            clean.push_str(tag);
            rest = &tag_rest[end + 1..];
            continue;
        };
        let Some(name) = parts.next().filter(|value| !value.is_empty()) else {
            clean.push_str(tag);
            rest = &tag_rest[end + 1..];
            continue;
        };
        let clean_start = to_u32_or_max(clean.chars().count());
        clean.push_str(name);
        let clean_end =
            clean_start.saturating_add(to_u32_or_max(name.chars().count()).saturating_sub(1));
        emotes.push(Emote {
            id: id.into(),
            name: name.into(),
            image_url: format!("https://files.kick.com/emotes/{id}/fullsize"),
            positions: vec![EmotePosition {
                start: clean_start,
                end: clean_end,
            }],
            aspect_ratio: None,
        });
        rest = &tag_rest[end + 1..];
    }
    clean.push_str(rest);
    (clean, emotes)
}

fn kick_badge_svg(badge_type: &str) -> Option<String> {
    match badge_type {
        "broadcaster" | "moderator" | "subscriber" | "verified" | "founder" | "vip" => {
            Some(format!("kick:badge:{badge_type}"))
        }
        _ => None,
    }
}

fn token_needs_refresh(expires_at: Option<u64>) -> bool {
    expires_at.is_some_and(|expires_at| {
        expires_at <= current_unix_timestamp().saturating_add(KICK_TOKEN_REFRESH_WINDOW_SECONDS)
    })
}

fn reauth_reason(auth_state: &KickAuthState) -> Option<String> {
    match auth_state {
        KickAuthState::ReauthRequired { reason, .. } => Some(reason.clone()),
        KickAuthState::Anonymous | KickAuthState::Authenticated { .. } => None,
    }
}

fn normalize_channel_slug(channel: &str) -> String {
    channel.trim().trim_start_matches('@').to_lowercase()
}

fn non_empty_display_name(display_name: &str, username: &str) -> String {
    if display_name.is_empty() {
        username.into()
    } else {
        display_name.into()
    }
}

fn parse_u64(value: &str) -> Option<u64> {
    value.parse::<u64>().ok()
}

fn current_unix_timestamp() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(_) => 0,
    }
}

fn current_unix_timestamp_string() -> String {
    current_unix_timestamp().to_string()
}

fn to_u32_or_max(value: usize) -> u32 {
    u32::try_from(value).ok().map_or(u32::MAX, |value| value)
}

fn storage_error(error: crate::storage::StorageError) -> PlatformError {
    PlatformError::new(Platform::Kick, error.to_string())
}
