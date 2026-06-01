use crate::platforms::youtube::transport::{
    YouTubeChannelResolutionRequest, YouTubeResolvedChannel, YouTubeSendMessageRequest,
    YouTubeStreamSignal, YouTubeStreamState, YouTubeStreamSubscription, YouTubeStreamingTransport,
    YouTubeTransportAuth,
};
use crate::platforms::{PlatformError, PlatformResult};
use crate::protocol::types::Platform;
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentYouTubeMessage {
    pub channel_id: String,
    pub live_chat_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MockYouTubeTransport {
    pub resolve_calls: Vec<YouTubeChannelResolutionRequest>,
    pub subscribe_calls: Vec<YouTubeStreamSubscription>,
    pub subscribe_auth: Vec<YouTubeTransportAuth>,
    pub close_count: u32,
    pub sent_messages: Vec<SentYouTubeMessage>,
    resolved_channels: VecDeque<YouTubeResolvedChannel>,
    stream_states: VecDeque<YouTubeStreamState>,
    pushed_signals: VecDeque<YouTubeStreamSignal>,
    next_stream_id: u64,
    next_sent_id: u64,
}

impl MockYouTubeTransport {
    pub fn new() -> Self {
        Self {
            resolve_calls: Vec::new(),
            subscribe_calls: Vec::new(),
            subscribe_auth: Vec::new(),
            close_count: 0,
            sent_messages: Vec::new(),
            resolved_channels: VecDeque::new(),
            stream_states: VecDeque::new(),
            pushed_signals: VecDeque::new(),
            next_stream_id: 1,
            next_sent_id: 1,
        }
    }

    pub fn with_resolved_channel(mut self, channel_id: &str, live_chat_id: &str) -> Self {
        self.push_resolved_channel(channel_id, live_chat_id);
        self
    }

    pub fn push_resolved_channel(&mut self, channel_id: &str, live_chat_id: &str) {
        self.resolved_channels.push_back(YouTubeResolvedChannel {
            input: channel_id.into(),
            channel_id: channel_id.into(),
            live_chat_id: live_chat_id.into(),
            video_id: None,
            display_name: None,
        });
    }

    pub fn push_resolved_channel_with_video(
        &mut self,
        channel_id: &str,
        live_chat_id: &str,
        video_id: &str,
    ) {
        self.resolved_channels.push_back(YouTubeResolvedChannel {
            input: channel_id.into(),
            channel_id: channel_id.into(),
            live_chat_id: live_chat_id.into(),
            video_id: Some(video_id.into()),
            display_name: None,
        });
    }

    pub fn push_stream_state(&mut self, stream: YouTubeStreamState) {
        self.stream_states.push_back(stream);
    }

    pub fn push_signal(&mut self, signal: YouTubeStreamSignal) {
        self.pushed_signals.push_back(signal);
    }
}

impl Default for MockYouTubeTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl YouTubeStreamingTransport for MockYouTubeTransport {
    fn resolve_channel(
        &mut self,
        request: YouTubeChannelResolutionRequest,
    ) -> PlatformResult<YouTubeResolvedChannel> {
        self.resolve_calls.push(request.clone());
        if let Some(mut resolved) = self.resolved_channels.pop_front() {
            resolved.input = request.input;
            return Ok(resolved);
        }

        let input = request.input.trim().to_string();
        if starts_with_channel_id(&input) {
            return Ok(YouTubeResolvedChannel {
                input: input.clone(),
                channel_id: input.clone(),
                live_chat_id: format!("live-chat:{input}"),
                video_id: None,
                display_name: None,
            });
        }

        if let Some(hint) = request.account_hint
            && input_matches_account(&input, &hint.username, &hint.platform_user_id)
        {
            return Ok(YouTubeResolvedChannel {
                input,
                channel_id: hint.platform_user_id.clone(),
                live_chat_id: format!("live-chat:{}", hint.platform_user_id),
                video_id: None,
                display_name: Some(hint.display_name),
            });
        }

        Err(PlatformError::new(
            Platform::Youtube,
            format!("Could not resolve {input} to a YouTube channel id"),
        ))
    }

    fn subscribe(
        &mut self,
        subscription: YouTubeStreamSubscription,
        auth: &YouTubeTransportAuth,
    ) -> PlatformResult<YouTubeStreamState> {
        self.subscribe_calls.push(subscription.clone());
        self.subscribe_auth.push(auth.clone());
        if let Some(stream) = self.stream_states.pop_front() {
            return Ok(stream);
        }

        let stream = YouTubeStreamState {
            stream_id: format!("stream-{}", self.next_stream_id),
            subscription,
        };
        self.next_stream_id = self.next_stream_id.saturating_add(1);
        Ok(stream)
    }

    fn close_stream(&mut self) -> PlatformResult<()> {
        self.close_count = self.close_count.saturating_add(1);
        Ok(())
    }

    fn receive_pushed_signal(&mut self) -> PlatformResult<Option<YouTubeStreamSignal>> {
        Ok(self.pushed_signals.pop_front())
    }

    fn send_message(
        &mut self,
        request: YouTubeSendMessageRequest,
        auth: &YouTubeTransportAuth,
    ) -> PlatformResult<String> {
        if !matches!(auth, YouTubeTransportAuth::Authenticated { .. }) {
            return Err(PlatformError::new(
                Platform::Youtube,
                "Cannot send YouTube message without authenticated transport",
            ));
        }

        self.sent_messages.push(SentYouTubeMessage {
            channel_id: request.channel_id,
            live_chat_id: request.live_chat_id,
            text: request.text,
            reply_to_message_id: request.reply_to_message_id,
        });
        let id = self.next_sent_id.to_string();
        self.next_sent_id = self.next_sent_id.saturating_add(1);
        Ok(id)
    }
}

fn starts_with_channel_id(input: &str) -> bool {
    input.len() >= 2 && input[..2].eq_ignore_ascii_case("UC")
}

fn input_matches_account(input: &str, username: &str, platform_user_id: &str) -> bool {
    let normalized_input = input.trim_start_matches('@').to_lowercase();
    let normalized_username = username.trim_start_matches('@').to_lowercase();
    normalized_input == normalized_username || input == platform_user_id
}
