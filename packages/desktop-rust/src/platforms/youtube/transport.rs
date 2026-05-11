use crate::platforms::PlatformResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YouTubeTransportKind {
    ServerStreaming,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeAccountHint {
    pub account_id: String,
    pub platform_user_id: String,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YouTubeTransportAuth {
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
pub struct YouTubeChannelResolutionRequest {
    pub input: String,
    pub account_hint: Option<YouTubeAccountHint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeResolvedChannel {
    pub input: String,
    pub channel_id: String,
    pub live_chat_id: String,
    pub video_id: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeStreamSubscription {
    pub channel_id: String,
    pub live_chat_id: String,
    pub video_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeStreamState {
    pub stream_id: String,
    pub subscription: YouTubeStreamSubscription,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeBadge {
    pub id: String,
    pub badge_type: String,
    pub text: String,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeAuthor {
    pub channel_id: String,
    pub display_name: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub is_verified: bool,
    pub is_chat_owner: bool,
    pub is_chat_sponsor: bool,
    pub is_chat_moderator: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeTextMessage {
    pub id: String,
    pub channel_id: String,
    pub live_chat_id: String,
    pub author: YouTubeAuthor,
    pub text: String,
    pub timestamp: String,
    pub badges: Vec<YouTubeBadge>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeSuperChat {
    pub id: String,
    pub channel_id: String,
    pub live_chat_id: String,
    pub author: YouTubeAuthor,
    pub amount_micros: u64,
    pub amount_display_string: String,
    pub currency: String,
    pub comment: Option<String>,
    pub timestamp: String,
    pub is_sticker: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeMembership {
    pub id: String,
    pub channel_id: String,
    pub live_chat_id: String,
    pub author: YouTubeAuthor,
    pub level_name: Option<String>,
    pub months: Option<u32>,
    pub message: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YouTubeStreamItem {
    Text(YouTubeTextMessage),
    SuperChat(YouTubeSuperChat),
    Membership(YouTubeMembership),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YouTubeStreamSignal {
    Item(Box<YouTubeStreamItem>),
    StreamEnded { reason: Option<String> },
    StreamError { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YouTubeSendMessageRequest {
    pub channel_id: String,
    pub live_chat_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
}

/// Non-polling YouTube chat transport.
///
/// Implementations subscribe to a server-streamed chat source and deliver signals that have
/// already been pushed by that stream. The boundary intentionally has no page-token, interval,
/// or HTTP fallback method, so adapters cannot degrade to the legacy request loop.
pub trait YouTubeStreamingTransport {
    fn transport_kind(&self) -> YouTubeTransportKind {
        YouTubeTransportKind::ServerStreaming
    }

    fn resolve_channel(
        &mut self,
        request: YouTubeChannelResolutionRequest,
    ) -> PlatformResult<YouTubeResolvedChannel>;

    fn subscribe(
        &mut self,
        subscription: YouTubeStreamSubscription,
        auth: &YouTubeTransportAuth,
    ) -> PlatformResult<YouTubeStreamState>;

    fn close_stream(&mut self) -> PlatformResult<()>;

    fn receive_pushed_signal(&mut self) -> PlatformResult<Option<YouTubeStreamSignal>>;

    fn send_message(
        &mut self,
        request: YouTubeSendMessageRequest,
        auth: &YouTubeTransportAuth,
    ) -> PlatformResult<String>;
}
