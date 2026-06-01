use crate::protocol::error::{ProtocolDecodeError, decode_tagged};
use crate::protocol::types::Platform;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const BACKEND_TO_DESKTOP_TAGS: &[&str] = &[
    "auth_url",
    "auth_success",
    "auth_error",
    "error",
    "pong",
    "chat_message",
    "chat_event",
    "platform_status",
    "seventv_emote_set",
    "seventv_emote_added",
    "seventv_emote_removed",
    "seventv_emote_updated",
    "seventv_system_message",
];

const DESKTOP_TO_BACKEND_TAGS: &[&str] = &[
    "ping",
    "auth_start",
    "auth_start_twitch",
    "auth_logout",
    "send_message",
    "channel_join",
    "channel_leave",
    "seventv_subscribe",
    "seventv_unsubscribe",
    "seventv_resubscribe",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SevenTvEmote {
    pub id: String,
    pub alias: String,
    pub name: String,
    pub animated: bool,
    pub zero_width: bool,
    pub aspect_ratio: f64,
    pub image_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendPlatformStatus {
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SevenTvSystemMessage {
    Added {
        emote: SevenTvEmote,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_alias: Option<String>,
    },
    Removed {
        emote: SevenTvEmote,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_alias: Option<String>,
    },
    Updated {
        emote: SevenTvEmote,
        #[serde(skip_serializing_if = "Option::is_none")]
        old_alias: Option<String>,
    },
    SetChanged {
        set_name: String,
    },
    SetRenamed {
        old_name: String,
        new_name: String,
    },
    SetDeleted {
        set_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum BackendToDesktopMessage {
    AuthUrl {
        platform: Platform,
        url: String,
    },
    AuthSuccess {
        platform: Platform,
        username: String,
        display_name: String,
    },
    AuthError {
        platform: Platform,
        error: String,
    },
    Error {
        message: String,
    },
    Pong,
    ChatMessage {
        data: Value,
    },
    ChatEvent {
        data: Value,
    },
    PlatformStatus {
        platform: Platform,
        status: BackendPlatformStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    SeventvEmoteSet {
        platform: Platform,
        channel_id: String,
        emotes: Vec<SevenTvEmote>,
    },
    SeventvEmoteAdded {
        platform: Platform,
        channel_id: String,
        emote: SevenTvEmote,
    },
    SeventvEmoteRemoved {
        platform: Platform,
        channel_id: String,
        emote_id: String,
    },
    SeventvEmoteUpdated {
        platform: Platform,
        channel_id: String,
        emote_id: String,
        alias: String,
    },
    SeventvSystemMessage {
        platform: Platform,
        channel_id: String,
        #[serde(flatten)]
        message: SevenTvSystemMessage,
    },
}

pub fn parse_backend_to_desktop_message(
    text: &str,
) -> Result<BackendToDesktopMessage, ProtocolDecodeError> {
    decode_tagged(
        text,
        "BackendToDesktopMessage",
        "type",
        BACKEND_TO_DESKTOP_TAGS,
    )
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SevenTvSubscription {
    pub platform: Platform,
    pub channel_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_user_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DesktopToBackendMessage {
    Ping,
    AuthStart {
        platform: BackendAuthPlatform,
    },
    AuthStartTwitch {
        code_challenge: String,
        state: String,
    },
    AuthLogout {
        platform: Platform,
    },
    SendMessage {
        platform: Platform,
        channel: String,
        message: String,
    },
    ChannelJoin {
        platform: Platform,
        channel: String,
    },
    ChannelLeave {
        platform: Platform,
        channel: String,
    },
    SeventvSubscribe {
        platform: Platform,
        channel_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform_user_id: Option<String>,
    },
    SeventvUnsubscribe {
        platform: Platform,
        channel_id: String,
    },
    SeventvResubscribe {
        subscriptions: Vec<SevenTvSubscription>,
    },
}

pub fn parse_desktop_to_backend_message(
    text: &str,
) -> Result<DesktopToBackendMessage, ProtocolDecodeError> {
    decode_tagged(
        text,
        "DesktopToBackendMessage",
        "type",
        DESKTOP_TO_BACKEND_TAGS,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendAuthPlatform {
    Youtube,
    Kick,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStartRequest {
    pub client_secret: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthStartResponse {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchBuildUrlRequest {
    pub code_challenge: String,
    pub state: String,
    pub redirect_uri: String,
}

pub type TwitchBuildUrlResponse = AuthStartResponse;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthExchangeRequest {
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthExchangeResponse {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefreshRequest {
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResponse {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}

pub type TwitchExchangeRequest = OAuthExchangeRequest;
pub type TwitchExchangeResponse = OAuthExchangeResponse;
pub type KickBuildUrlRequest = TwitchBuildUrlRequest;
pub type KickBuildUrlResponse = AuthStartResponse;
pub type KickExchangeRequest = OAuthExchangeRequest;
pub type KickExchangeResponse = OAuthExchangeResponse;
pub type KickRefreshRequest = RefreshRequest;
pub type KickRefreshResponse = RefreshResponse;
pub type TwitchRefreshRequest = RefreshRequest;
pub type TwitchRefreshResponse = RefreshResponse;
pub type YouTubeBuildUrlRequest = TwitchBuildUrlRequest;
pub type YouTubeBuildUrlResponse = AuthStartResponse;
pub type YouTubeExchangeRequest = OAuthExchangeRequest;
pub type YouTubeExchangeResponse = OAuthExchangeResponse;
pub type YouTubeRefreshRequest = RefreshRequest;
pub type YouTubeRefreshResponse = RefreshResponse;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatusResponse {
    pub is_live: bool,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveStatusPlatform {
    Twitch,
    Kick,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatusRequest {
    pub platform: LiveStatusPlatform,
    pub channel_login: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_access_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatus {
    pub platform: LiveStatusPlatform,
    pub channel_login: String,
    pub is_live: bool,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelsStatusResponse {
    pub channels: Vec<ChannelStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStreamRequest {
    pub platform: LiveStatusPlatform,
    pub channel_id: String,
    pub user_access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateStreamResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySearchResult {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchCategoriesResponse {
    pub categories: Vec<CategorySearchResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserCardMetadataPlatform {
    Twitch,
    Kick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserCardFieldStatus {
    Available,
    Unavailable,
    Unsupported,
    MissingPermission,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardMetadataRequest {
    pub platform: UserCardMetadataPlatform,
    pub platform_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_slug: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchUserCardAuth {
    pub access_token: String,
    pub platform_user_id: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardMetadataBackendRequest {
    #[serde(flatten)]
    pub request: UserCardMetadataRequest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub twitch_auth: Option<TwitchUserCardAuth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardAccountAgeField {
    pub status: UserCardFieldStatus,
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardFollowAgeField {
    pub status: UserCardFieldStatus,
    pub followed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardSubscriptionDurationField {
    pub status: UserCardFieldStatus,
    pub currently_subscribed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_gift: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gifter_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardSubAgeField {
    pub status: UserCardFieldStatus,
    pub months: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCardMetadataResponse {
    pub platform: UserCardMetadataPlatform,
    pub platform_user_id: String,
    pub fetched_at: u64,
    pub account_age: UserCardAccountAgeField,
    pub follow_age: UserCardFollowAgeField,
    pub subscription_duration: UserCardSubscriptionDurationField,
    pub sub_age: UserCardSubAgeField,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountsResponseAccount {
    pub platform: Platform,
    pub username: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl", skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(rename = "connectedAt")]
    pub connected_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountsResponse {
    pub accounts: Vec<AccountsResponseAccount>,
}
