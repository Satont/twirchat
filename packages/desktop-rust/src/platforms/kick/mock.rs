use crate::platforms::kick::adapter::{
    KickAuthState, KickAvatarLookupRequest, KickChatClient, KickChatMessage, KickChatroom,
    KickFollowEvent, KickSendMessageRequest, KickStreamStatusRequest, KickSubscriptionEvent,
    KickTransportAuth,
};
use crate::platforms::{PlatformError, PlatformResult};
use crate::protocol::types::{Platform, StreamStatus};
use crate::storage::TokenPair;
use std::collections::{BTreeMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentKickMessage {
    pub broadcaster_user_id: u64,
    pub content: String,
    pub reply_to_message_id: Option<String>,
    pub auth: KickTransportAuth,
}

#[derive(Debug, Clone)]
pub struct MockKickClient {
    pub chatroom_resolutions: Vec<String>,
    pub subscribed_chatrooms: Vec<KickChatroom>,
    pub subscribe_auth: Vec<KickTransportAuth>,
    pub disconnect_count: u32,
    pub sent_messages: Vec<SentKickMessage>,
    pub refresh_calls: Vec<(String, String)>,
    pub stream_status_requests: Vec<KickStreamStatusRequest>,
    pub avatar_resolutions: Vec<KickAvatarLookupRequest>,
    chatrooms: BTreeMap<String, KickChatroom>,
    avatar_urls: BTreeMap<String, String>,
    missing_chatrooms: VecDeque<String>,
    incoming_messages: VecDeque<KickChatMessage>,
    follow_events: VecDeque<KickFollowEvent>,
    subscription_events: VecDeque<KickSubscriptionEvent>,
    refreshed_tokens: VecDeque<TokenPair>,
    next_drain_error: Option<String>,
    next_sent_id: u64,
}

impl MockKickClient {
    pub fn new() -> Self {
        Self {
            chatroom_resolutions: Vec::new(),
            subscribed_chatrooms: Vec::new(),
            subscribe_auth: Vec::new(),
            disconnect_count: 0,
            sent_messages: Vec::new(),
            refresh_calls: Vec::new(),
            stream_status_requests: Vec::new(),
            avatar_resolutions: Vec::new(),
            chatrooms: BTreeMap::new(),
            avatar_urls: BTreeMap::new(),
            missing_chatrooms: VecDeque::new(),
            incoming_messages: VecDeque::new(),
            follow_events: VecDeque::new(),
            subscription_events: VecDeque::new(),
            refreshed_tokens: VecDeque::new(),
            next_drain_error: None,
            next_sent_id: 1,
        }
    }

    pub fn with_chatroom(mut self, slug: &str, chatroom_id: u64, broadcaster_user_id: u64) -> Self {
        self.add_chatroom(slug, chatroom_id, broadcaster_user_id);
        self
    }

    pub fn add_chatroom(&mut self, slug: &str, chatroom_id: u64, broadcaster_user_id: u64) {
        let normalized = normalize_slug(slug);
        self.chatrooms.insert(
            normalized.clone(),
            KickChatroom {
                channel_slug: normalized,
                chatroom_id,
                broadcaster_user_id,
            },
        );
    }

    pub fn add_avatar(&mut self, slug_or_username: &str, avatar_url: &str) {
        let normalized = normalize_lookup_key(slug_or_username);
        if let Some(normalized) = normalized {
            self.avatar_urls.insert(normalized, avatar_url.into());
        }
    }

    pub fn push_missing_chatroom_once(&mut self, message: &str) {
        self.missing_chatrooms.push_back(message.into());
    }

    pub fn push_message(&mut self, message: KickChatMessage) {
        self.incoming_messages.push_back(message);
    }

    pub fn push_follow_event(&mut self, event: KickFollowEvent) {
        self.follow_events.push_back(event);
    }

    pub fn push_subscription_event(&mut self, event: KickSubscriptionEvent) {
        self.subscription_events.push_back(event);
    }

    pub fn push_refreshed_token(&mut self, token: TokenPair) {
        self.refreshed_tokens.push_back(token);
    }

    pub fn push_drain_error_once(&mut self, message: &str) {
        self.next_drain_error = Some(message.into());
    }

    fn take_drain_error(&mut self) -> Option<PlatformError> {
        self.next_drain_error
            .take()
            .map(|message| PlatformError::new(Platform::Kick, message))
    }
}

impl Default for MockKickClient {
    fn default() -> Self {
        Self::new()
    }
}

impl KickChatClient for MockKickClient {
    fn resolve_chatroom(&mut self, channel_slug: &str) -> PlatformResult<KickChatroom> {
        let normalized = normalize_slug(channel_slug);
        self.chatroom_resolutions.push(normalized.clone());
        if let Some(message) = self.missing_chatrooms.pop_front() {
            return Err(PlatformError::new(Platform::Kick, message));
        }
        self.chatrooms.get(&normalized).cloned().ok_or_else(|| {
            PlatformError::new(
                Platform::Kick,
                format!("Kick chatroom ID not found for channel \"{normalized}\""),
            )
        })
    }

    fn resolve_avatar_url(
        &mut self,
        request: KickAvatarLookupRequest,
    ) -> PlatformResult<Option<String>> {
        self.avatar_resolutions.push(request.clone());
        Ok(normalize_lookup_key(&request.slug_or_username)
            .and_then(|lookup_key| self.avatar_urls.get(&lookup_key))
            .and_then(|avatar_url| normalize_avatar_url(avatar_url)))
    }

    fn subscribe_chatroom(
        &mut self,
        chatroom: &KickChatroom,
        auth: &KickTransportAuth,
    ) -> PlatformResult<()> {
        self.subscribed_chatrooms.push(chatroom.clone());
        self.subscribe_auth.push(auth.clone());
        Ok(())
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        self.disconnect_count = self.disconnect_count.saturating_add(1);
        Ok(())
    }

    fn drain_messages(&mut self) -> PlatformResult<Vec<KickChatMessage>> {
        if let Some(error) = self.take_drain_error() {
            return Err(error);
        }
        Ok(self.incoming_messages.drain(..).collect())
    }

    fn drain_follow_events(&mut self) -> PlatformResult<Vec<KickFollowEvent>> {
        if let Some(error) = self.take_drain_error() {
            return Err(error);
        }
        Ok(self.follow_events.drain(..).collect())
    }

    fn drain_subscription_events(&mut self) -> PlatformResult<Vec<KickSubscriptionEvent>> {
        if let Some(error) = self.take_drain_error() {
            return Err(error);
        }
        Ok(self.subscription_events.drain(..).collect())
    }

    fn send_message(
        &mut self,
        request: KickSendMessageRequest,
        auth: &KickTransportAuth,
    ) -> PlatformResult<String> {
        if !matches!(auth, KickTransportAuth::Authenticated { .. }) {
            return Err(PlatformError::new(
                Platform::Kick,
                "Cannot send Kick message without authenticated transport",
            ));
        }

        self.sent_messages.push(SentKickMessage {
            broadcaster_user_id: request.broadcaster_user_id,
            content: request.content,
            reply_to_message_id: request.reply_to_message_id,
            auth: auth.clone(),
        });
        let id = self.next_sent_id.to_string();
        self.next_sent_id = self.next_sent_id.saturating_add(1);
        Ok(id)
    }

    fn refresh_access_token(
        &mut self,
        account_id: &str,
        refresh_token: &str,
    ) -> PlatformResult<TokenPair> {
        self.refresh_calls
            .push((account_id.into(), refresh_token.into()));
        self.refreshed_tokens.pop_front().ok_or_else(|| {
            PlatformError::new(Platform::Kick, "mock Kick token refresh response missing")
        })
    }

    fn stream_status(&mut self, request: KickStreamStatusRequest) -> PlatformResult<StreamStatus> {
        self.stream_status_requests.push(request.clone());
        Ok(StreamStatus {
            platform: Platform::Kick,
            channel_id: request
                .broadcaster_user_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| request.channel_slug.clone()),
            is_live: true,
            title: format!("{} live", request.channel_slug),
            category_id: None,
            category_name: Some("Just Chatting".into()),
            viewer_count: Some(123),
        })
    }
}

impl From<&KickAuthState> for KickTransportAuth {
    fn from(value: &KickAuthState) -> Self {
        match value {
            KickAuthState::Anonymous => Self::Anonymous,
            KickAuthState::Authenticated {
                account_id,
                platform_user_id,
                username,
                display_name,
                access_token,
                ..
            } => Self::Authenticated {
                account_id: account_id.clone(),
                platform_user_id: platform_user_id.clone(),
                username: username.clone(),
                display_name: display_name.clone(),
                access_token: access_token.clone(),
            },
            KickAuthState::ReauthRequired { account_id, reason } => Self::ReauthRequired {
                account_id: account_id.clone(),
                reason: reason.clone(),
            },
        }
    }
}

fn normalize_slug(slug: &str) -> String {
    slug.trim().trim_start_matches('@').to_lowercase()
}

fn normalize_lookup_key(value: &str) -> Option<String> {
    let normalized = value.trim().trim_start_matches('@').to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_avatar_url(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.into())
    }
}
