use crate::auth::{AuthError, AuthProvider, AuthResult};
use crate::platforms::{
    PlatformAdapter, PlatformError, PlatformEvent, PlatformEventSink, PlatformResult,
};
use crate::protocol::types::{
    Badge, ChatAuthor, ChatMessageType, ChatReply, Emote, EmotePosition, EventUser,
    NormalizedChatMessage, NormalizedEvent, NormalizedEventType, Platform, PlatformStatus,
    PlatformStatusInfo, PlatformStatusMode, ReplyAuthor, StreamStatus,
};
use crate::runtime::TWITCH_REDIRECT_URI;
use crate::storage::{Storage, TokenState};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

const TWITCH_TOKEN_REFRESH_WINDOW_SECONDS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TwitchAuthState {
    Anonymous,
    Authenticated {
        account_id: String,
        platform_user_id: String,
        login: String,
        display_name: String,
        avatar_url: Option<String>,
        access_token: String,
    },
    ReauthRequired {
        account_id: String,
        reason: String,
    },
}

impl TwitchAuthState {
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
pub struct TwitchEmoteSpan {
    pub id: String,
    pub name: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TwitchChatMessage {
    pub id: String,
    pub channel: String,
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub color: Option<String>,
    pub text: String,
    pub timestamp: String,
    pub badges: Vec<(String, String)>,
    pub emotes: Vec<TwitchEmoteSpan>,
    pub is_action: bool,
    pub reply: Option<ChatReply>,
    pub bits: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TwitchChatEvent {
    Sub {
        id: String,
        channel_id: String,
        user_id: String,
        display_name: String,
        months: u64,
        system_message: Option<String>,
    },
    Resub {
        id: String,
        channel_id: String,
        user_id: String,
        display_name: String,
        months: u64,
        system_message: Option<String>,
    },
    GiftSub {
        id: String,
        channel_id: String,
        user_id: String,
        display_name: String,
        recipient_display_name: String,
        months: u64,
        system_message: Option<String>,
    },
    Raid {
        id: String,
        channel_id: String,
        user_id: String,
        display_name: String,
        viewer_count: u64,
        system_message: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TwitchCategory {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamUpdate {
    pub channel_id: String,
    pub title: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamUpdateOutcome {
    pub channel_id: String,
    pub updated_title: Option<String>,
    pub updated_category_id: Option<String>,
}

pub trait TwitchChatClient {
    fn connect(&mut self, channel: &str, auth: &TwitchAuthState) -> PlatformResult<()>;
    fn disconnect(&mut self) -> PlatformResult<()>;
    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<String>;
    fn fetch_badges(&mut self, channel: &str) -> PlatformResult<BTreeMap<String, String>>;
    fn drain_messages(&mut self) -> PlatformResult<Vec<TwitchChatMessage>>;
    fn drain_events(&mut self) -> PlatformResult<Vec<TwitchChatEvent>>;
    fn search_categories(&mut self, query: &str) -> PlatformResult<Vec<TwitchCategory>>;
    fn update_stream(&mut self, update: &StreamUpdate) -> PlatformResult<StreamUpdateOutcome>;
    fn stream_status(&mut self, channel_id: &str) -> PlatformResult<StreamStatus>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TwitchAuthProvider;

impl AuthProvider for TwitchAuthProvider {
    fn platform(&self) -> Platform {
        Platform::Twitch
    }

    fn display_name(&self) -> &'static str {
        "Twitch"
    }

    fn redirect_uri(&self) -> &str {
        TWITCH_REDIRECT_URI
    }

    fn build_authorization_url(&self, code_challenge: &str, state: &str) -> AuthResult<String> {
        Ok(format!(
            "https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=twirchat-desktop&redirect_uri={}&scope=chat%3Aread+chat%3Aedit&code_challenge={code_challenge}&code_challenge_method=S256&state={state}",
            self.redirect_uri()
        ))
    }

    fn exchange_callback(
        &self,
        _code: &str,
        _code_verifier: &str,
    ) -> AuthResult<crate::auth::AuthenticatedAccount> {
        Err(AuthError::Provider {
            platform: Platform::Twitch,
            message: "native Twitch adapter does not perform network OAuth exchange".into(),
        })
    }
}

pub struct TwitchAdapter<'a, C> {
    storage: &'a Storage,
    client: C,
    auth_provider: TwitchAuthProvider,
    channel_name: Option<String>,
    is_connected: bool,
    auth_state: TwitchAuthState,
    badge_cache: BTreeMap<String, String>,
}

impl<'a, C> TwitchAdapter<'a, C> {
    pub fn new(storage: &'a Storage, client: C) -> Self {
        Self {
            storage,
            client,
            auth_provider: TwitchAuthProvider,
            channel_name: None,
            is_connected: false,
            auth_state: TwitchAuthState::Anonymous,
            badge_cache: BTreeMap::new(),
        }
    }

    pub fn auth_state(&self) -> &TwitchAuthState {
        &self.auth_state
    }

    pub fn badge_cache(&self) -> &BTreeMap<String, String> {
        &self.badge_cache
    }

    pub fn client(&self) -> &C {
        &self.client
    }

    pub fn client_mut(&mut self) -> &mut C {
        &mut self.client
    }
}

impl<C: TwitchChatClient> TwitchAdapter<'_, C> {
    pub fn refresh_badges(&mut self) -> PlatformResult<()> {
        let channel = self.channel_name.clone().unwrap_or_default();
        self.badge_cache = self.client.fetch_badges(&channel)?;
        Ok(())
    }

    pub fn poll(&mut self, sink: &mut dyn PlatformEventSink) -> PlatformResult<()> {
        for message in self.client.drain_messages()? {
            if let Some(bits) = message.bits {
                sink.emit(PlatformEvent::Event(normalize_bits_event(&message, bits)))?;
            }
            sink.emit(PlatformEvent::Message(self.normalize_message(message)))?;
        }

        for event in self.client.drain_events()? {
            sink.emit(PlatformEvent::Event(normalize_event(event)))?;
        }

        Ok(())
    }

    pub fn search_categories(&mut self, query: &str) -> PlatformResult<Vec<TwitchCategory>> {
        self.require_authenticated("search Twitch categories")?;
        self.client.search_categories(query)
    }

    pub fn update_stream(&mut self, update: &StreamUpdate) -> PlatformResult<StreamUpdateOutcome> {
        self.require_authenticated("update Twitch stream metadata")?;
        self.client.update_stream(update)
    }

    pub fn stream_status(&mut self, channel_id: &str) -> PlatformResult<StreamStatus> {
        self.client.stream_status(channel_id)
    }

    fn resolve_auth_state(&self) -> PlatformResult<TwitchAuthState> {
        let accounts = self
            .storage
            .accounts()
            .find_all_with_token_state()
            .map_err(storage_error)?;
        let Some(entry) = accounts
            .into_iter()
            .find(|entry| entry.account.platform == Platform::Twitch)
        else {
            return Ok(TwitchAuthState::Anonymous);
        };

        match entry.token_state {
            TokenState::Valid(tokens) => {
                if token_requires_reauth(tokens.expires_at) {
                    return Ok(TwitchAuthState::ReauthRequired {
                        account_id: entry.account.id,
                        reason: "access token expired or expires within refresh window".into(),
                    });
                }

                Ok(TwitchAuthState::Authenticated {
                    account_id: entry.account.id,
                    platform_user_id: entry.account.platform_user_id,
                    login: entry.account.username,
                    display_name: entry.account.display_name,
                    avatar_url: entry.account.avatar_url,
                    access_token: tokens.access_token,
                })
            }
            TokenState::ReauthRequired { reason } => Ok(TwitchAuthState::ReauthRequired {
                account_id: entry.account.id,
                reason,
            }),
        }
    }

    fn require_authenticated(&self, action: &str) -> PlatformResult<()> {
        match &self.auth_state {
            TwitchAuthState::Authenticated { .. } => Ok(()),
            TwitchAuthState::ReauthRequired { reason, .. } => Err(PlatformError::new(
                Platform::Twitch,
                format!("Cannot {action}; Twitch account requires reauth: {reason}"),
            )),
            TwitchAuthState::Anonymous => Err(PlatformError::new(
                Platform::Twitch,
                format!("Cannot {action} in anonymous Twitch mode"),
            )),
        }
    }

    fn normalize_message(&self, message: TwitchChatMessage) -> NormalizedChatMessage {
        let channel_id = normalize_channel(&message.channel);
        let badges = message
            .badges
            .into_iter()
            .map(|(badge_id, version)| {
                let cache_key = format!("{badge_id}/{version}");
                Badge {
                    id: cache_key.clone(),
                    badge_type: badge_id.clone(),
                    text: badge_id,
                    image_url: self.badge_cache.get(&cache_key).cloned(),
                }
            })
            .collect();
        let emotes = message
            .emotes
            .into_iter()
            .map(|emote| Emote {
                id: emote.id.clone(),
                name: emote.name,
                image_url: twitch_emote_url(&emote.id),
                positions: vec![EmotePosition {
                    start: emote.start,
                    end: emote.end,
                }],
                aspect_ratio: None,
            })
            .collect();

        NormalizedChatMessage {
            id: message.id,
            platform: Platform::Twitch,
            channel_id,
            author: ChatAuthor {
                id: message.user_id,
                username: Some(message.username),
                display_name: message.display_name,
                color: message.color,
                avatar_url: None,
                badges,
            },
            text: message.text,
            emotes,
            timestamp: message.timestamp,
            message_type: if message.is_action {
                ChatMessageType::Action
            } else {
                ChatMessageType::Message
            },
            reply: message.reply,
        }
    }

    fn emit_status(
        &self,
        sink: &mut dyn PlatformEventSink,
        status: PlatformStatus,
        error: Option<String>,
    ) -> PlatformResult<()> {
        sink.emit(PlatformEvent::Status(PlatformStatusInfo {
            platform: Platform::Twitch,
            status,
            error,
            mode: self.auth_state.mode(),
            channel_login: self.channel_name.clone(),
        }))
    }

    fn emit_local_sent_message(
        &self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
        local_id: String,
    ) -> PlatformResult<Option<NormalizedChatMessage>> {
        let TwitchAuthState::Authenticated {
            account_id,
            platform_user_id,
            login,
            display_name,
            avatar_url,
            ..
        } = &self.auth_state
        else {
            return Ok(None);
        };

        let normalized_channel = normalize_channel(channel_id);
        let reply = match reply_to_message_id {
            Some(message_id) => self.find_reply_context(&normalized_channel, message_id)?,
            None => None,
        };

        Ok(Some(NormalizedChatMessage {
            id: format!("local:twitch:{normalized_channel}:{local_id}"),
            platform: Platform::Twitch,
            channel_id: normalized_channel,
            author: ChatAuthor {
                id: if platform_user_id.is_empty() {
                    account_id.clone()
                } else {
                    platform_user_id.clone()
                },
                username: Some(login.clone()),
                display_name: display_name.clone(),
                color: None,
                avatar_url: avatar_url.clone(),
                badges: Vec::new(),
            },
            text: text.to_string(),
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
                message.platform == Platform::Twitch
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

impl<C: TwitchChatClient> PlatformAdapter for TwitchAdapter<'_, C> {
    type Auth = TwitchAuthProvider;

    fn platform(&self) -> Platform {
        Platform::Twitch
    }

    fn auth_provider(&self) -> &Self::Auth {
        &self.auth_provider
    }

    fn connect(
        &mut self,
        channel_slug: &str,
        sink: &mut dyn PlatformEventSink,
    ) -> PlatformResult<()> {
        self.channel_name = Some(normalize_channel(channel_slug));
        self.is_connected = false;
        self.auth_state = self.resolve_auth_state()?;
        self.emit_status(
            sink,
            PlatformStatus::Connecting,
            reauth_reason(&self.auth_state),
        )?;

        self.refresh_badges()?;
        self.client
            .connect(channel_slug, &self.auth_state)
            .map_err(|error| PlatformError::new(Platform::Twitch, error.message))?;
        self.is_connected = true;
        self.emit_status(
            sink,
            PlatformStatus::Connected,
            reauth_reason(&self.auth_state),
        )
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        self.client.disconnect()?;
        self.is_connected = false;
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<()> {
        self.require_authenticated("send Twitch messages")?;
        if !self.is_connected {
            return Err(PlatformError::new(
                Platform::Twitch,
                "Twitch chat not connected",
            ));
        }

        let local_id = self
            .client
            .send_message(channel_id, text, reply_to_message_id)?;
        if let Some(message) =
            self.emit_local_sent_message(channel_id, text, reply_to_message_id, local_id)?
        {
            self.storage
                .messages()
                .save(&message)
                .map_err(storage_error)?;
        }
        Ok(())
    }
}

fn normalize_event(event: TwitchChatEvent) -> NormalizedEvent {
    match event {
        TwitchChatEvent::Sub {
            id,
            channel_id,
            user_id,
            display_name,
            months,
            system_message,
        } => subscription_event(SubscriptionEventData {
            id,
            event_type: NormalizedEventType::Sub,
            channel_id,
            user_id,
            display_name,
            months,
            system_message,
            recipient_display_name: None,
        }),
        TwitchChatEvent::Resub {
            id,
            channel_id,
            user_id,
            display_name,
            months,
            system_message,
        } => subscription_event(SubscriptionEventData {
            id,
            event_type: NormalizedEventType::Resub,
            channel_id,
            user_id,
            display_name,
            months,
            system_message,
            recipient_display_name: None,
        }),
        TwitchChatEvent::GiftSub {
            id,
            channel_id,
            user_id,
            display_name,
            recipient_display_name,
            months,
            system_message,
        } => subscription_event(SubscriptionEventData {
            id,
            event_type: NormalizedEventType::GiftSub,
            channel_id,
            user_id,
            display_name,
            months,
            system_message,
            recipient_display_name: Some(recipient_display_name),
        }),
        TwitchChatEvent::Raid {
            id,
            channel_id,
            user_id,
            display_name,
            viewer_count,
            system_message,
        } => {
            let mut data = Map::new();
            data.insert("channelId".into(), Value::String(channel_id));
            data.insert("viewerCount".into(), Value::from(viewer_count));
            if let Some(system_message) = system_message {
                data.insert("systemMsg".into(), Value::String(system_message));
            }
            NormalizedEvent {
                id,
                platform: Platform::Twitch,
                event_type: NormalizedEventType::Raid,
                user: EventUser {
                    id: user_id,
                    display_name,
                    avatar_url: None,
                },
                data,
                timestamp: current_unix_timestamp_string(),
            }
        }
    }
}

struct SubscriptionEventData {
    id: String,
    event_type: NormalizedEventType,
    channel_id: String,
    user_id: String,
    display_name: String,
    months: u64,
    system_message: Option<String>,
    recipient_display_name: Option<String>,
}

fn subscription_event(input: SubscriptionEventData) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert("channelId".into(), Value::String(input.channel_id));
    data.insert("months".into(), Value::from(input.months));
    if let Some(system_message) = input.system_message {
        data.insert("systemMsg".into(), Value::String(system_message));
    }
    if let Some(recipient_display_name) = input.recipient_display_name {
        data.insert(
            "recipientDisplayName".into(),
            Value::String(recipient_display_name),
        );
    }
    NormalizedEvent {
        id: input.id,
        platform: Platform::Twitch,
        event_type: input.event_type,
        user: EventUser {
            id: input.user_id,
            display_name: input.display_name,
            avatar_url: None,
        },
        data,
        timestamp: current_unix_timestamp_string(),
    }
}

fn normalize_bits_event(message: &TwitchChatMessage, bits: u64) -> NormalizedEvent {
    let mut data = Map::new();
    data.insert(
        "channelId".into(),
        Value::String(normalize_channel(&message.channel)),
    );
    data.insert("message".into(), Value::String(message.text.clone()));
    data.insert("bits".into(), Value::from(bits));

    NormalizedEvent {
        id: format!("twitch:bits:{}:{}", message.user_id, message.id),
        platform: Platform::Twitch,
        event_type: NormalizedEventType::Bits,
        user: EventUser {
            id: message.user_id.clone(),
            display_name: message.display_name.clone(),
            avatar_url: None,
        },
        data,
        timestamp: message.timestamp.clone(),
    }
}

fn token_requires_reauth(expires_at: Option<u64>) -> bool {
    expires_at.is_some_and(|expires_at| {
        expires_at <= current_unix_timestamp().saturating_add(TWITCH_TOKEN_REFRESH_WINDOW_SECONDS)
    })
}

fn reauth_reason(auth_state: &TwitchAuthState) -> Option<String> {
    match auth_state {
        TwitchAuthState::ReauthRequired { reason, .. } => Some(reason.clone()),
        TwitchAuthState::Anonymous | TwitchAuthState::Authenticated { .. } => None,
    }
}

fn normalize_channel(channel: &str) -> String {
    channel.trim_start_matches('#').to_lowercase()
}

fn twitch_emote_url(id: &str) -> String {
    format!("https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/1.0")
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
    PlatformError::new(Platform::Twitch, error.to_string())
}
