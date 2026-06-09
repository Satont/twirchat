use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Twitch,
    Youtube,
    Kick,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub id: String,
    #[serde(rename = "type")]
    pub badge_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotePosition {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Emote {
    pub id: String,
    pub name: String,
    pub image_url: String,
    pub positions: Vec<EmotePosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAuthor {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub badges: Vec<Badge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyAuthor {
    pub id: String,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub parent_message_id: String,
    pub parent_message_text: String,
    pub parent_author: ReplyAuthor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageType {
    Message,
    Action,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedChatMessage {
    pub id: String,
    pub platform: Platform,
    pub channel_id: String,
    pub author: ChatAuthor,
    pub text: String,
    pub emotes: Vec<Emote>,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub message_type: ChatMessageType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<ChatReply>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NormalizedEventType {
    Follow,
    Sub,
    Resub,
    GiftSub,
    Raid,
    Host,
    Bits,
    Superchat,
    Membership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventUser {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedEvent {
    pub id: String,
    pub platform: Platform,
    #[serde(rename = "type")]
    pub event_type: NormalizedEventType,
    pub user: EventUser,
    pub data: Map<String, Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub platform: Platform,
    pub platform_user_id: String,
    pub username: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub scopes: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SplitConfigType {
    Combined,
    Channel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub split_type: SplitConfigType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatLayoutMode {
    Combined,
    Split,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLayout {
    pub version: u8,
    pub mode: ChatLayoutMode,
    pub splits: Vec<SplitConfig>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfPingConfig {
    pub enabled: bool,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySettings {
    pub new_tab: String,
    pub next_tab: String,
    pub prev_tab: String,
    pub tab_selector: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppTheme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatTheme {
    Modern,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontFamilyChoice {
    Inter,
    Manrope,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PlatformFilter {
    All(String),
    Platforms(Vec<Platform>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayAnimation {
    Slide,
    Fade,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    Bottom,
    Top,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub background: String,
    pub text_color: String,
    pub font_size: f64,
    pub font_family: String,
    pub max_messages: u32,
    pub message_timeout: u64,
    pub show_platform_icon: bool,
    pub show_avatar: bool,
    pub show_badges: bool,
    pub animation: OverlayAnimation,
    pub position: OverlayPosition,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: AppTheme,
    pub chat_theme: ChatTheme,
    pub font_family: FontFamilyChoice,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_font_family: Option<String>,
    pub font_size: f64,
    pub show_platform_color_stripe: bool,
    pub show_platform_icon: bool,
    pub show_timestamp: bool,
    pub show_avatars: bool,
    pub show_badges: bool,
    pub platform_filter: PlatformFilter,
    pub hotkeys: HotkeySettings,
    pub overlay: OverlayConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_check_updates: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_layout: Option<ChatLayout>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_ping: Option<SelfPingConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_ban_button: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_timeout_button: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moderation_presets: Option<Vec<ModerationPresetKind>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatus {
    pub platform: Platform,
    pub channel_id: String,
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
#[serde(rename_all = "snake_case")]
pub enum PlatformStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformStatusMode {
    Anonymous,
    Authenticated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStatusInfo {
    pub platform: Platform,
    pub status: PlatformStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub mode: PlatformStatusMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_login: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannel {
    pub id: String,
    pub platform: Platform,
    pub channel_slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broadcaster_id: Option<String>,
    pub display_name: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PanelContent {
    #[serde(rename = "main")]
    Main,
    #[serde(rename = "watched")]
    Watched {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    #[serde(rename = "empty")]
    Empty,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LayoutNode {
    Split {
        id: String,
        direction: SplitDirection,
        children: Vec<LayoutNode>,
        flex: f64,
        #[serde(rename = "minSize", skip_serializing_if = "Option::is_none")]
        min_size: Option<f64>,
    },
    Panel {
        id: String,
        content: PanelContent,
        flex: f64,
    },
}

pub type SplitNode = LayoutNode;
pub type PanelNode = LayoutNode;
pub type LegacySplitConfig = SplitConfig;
pub type LegacyChatLayout = ChatLayout;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationAction {
    Ban,
    Timeout,
    DeleteMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationError {
    pub code: String,
    pub status: u32,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationBanResponse {
    pub success: bool,
    pub user_id: String,
    pub is_permanent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ModerationError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationPresetKind {
    Timeout(u32),
    Ban,
}

impl ModerationPresetKind {
    pub fn label(&self) -> &'static str {
        match self {
            ModerationPresetKind::Timeout(secs) => match *secs {
                0..=59 => "1s",
                60 => "1m",
                300 => "5m",
                600 => "10m",
                1800 => "30m",
                3600 => "1h",
                21600 => "6h",
                86400 => "1d",
                _ => "custom",
            },
            ModerationPresetKind::Ban => "Ban",
        }
    }

    pub fn is_valid_for_platform(&self, platform: Platform) -> bool {
        match platform {
            Platform::Youtube => false,
            Platform::Twitch => true,
            Platform::Kick => match self {
                ModerationPresetKind::Ban => true,
                ModerationPresetKind::Timeout(secs) => *secs >= 60 && *secs <= 604_800,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelsLayoutMeta {
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migrated_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelsLayout {
    pub version: u8,
    pub root: LayoutNode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<WatchedChannelsLayoutMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitchBadgesResponse {
    pub badges: BTreeMap<String, String>,
}
