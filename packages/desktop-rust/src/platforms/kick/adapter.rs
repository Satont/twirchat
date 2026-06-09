use super::badges::kick_badge_embedded_url;
use crate::auth::{AuthError, AuthProvider, AuthResult};
use crate::platforms::{
    PlatformAdapter, PlatformError, PlatformEvent, PlatformEventSink, PlatformResult,
};
use crate::protocol::types::{
    Badge, ChatAuthor, ChatMessageType, ChatReply, Emote, EmotePosition, EventUser,
    NormalizedChatMessage, NormalizedEvent, NormalizedEventType, Platform, PlatformStatus,
    PlatformStatusInfo, PlatformStatusMode, ReplyAuthor, StreamStatus,
};
use crate::runtime::KICK_REDIRECT_URI;
use crate::storage::{Storage, TokenPair, TokenState};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const KICK_TOKEN_REFRESH_WINDOW_SECONDS: u64 = 300;
const KICK_RECONNECT_MIN_DELAY: Duration = Duration::from_secs(1);
const KICK_RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickChatroom {
    pub channel_slug: String,
    pub chatroom_id: u64,
    pub broadcaster_user_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickBadge {
    #[serde(rename = "type")]
    pub badge_type: String,
    pub text: String,
    pub count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickEmote {
    pub id: String,
    pub name: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickMessageSender {
    pub id: u64,
    pub username: String,
    pub slug: String,
    pub identity: KickSenderIdentity,
    #[serde(default)]
    pub profile_picture: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickSenderIdentity {
    pub color: Option<String>,
    #[serde(default)]
    pub badges: Vec<KickBadge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickOriginalSender {
    #[serde(deserialize_with = "deserialize_string_or_number")]
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickOriginalMessage {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickReplyMetadata {
    pub original_sender: Option<KickOriginalSender>,
    pub original_message: Option<KickOriginalMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KickChatMessageKind {
    Message,
    Reply,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickChatMessage {
    pub id: String,
    pub chatroom_id: u64,
    pub content: String,
    #[serde(rename = "type")]
    pub message_type: KickChatMessageKind,
    pub created_at: String,
    pub sender: KickMessageSender,
    pub metadata: Option<KickReplyMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickFollowEvent {
    pub channel_id: u64,
    pub user_id: u64,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub followed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickUserBannedEvent {
    #[serde(default)]
    pub chatroom_id: Option<u64>,
    #[serde(default)]
    pub user_id: Option<u64>,
    pub user: KickBannedUser,
    pub banned_by: Option<KickBannedBy>,
    #[serde(default)]
    pub duration: Option<u32>,
    pub permanent: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickBannedUser {
    pub id: u64,
    pub username: String,
    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickBannedBy {
    pub id: u64,
    pub username: String,
    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KickUserUnbannedEvent {
    #[serde(default)]
    pub chatroom_id: Option<u64>,
    #[serde(default)]
    pub user_id: Option<u64>,
    pub user: KickBannedUser,
    #[serde(default)]
    pub unbanned_by: Option<KickBannedBy>,
    pub permanent: bool,
    #[serde(default)]
    pub created_at: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KickAvatarLookupSource {
    Slug,
    Username,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickAvatarLookupRequest {
    pub author_id: String,
    pub lookup_source: KickAvatarLookupSource,
    pub slug_or_username: String,
}

pub trait KickChatClient {
    fn resolve_chatroom(&mut self, channel_slug: &str) -> PlatformResult<KickChatroom>;
    fn resolve_avatar_url(
        &mut self,
        request: KickAvatarLookupRequest,
    ) -> PlatformResult<Option<String>>;
    fn subscribe_chatroom(
        &mut self,
        chatroom: &KickChatroom,
        auth: &KickTransportAuth,
    ) -> PlatformResult<()>;
    fn disconnect(&mut self) -> PlatformResult<()>;
    fn drain_messages(&mut self) -> PlatformResult<Vec<KickChatMessage>>;
    fn drain_follow_events(&mut self) -> PlatformResult<Vec<KickFollowEvent>>;
    fn drain_subscription_events(&mut self) -> PlatformResult<Vec<KickSubscriptionEvent>>;
    fn drain_ban_events(&mut self) -> PlatformResult<Vec<KickUserBannedEvent>>;
    fn drain_unban_events(&mut self) -> PlatformResult<Vec<KickUserUnbannedEvent>>;
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
        KICK_REDIRECT_URI
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
    reconnect_attempt: u32,
    reconnect_due_at: Option<Instant>,
    auth_state: KickAuthState,
    last_error: Option<KickAdapterError>,
    avatar_cache: BTreeMap<String, String>,
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
            reconnect_attempt: 0,
            reconnect_due_at: None,
            auth_state: KickAuthState::Anonymous,
            last_error: None,
            avatar_cache: BTreeMap::new(),
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
        if !self.is_connected && self.channel_slug.is_some() {
            if !self.should_reconnect {
                return Ok(());
            }

            if !self.is_reconnect_due() {
                return Ok(());
            }

            self.emit_status(
                sink,
                PlatformStatus::Connecting,
                reauth_reason(&self.auth_state),
            )?;

            match self.connect_once() {
                Ok(()) => {
                    self.reset_reconnect_state();
                    self.emit_status(
                        sink,
                        PlatformStatus::Connected,
                        reauth_reason(&self.auth_state),
                    )?;
                }
                Err(error) => {
                    self.emit_status(sink, PlatformStatus::Error, Some(error.message.clone()))?;
                    self.schedule_reconnect(false);
                }
            }

            return Ok(());
        }

        let messages = match self.client.drain_messages() {
            Ok(messages) => messages,
            Err(error) => {
                self.handle_transport_poll_error(sink, error)?;
                return Ok(());
            }
        };
        let follows = match self.client.drain_follow_events() {
            Ok(events) => events,
            Err(error) => {
                self.handle_transport_poll_error(sink, error)?;
                return Ok(());
            }
        };
        let subscriptions = match self.client.drain_subscription_events() {
            Ok(events) => events,
            Err(error) => {
                self.handle_transport_poll_error(sink, error)?;
                return Ok(());
            }
        };
        let bans = match self.client.drain_ban_events() {
            Ok(events) => events,
            Err(error) => {
                self.handle_transport_poll_error(sink, error)?;
                return Ok(());
            }
        };
        let unbans = match self.client.drain_unban_events() {
            Ok(events) => events,
            Err(error) => {
                self.handle_transport_poll_error(sink, error)?;
                return Ok(());
            }
        };

        if !messages.is_empty()
            || !follows.is_empty()
            || !subscriptions.is_empty()
            || !bans.is_empty()
            || !unbans.is_empty()
        {
            eprintln!(
                "[kick/live] drained messages={} follows={} subscriptions={} bans={} unbans={} slug={:?}",
                messages.len(),
                follows.len(),
                subscriptions.len(),
                bans.len(),
                unbans.len(),
                self.channel_slug
            );
        }

        for message in messages {
            sink.emit(PlatformEvent::Message(self.normalize_message(message)))?;
        }

        for event in follows {
            sink.emit(PlatformEvent::Event(normalize_follow_event(event)))?;
        }

        for event in subscriptions {
            sink.emit(PlatformEvent::Event(normalize_subscription_event(event)))?;
        }

        for event in bans {
            sink.emit(PlatformEvent::Message(self.normalize_ban_event(event)))?;
        }

        for event in unbans {
            sink.emit(PlatformEvent::Message(self.normalize_unban_event(event)))?;
        }

        Ok(())
    }

    fn handle_transport_poll_error(
        &mut self,
        sink: &mut dyn PlatformEventSink,
        error: PlatformError,
    ) -> PlatformResult<()> {
        self.is_connected = false;
        self.should_reconnect = true;
        let _ = self.client.disconnect();

        let typed = KickAdapterError::new(
            KickAdapterErrorKind::Transport,
            self.channel_slug.clone(),
            error.message.clone(),
            true,
        );
        self.last_error = Some(typed.clone());

        self.emit_status(sink, PlatformStatus::Error, Some(typed.message.clone()))?;
        self.schedule_reconnect(true);
        Ok(())
    }

    fn schedule_reconnect(&mut self, immediate: bool) {
        let now = Instant::now();
        if immediate {
            self.reconnect_due_at = Some(now);
            self.reconnect_attempt = 0;
            return;
        }

        let delay = reconnect_delay_for_attempt(self.reconnect_attempt);
        self.reconnect_due_at = Some(now + delay);
        self.reconnect_attempt = self.reconnect_attempt.saturating_add(1);
    }

    fn is_reconnect_due(&self) -> bool {
        self.reconnect_due_at
            .is_none_or(|due_at| Instant::now() >= due_at)
    }

    fn reset_reconnect_state(&mut self) {
        self.reconnect_attempt = 0;
        self.reconnect_due_at = None;
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
        self.reset_reconnect_state();
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
                let avatar_url = normalize_avatar_url(entry.account.avatar_url.as_deref());

                Ok(KickAuthState::Authenticated {
                    account_id: entry.account.id,
                    platform_user_id: entry.account.platform_user_id,
                    username: entry.account.username,
                    display_name: entry.account.display_name,
                    avatar_url,
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

    fn normalize_message(&mut self, message: KickChatMessage) -> NormalizedChatMessage {
        let (text, emotes) = parse_kick_emotes(&message.content);
        let avatar_url = self.resolve_message_avatar(&message.sender);
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
                display_name: if !message.sender.username.trim().is_empty() {
                    message.sender.username.clone()
                } else if !message.sender.slug.trim().is_empty() {
                    message.sender.slug.clone()
                } else {
                    message.sender.id.to_string()
                },
                color: message.sender.identity.color,
                avatar_url,
                badges: message
                    .sender
                    .identity
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

    fn normalize_ban_event(&self, event: KickUserBannedEvent) -> NormalizedChatMessage {
        let text = if event.permanent {
            format!("[Kick] {} was permanently banned", event.user.username)
        } else {
            let duration = event
                .duration
                .map(crate::ui::components::format_duration)
                .unwrap_or_else(|| "?".into());
            format!("[Kick] {} was banned for {}", event.user.username, duration)
        };
        let channel_id = if let Some(chatroom_id) = event.chatroom_id {
            chatroom_id.to_string()
        } else {
            self.chatroom
                .as_ref()
                .map(|c| c.broadcaster_user_id.to_string())
                .unwrap_or_default()
        };
        let user_id = event.user_id.unwrap_or(event.user.id);
        let timestamp = event
            .created_at
            .clone()
            .or(event.expires_at)
            .unwrap_or_else(current_unix_timestamp_string);
        NormalizedChatMessage {
            id: format!("kick:ban:{}:{}", user_id, timestamp),
            platform: Platform::Kick,
            channel_id,
            author: ChatAuthor {
                id: event.user.id.to_string(),
                username: Some(event.user.username.clone()),
                display_name: event.user.username.clone(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text,
            emotes: Vec::new(),
            timestamp,
            message_type: ChatMessageType::System,
            reply: None,
        }
    }

    fn normalize_unban_event(&self, event: KickUserUnbannedEvent) -> NormalizedChatMessage {
        let text = format!("[Kick] {} was unbanned", event.user.username);
        let channel_id = if let Some(chatroom_id) = event.chatroom_id {
            chatroom_id.to_string()
        } else {
            self.chatroom
                .as_ref()
                .map(|c| c.broadcaster_user_id.to_string())
                .unwrap_or_default()
        };
        let user_id = event.user_id.unwrap_or(event.user.id);
        let timestamp = event.created_at.clone().unwrap_or_else(current_unix_timestamp_string);
        NormalizedChatMessage {
            id: format!("kick:unban:{}:{}", user_id, timestamp),
            platform: Platform::Kick,
            channel_id,
            author: ChatAuthor {
                id: event.user.id.to_string(),
                username: Some(event.user.username.clone()),
                display_name: event.user.username.clone(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text,
            emotes: Vec::new(),
            timestamp,
            message_type: ChatMessageType::System,
            reply: None,
        }
    }

    fn resolve_message_avatar(&mut self, sender: &KickMessageSender) -> Option<String> {
        let cache_key = kick_avatar_cache_key(sender.id);
        if let Some(avatar_url) = normalize_avatar_url(sender.profile_picture.as_deref()) {
            self.avatar_cache.insert(cache_key, avatar_url.clone());
            return Some(avatar_url);
        }

        if let Some(avatar_url) = self.avatar_cache.get(&cache_key) {
            return Some(avatar_url.clone());
        }

        let (lookup_source, slug_or_username) = avatar_lookup_parts(sender)?;

        let request = KickAvatarLookupRequest {
            author_id: sender.id.to_string(),
            lookup_source,
            slug_or_username,
        };

        match self.client.resolve_avatar_url(request) {
            Ok(Some(avatar_url)) => {
                let avatar_url = normalize_avatar_url(Some(&avatar_url));
                if let Some(avatar_url) = avatar_url {
                    self.avatar_cache.insert(cache_key, avatar_url.clone());
                    Some(avatar_url)
                } else {
                    None
                }
            }
            Ok(None) => None,
            Err(error) => {
                eprintln!(
                    "[kick/live] avatar lookup failed for author_id={}: {}",
                    sender.id, error
                );
                None
            }
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
        self.reset_reconnect_state();
        self.reconnect_due_at = Some(Instant::now());
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
                self.schedule_reconnect(false);
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
        self.reset_reconnect_state();
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
    let badge_type = badge.badge_type;
    let image_url = kick_badge_embedded_url(&badge_type);

    Badge {
        id: badge_type.clone(),
        badge_type,
        text: badge.text,
        image_url,
    }
}

fn normalize_reply(
    message_type: KickChatMessageKind,
    metadata: Option<KickReplyMetadata>,
) -> Option<ChatReply> {
    if message_type != KickChatMessageKind::Reply {
        return None;
    }
    let metadata = metadata?;
    let original_sender = metadata.original_sender?;
    let original_message = metadata.original_message?;

    Some(ChatReply {
        parent_message_id: original_message.id,
        parent_message_text: original_message.content,
        parent_author: ReplyAuthor {
            id: original_sender.id,
            username: original_sender.username.clone(),
            display_name: original_sender.username,
        },
    })
}

fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        String(String),
        Number(u64),
    }

    match StringOrNumber::deserialize(deserializer)? {
        StringOrNumber::String(value) => Ok(value),
        StringOrNumber::Number(value) => Ok(value.to_string()),
    }
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

fn avatar_lookup_parts(sender: &KickMessageSender) -> Option<(KickAvatarLookupSource, String)> {
    if let Some(slug) = normalize_non_empty_string(Some(&sender.slug)) {
        return Some((KickAvatarLookupSource::Slug, slug));
    }

    normalize_non_empty_string(Some(&sender.username))
        .map(|username| (KickAvatarLookupSource::Username, username))
}

fn normalize_avatar_url(value: Option<&str>) -> Option<String> {
    normalize_non_empty_string(value)
}

fn normalize_non_empty_string(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.into())
    }
}

fn kick_avatar_cache_key(author_id: u64) -> String {
    format!("kick:{author_id}")
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

fn reconnect_delay_for_attempt(attempt: u32) -> Duration {
    let max_steps = 5;
    let shift = attempt.min(max_steps);
    let multiplier = 1u32 << shift;
    let seconds = KICK_RECONNECT_MIN_DELAY
        .as_secs()
        .saturating_mul(u64::from(multiplier));
    Duration::from_secs(seconds).min(KICK_RECONNECT_MAX_DELAY)
}

#[cfg(test)]
mod tests {
    use super::{KickChatMessage, KickChatMessageKind, normalize_reply};

    #[test]
    fn kick_reply_payload_accepts_numeric_original_sender_id() {
        let raw = r#"{
            "id": "msg-1",
            "chatroom_id": 3124040,
            "content": "reply body",
            "type": "reply",
            "created_at": "2026-05-19T20:38:27+00:00",
            "sender": {
                "id": 1,
                "username": "sender",
                "slug": "sender",
                "identity": { "color": null, "badges": [] },
                "profile_picture": null
            },
            "metadata": {
                "original_sender": {
                    "id": 103024073,
                    "username": "j0yc"
                },
                "original_message": {
                    "id": "parent-1",
                    "content": "parent text"
                }
            }
        }"#;

        let message: KickChatMessage =
            serde_json::from_str(raw).expect("reply payload should parse");
        assert_eq!(
            message
                .metadata
                .as_ref()
                .unwrap()
                .original_sender
                .as_ref()
                .unwrap()
                .id,
            "103024073"
        );

        let reply = normalize_reply(KickChatMessageKind::Reply, message.metadata)
            .expect("reply metadata should normalize");
        assert_eq!(reply.parent_author.id, "103024073");
        assert_eq!(reply.parent_message_id, "parent-1");
    }
}
