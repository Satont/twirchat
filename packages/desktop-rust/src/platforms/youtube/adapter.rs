use crate::auth::{AuthError, AuthProvider, AuthResult};
use crate::platforms::youtube::transport::{
    YouTubeAccountHint, YouTubeAuthor, YouTubeBadge, YouTubeChannelResolutionRequest,
    YouTubeMembership, YouTubeResolvedChannel, YouTubeSendMessageRequest, YouTubeStreamItem,
    YouTubeStreamSignal, YouTubeStreamState, YouTubeStreamSubscription, YouTubeStreamingTransport,
    YouTubeSuperChat, YouTubeTextMessage, YouTubeTransportAuth, YouTubeTransportKind,
};
use crate::platforms::{
    PlatformAdapter, PlatformError, PlatformEvent, PlatformEventSink, PlatformResult,
};
use crate::protocol::types::{
    Badge, ChatAuthor, ChatMessageType, ChatReply, EventUser, NormalizedChatMessage,
    NormalizedEvent, NormalizedEventType, Platform, PlatformStatus, PlatformStatusInfo,
    PlatformStatusMode, ReplyAuthor,
};
use crate::runtime::YOUTUBE_REDIRECT_URI;
use crate::storage::{Storage, TokenState};
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const YOUTUBE_TOKEN_REFRESH_WINDOW_SECONDS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YouTubeAuthState {
    Anonymous,
    Authenticated {
        account_id: String,
        platform_user_id: String,
        username: String,
        display_name: String,
        avatar_url: Option<String>,
        access_token: String,
    },
    ReauthRequired {
        account_id: String,
        reason: String,
    },
}

impl YouTubeAuthState {
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

#[derive(Debug, Clone, Copy, Default)]
pub struct YouTubeAuthProvider;

impl AuthProvider for YouTubeAuthProvider {
    fn platform(&self) -> Platform {
        Platform::Youtube
    }

    fn display_name(&self) -> &'static str {
        "YouTube"
    }

    fn redirect_uri(&self) -> &str {
        YOUTUBE_REDIRECT_URI
    }

    fn build_authorization_url(&self, code_challenge: &str, state: &str) -> AuthResult<String> {
        Ok(format!(
            "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=twirchat-desktop&redirect_uri={}&scope=openid%20profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.force-ssl&code_challenge={code_challenge}&code_challenge_method=S256&state={state}",
            self.redirect_uri()
        ))
    }

    fn exchange_callback(
        &self,
        _code: &str,
        _code_verifier: &str,
    ) -> AuthResult<crate::auth::AuthenticatedAccount> {
        Err(AuthError::Provider {
            platform: Platform::Youtube,
            message: "native YouTube adapter does not perform network OAuth exchange".into(),
        })
    }
}

pub struct YouTubeAdapter<'a, T> {
    storage: &'a Storage,
    transport: T,
    auth_provider: YouTubeAuthProvider,
    channel_slug: Option<String>,
    resolved_channel: Option<YouTubeResolvedChannel>,
    active_stream: Option<YouTubeStreamState>,
    is_connected: bool,
    should_reconnect: bool,
    reconnect_attempts: u32,
    auth_state: YouTubeAuthState,
}

impl<'a, T> YouTubeAdapter<'a, T> {
    pub fn new(storage: &'a Storage, transport: T) -> Self {
        Self {
            storage,
            transport,
            auth_provider: YouTubeAuthProvider,
            channel_slug: None,
            resolved_channel: None,
            active_stream: None,
            is_connected: false,
            should_reconnect: true,
            reconnect_attempts: 0,
            auth_state: YouTubeAuthState::Anonymous,
        }
    }

    pub fn auth_state(&self) -> &YouTubeAuthState {
        &self.auth_state
    }

    pub fn resolved_channel(&self) -> Option<&YouTubeResolvedChannel> {
        self.resolved_channel.as_ref()
    }

    pub fn active_stream(&self) -> Option<&YouTubeStreamState> {
        self.active_stream.as_ref()
    }

    pub fn reconnect_attempts(&self) -> u32 {
        self.reconnect_attempts
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    pub fn transport_mut(&mut self) -> &mut T {
        &mut self.transport
    }
}

impl<T: YouTubeStreamingTransport> YouTubeAdapter<'_, T> {
    pub fn transport_kind(&self) -> YouTubeTransportKind {
        self.transport.transport_kind()
    }

    pub fn process_server_signals(
        &mut self,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        while let Some(signal) = self.transport.receive_pushed_signal()? {
            self.handle_stream_signal(signal, sink)?;
        }
        Ok(())
    }

    pub fn disconnect_with_status(
        &mut self,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        self.disconnect()?;
        self.emit_status(sink, PlatformStatus::Disconnected, None)
    }

    fn connect_once(&mut self) -> PlatformResult<()> {
        let channel_slug = self.channel_slug.clone().ok_or_else(|| {
            PlatformError::new(Platform::Youtube, "YouTube channel slug was not set")
        })?;
        let request = YouTubeChannelResolutionRequest {
            input: channel_slug,
            account_hint: self.account_hint(),
        };
        let resolved_channel = self.transport.resolve_channel(request)?;
        let subscription = YouTubeStreamSubscription {
            channel_id: resolved_channel.channel_id.clone(),
            live_chat_id: resolved_channel.live_chat_id.clone(),
            video_id: resolved_channel.video_id.clone(),
        };
        let stream = self
            .transport
            .subscribe(subscription, &self.transport_auth())?;

        self.resolved_channel = Some(resolved_channel);
        self.active_stream = Some(stream);
        self.is_connected = true;
        Ok(())
    }

    fn handle_stream_signal(
        &mut self,
        signal: YouTubeStreamSignal,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        match signal {
            YouTubeStreamSignal::Item(item) => self.emit_stream_item(*item, sink),
            YouTubeStreamSignal::StreamEnded { reason } => {
                let message = reason.unwrap_or_else(|| "YouTube live chat stream ended".into());
                self.reconnect_stream(sink, &message)
            }
            YouTubeStreamSignal::StreamError { message } => {
                self.is_connected = false;
                self.emit_status(sink, PlatformStatus::Error, Some(message.clone()))?;
                self.reconnect_stream(sink, &message)
            }
        }
    }

    fn emit_stream_item(
        &self,
        item: YouTubeStreamItem,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        match item {
            YouTubeStreamItem::Text(message) => {
                sink.emit(PlatformEvent::Message(self.normalize_text_message(message)))
            }
            YouTubeStreamItem::SuperChat(event) => {
                sink.emit(PlatformEvent::Event(normalize_super_chat(event)))
            }
            YouTubeStreamItem::Membership(event) => {
                sink.emit(PlatformEvent::Event(normalize_membership(event)))
            }
        }
    }

    fn reconnect_stream(
        &mut self,
        sink: &mut dyn PlatformEventSink,
        reason: &str,
    ) -> PlatformResult<()> {
        if !self.should_reconnect {
            self.active_stream = None;
            self.is_connected = false;
            return Ok(());
        }

        self.transport.close_stream()?;
        self.active_stream = None;
        self.is_connected = false;
        self.reconnect_attempts = self.reconnect_attempts.saturating_add(1);
        self.emit_status(sink, PlatformStatus::Connecting, Some(reason.into()))?;

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

    fn resolve_auth_state(&self) -> PlatformResult<YouTubeAuthState> {
        let accounts = self
            .storage
            .accounts()
            .find_all_with_token_state()
            .map_err(storage_error)?;
        let Some(entry) = accounts
            .into_iter()
            .find(|entry| entry.account.platform == Platform::Youtube)
        else {
            return Ok(YouTubeAuthState::Anonymous);
        };

        match entry.token_state {
            TokenState::Valid(tokens) => {
                if token_requires_reauth(tokens.expires_at) {
                    return Ok(YouTubeAuthState::ReauthRequired {
                        account_id: entry.account.id,
                        reason: "access token expired or expires within refresh window".into(),
                    });
                }

                Ok(YouTubeAuthState::Authenticated {
                    account_id: entry.account.id,
                    platform_user_id: entry.account.platform_user_id,
                    username: entry.account.username,
                    display_name: entry.account.display_name,
                    avatar_url: entry.account.avatar_url,
                    access_token: tokens.access_token,
                })
            }
            TokenState::ReauthRequired { reason } => Ok(YouTubeAuthState::ReauthRequired {
                account_id: entry.account.id,
                reason,
            }),
        }
    }

    fn require_authenticated(&self, action: &str) -> PlatformResult<()> {
        match &self.auth_state {
            YouTubeAuthState::Authenticated { .. } => Ok(()),
            YouTubeAuthState::ReauthRequired { reason, .. } => Err(PlatformError::new(
                Platform::Youtube,
                format!("Cannot {action}; YouTube account requires reauth: {reason}"),
            )),
            YouTubeAuthState::Anonymous => Err(PlatformError::new(
                Platform::Youtube,
                format!("Cannot {action} in anonymous YouTube mode"),
            )),
        }
    }

    fn normalize_text_message(&self, message: YouTubeTextMessage) -> NormalizedChatMessage {
        let channel_id = if message.channel_id.is_empty() {
            self.current_channel_id()
        } else {
            message.channel_id
        };

        NormalizedChatMessage {
            id: message.id,
            platform: Platform::Youtube,
            channel_id,
            author: ChatAuthor {
                id: message.author.channel_id.clone(),
                username: message.author.username.clone(),
                display_name: message.author.display_name.clone(),
                color: None,
                avatar_url: message.author.avatar_url.clone(),
                badges: youtube_badges(&message.author, message.badges),
            },
            text: message.text,
            emotes: Vec::new(),
            timestamp: non_empty_timestamp(message.timestamp),
            message_type: ChatMessageType::Message,
            reply: None,
        }
    }

    fn emit_status(
        &self,
        sink: &mut dyn PlatformEventSink,
        status: PlatformStatus,
        error: Option<String>,
    ) -> PlatformResult<()> {
        sink.emit(PlatformEvent::Status(PlatformStatusInfo {
            platform: Platform::Youtube,
            status,
            error,
            mode: self.auth_state.mode(),
            channel_login: self.channel_slug.clone(),
        }))
    }

    fn current_channel_id(&self) -> String {
        self.resolved_channel
            .as_ref()
            .map(|channel| channel.channel_id.clone())
            .unwrap_or_default()
    }

    fn current_live_chat_id(&self) -> Option<String> {
        self.resolved_channel
            .as_ref()
            .map(|channel| channel.live_chat_id.clone())
    }

    fn account_hint(&self) -> Option<YouTubeAccountHint> {
        match &self.auth_state {
            YouTubeAuthState::Authenticated {
                account_id,
                platform_user_id,
                username,
                display_name,
                ..
            } => Some(YouTubeAccountHint {
                account_id: account_id.clone(),
                platform_user_id: platform_user_id.clone(),
                username: username.clone(),
                display_name: display_name.clone(),
            }),
            YouTubeAuthState::Anonymous | YouTubeAuthState::ReauthRequired { .. } => None,
        }
    }

    fn transport_auth(&self) -> YouTubeTransportAuth {
        match &self.auth_state {
            YouTubeAuthState::Anonymous => YouTubeTransportAuth::Anonymous,
            YouTubeAuthState::Authenticated {
                account_id,
                platform_user_id,
                username,
                display_name,
                access_token,
                ..
            } => YouTubeTransportAuth::Authenticated {
                account_id: account_id.clone(),
                platform_user_id: platform_user_id.clone(),
                username: username.clone(),
                display_name: display_name.clone(),
                access_token: access_token.clone(),
            },
            YouTubeAuthState::ReauthRequired { account_id, reason } => {
                YouTubeTransportAuth::ReauthRequired {
                    account_id: account_id.clone(),
                    reason: reason.clone(),
                }
            }
        }
    }

    fn emit_local_sent_message(
        &self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
        local_id: String,
    ) -> PlatformResult<Option<NormalizedChatMessage>> {
        let YouTubeAuthState::Authenticated {
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
            id: format!("local:youtube:{channel_id}:{local_id}"),
            platform: Platform::Youtube,
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
                message.platform == Platform::Youtube
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

impl<T: YouTubeStreamingTransport> PlatformAdapter for YouTubeAdapter<'_, T> {
    type Auth = YouTubeAuthProvider;

    fn platform(&self) -> Platform {
        Platform::Youtube
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
        self.resolved_channel = None;
        self.active_stream = None;
        self.is_connected = false;
        self.should_reconnect = true;
        self.reconnect_attempts = 0;
        self.auth_state = self.resolve_auth_state()?;

        self.storage
            .channels()
            .save(Platform::Youtube, &normalized_slug)
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
        self.transport.close_stream()?;
        self.active_stream = None;
        self.is_connected = false;
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        self.require_authenticated("send YouTube messages")?;
        if !self.is_connected {
            return Err(PlatformError::new(
                Platform::Youtube,
                "YouTube chat not connected",
            ));
        }

        let live_chat_id = self.current_live_chat_id().ok_or_else(|| {
            PlatformError::new(Platform::Youtube, "YouTube live chat id was not resolved")
        })?;
        let normalized_channel_id = if channel_id.is_empty() {
            self.current_channel_id()
        } else {
            channel_id.into()
        };
        let request = YouTubeSendMessageRequest {
            channel_id: normalized_channel_id.clone(),
            live_chat_id,
            text: text.into(),
            reply_to_message_id: reply_to_message_id.map(str::to_string),
        };
        let local_id = self
            .transport
            .send_message(request, &self.transport_auth())?;
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

fn normalize_super_chat(event: YouTubeSuperChat) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert("channelId".into(), Value::String(event.channel_id));
    data.insert("liveChatId".into(), Value::String(event.live_chat_id));
    data.insert("amountMicros".into(), Value::from(event.amount_micros));
    data.insert(
        "amount".into(),
        Value::String(event.amount_display_string.clone()),
    );
    data.insert("currency".into(), Value::String(event.currency));
    data.insert("sticker".into(), Value::Bool(event.is_sticker));
    if let Some(comment) = event.comment {
        data.insert("comment".into(), Value::String(comment));
    }

    NormalizedEvent {
        id: event.id,
        platform: Platform::Youtube,
        event_type: NormalizedEventType::Superchat,
        user: event_user(event.author),
        data,
        timestamp: non_empty_timestamp(event.timestamp),
    }
}

fn normalize_membership(event: YouTubeMembership) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert("channelId".into(), Value::String(event.channel_id));
    data.insert("liveChatId".into(), Value::String(event.live_chat_id));
    if let Some(level_name) = event.level_name {
        data.insert("levelName".into(), Value::String(level_name));
    }
    if let Some(months) = event.months {
        data.insert("months".into(), Value::from(months));
    }
    if let Some(message) = event.message {
        data.insert("message".into(), Value::String(message));
    }

    NormalizedEvent {
        id: event.id,
        platform: Platform::Youtube,
        event_type: NormalizedEventType::Membership,
        user: event_user(event.author),
        data,
        timestamp: non_empty_timestamp(event.timestamp),
    }
}

fn event_user(author: YouTubeAuthor) -> EventUser {
    EventUser {
        id: author.channel_id,
        display_name: author.display_name,
        avatar_url: author.avatar_url,
    }
}

fn youtube_badges(author: &YouTubeAuthor, mut explicit_badges: Vec<YouTubeBadge>) -> Vec<Badge> {
    if author.is_chat_owner {
        explicit_badges.push(YouTubeBadge {
            id: "owner".into(),
            badge_type: "broadcaster".into(),
            text: "Owner".into(),
            image_url: None,
        });
    }
    if author.is_chat_moderator {
        explicit_badges.push(YouTubeBadge {
            id: "mod".into(),
            badge_type: "moderator".into(),
            text: "Moderator".into(),
            image_url: None,
        });
    }
    if author.is_verified {
        explicit_badges.push(YouTubeBadge {
            id: "verified".into(),
            badge_type: "staff".into(),
            text: "Verified".into(),
            image_url: None,
        });
    }
    if author.is_chat_sponsor {
        explicit_badges.push(YouTubeBadge {
            id: "member".into(),
            badge_type: "subscriber".into(),
            text: "Member".into(),
            image_url: None,
        });
    }

    explicit_badges
        .into_iter()
        .map(|badge| Badge {
            id: badge.id,
            badge_type: badge.badge_type,
            text: badge.text,
            image_url: badge.image_url,
        })
        .collect()
}

fn token_requires_reauth(expires_at: Option<u64>) -> bool {
    expires_at.is_some_and(|expires_at| {
        expires_at <= current_unix_timestamp().saturating_add(YOUTUBE_TOKEN_REFRESH_WINDOW_SECONDS)
    })
}

fn reauth_reason(auth_state: &YouTubeAuthState) -> Option<String> {
    match auth_state {
        YouTubeAuthState::ReauthRequired { reason, .. } => Some(reason.clone()),
        YouTubeAuthState::Anonymous | YouTubeAuthState::Authenticated { .. } => None,
    }
}

fn normalize_channel_slug(channel: &str) -> String {
    channel.trim().to_string()
}

fn non_empty_timestamp(timestamp: String) -> String {
    if timestamp.is_empty() {
        current_unix_timestamp_string()
    } else {
        timestamp
    }
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

fn storage_error(error: crate::storage::StorageError) -> PlatformError {
    PlatformError::new(Platform::Youtube, error.to_string())
}
