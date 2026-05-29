use crate::platforms::twitch::adapter::{
    StreamUpdate, StreamUpdateOutcome, TwitchAuthState, TwitchCategory, TwitchChatClient,
    TwitchChatEvent, TwitchChatMessage,
};
use crate::platforms::{PlatformError, PlatformResult};
use crate::protocol::types::{Platform, StreamStatus};
use crate::storage::TokenPair;
use std::collections::{BTreeMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentMessageRecord {
    pub channel_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MockTwitchClient {
    pub connected_channel: Option<String>,
    pub connect_auth_state: Option<TwitchAuthState>,
    pub disconnect_count: u32,
    pub sent_messages: Vec<SentMessageRecord>,
    pub badge_response: BTreeMap<String, String>,
    pub incoming_messages: VecDeque<TwitchChatMessage>,
    pub incoming_events: VecDeque<TwitchChatEvent>,
    pub categories: Vec<TwitchCategory>,
    pub stream_status: StreamStatus,
    pub stream_updates: Vec<StreamUpdate>,
    pub refresh_calls: Vec<(String, String)>,
    refreshed_tokens: VecDeque<TokenPair>,
    next_sent_id: u64,
}

impl MockTwitchClient {
    pub fn new() -> Self {
        Self {
            connected_channel: None,
            connect_auth_state: None,
            disconnect_count: 0,
            sent_messages: Vec::new(),
            badge_response: BTreeMap::new(),
            incoming_messages: VecDeque::new(),
            incoming_events: VecDeque::new(),
            categories: Vec::new(),
            stream_status: StreamStatus {
                platform: Platform::Twitch,
                channel_id: "fixturestreamer".into(),
                is_live: true,
                title: "Fixture stream".into(),
                category_id: Some("509658".into()),
                category_name: Some("Just Chatting".into()),
                viewer_count: Some(42),
            },
            stream_updates: Vec::new(),
            refresh_calls: Vec::new(),
            refreshed_tokens: VecDeque::new(),
            next_sent_id: 1,
        }
    }

    pub fn with_badge(mut self, key: &str, image_url: &str) -> Self {
        self.badge_response.insert(key.into(), image_url.into());
        self
    }

    pub fn with_category(mut self, id: &str, name: &str) -> Self {
        self.categories.push(TwitchCategory {
            id: id.into(),
            name: name.into(),
        });
        self
    }

    pub fn push_message(&mut self, message: TwitchChatMessage) {
        self.incoming_messages.push_back(message);
    }

    pub fn push_event(&mut self, event: TwitchChatEvent) {
        self.incoming_events.push_back(event);
    }

    pub fn push_refreshed_token(&mut self, token: TokenPair) {
        self.refreshed_tokens.push_back(token);
    }
}

impl Default for MockTwitchClient {
    fn default() -> Self {
        Self::new()
    }
}

impl TwitchChatClient for MockTwitchClient {
    fn connect(&mut self, channel: &str, auth: &TwitchAuthState) -> PlatformResult<()> {
        self.connected_channel = Some(channel.trim_start_matches('#').to_lowercase());
        self.connect_auth_state = Some(auth.clone());
        Ok(())
    }

    fn disconnect(&mut self) -> PlatformResult<()> {
        self.connected_channel = None;
        self.disconnect_count = self.disconnect_count.saturating_add(1);
        Ok(())
    }

    fn send_message(
        &mut self,
        channel_id: &str,
        text: &str,
        reply_to_message_id: Option<&str>,
    ) -> PlatformResult<String> {
        self.sent_messages.push(SentMessageRecord {
            channel_id: channel_id.trim_start_matches('#').to_lowercase(),
            text: text.into(),
            reply_to_message_id: reply_to_message_id.map(str::to_string),
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
            PlatformError::new(
                Platform::Twitch,
                "mock Twitch token refresh response missing",
            )
        })
    }

    fn fetch_badges(&mut self, _channel: &str) -> PlatformResult<BTreeMap<String, String>> {
        Ok(self.badge_response.clone())
    }

    fn drain_messages(&mut self) -> PlatformResult<Vec<TwitchChatMessage>> {
        Ok(self.incoming_messages.drain(..).collect())
    }

    fn drain_events(&mut self) -> PlatformResult<Vec<TwitchChatEvent>> {
        Ok(self.incoming_events.drain(..).collect())
    }

    fn search_categories(&mut self, query: &str) -> PlatformResult<Vec<TwitchCategory>> {
        let normalized_query = query.to_lowercase();
        Ok(self
            .categories
            .iter()
            .filter(|category| category.name.to_lowercase().contains(&normalized_query))
            .cloned()
            .collect())
    }

    fn update_stream(&mut self, update: &StreamUpdate) -> PlatformResult<StreamUpdateOutcome> {
        if update.title.is_none() && update.category_id.is_none() {
            return Err(PlatformError::new(
                Platform::Twitch,
                "stream update must include title or category",
            ));
        }
        self.stream_updates.push(update.clone());
        Ok(StreamUpdateOutcome {
            channel_id: update.channel_id.clone(),
            updated_title: update.title.clone(),
            updated_category_id: update.category_id.clone(),
        })
    }

    fn stream_status(&mut self, channel_id: &str) -> PlatformResult<StreamStatus> {
        let mut status = self.stream_status.clone();
        status.channel_id = channel_id.into();
        Ok(status)
    }
}
