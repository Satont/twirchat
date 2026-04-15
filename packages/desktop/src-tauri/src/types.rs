use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Twitch,
    YouTube,
    Kick,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DesktopToBackendMessage {
    Ping,
    AuthStart {
        platform: Platform,
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
    },
    SeventvUnsubscribe {
        platform: Platform,
        channel_id: String,
    },
    SeventvResubscribe {
        subscriptions: Vec<SeventvSubscription>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SeventvSubscription {
    pub platform: Platform,
    pub channel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub id: String,
    #[serde(rename = "type")]
    pub badge_type: String,
    pub text: String,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotePosition {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Emote {
    pub id: String,
    pub name: String,
    pub image_url: String,
    pub positions: Vec<EmotePosition>,
    pub aspect_ratio: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedChatMessageAuthor {
    pub id: String,
    pub username: Option<String>,
    pub display_name: String,
    pub color: Option<String>,
    pub avatar_url: Option<String>,
    pub badges: Vec<Badge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedChatMessageReplyAuthor {
    pub id: String,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedChatMessageReply {
    pub parent_message_id: String,
    pub parent_message_text: String,
    pub parent_author: NormalizedChatMessageReplyAuthor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Message,
    Action,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedChatMessage {
    pub id: String,
    pub platform: Platform,
    pub channel_id: String,
    pub author: NormalizedChatMessageAuthor,
    pub text: String,
    pub emotes: Vec<Emote>,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub reply: Option<NormalizedChatMessageReply>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedEventUser {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedEvent {
    pub id: String,
    pub platform: Platform,
    #[serde(rename = "type")]
    pub event_type: NormalizedEventType,
    pub user: NormalizedEventUser,
    pub data: serde_json::Map<String, serde_json::Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub platform: Platform,
    pub platform_user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub scopes: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAlias {
    pub platform: Platform,
    pub platform_user_id: String,
    pub alias: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountIdParams {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformParams {
    pub platform: Platform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasParams {
    pub platform: Platform,
    pub platform_user_id: String,
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasRemoveParams {
    pub platform: Platform,
    pub platform_user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMessagesParams {
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameColorParams {
    pub platform: Platform,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmotesParams {
    pub platform: Platform,
    pub channel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatusParams {
    pub platform: Platform,
    pub channel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCategoriesParams {
    pub platform: Platform,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatusRequestList {
    pub channels: Vec<ChannelStatusRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkipUpdateParams {
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWatchedChannelParams {
    pub platform: Platform,
    pub channel_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinChannelParams {
    pub platform: Platform,
    pub channel_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveChannelParams {
    pub platform: Platform,
    pub channel_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    pub platform: Platform,
    pub channel_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelIdParams {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendWatchedChannelMessageParams {
    pub id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabIdParams {
    pub tab_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTabChannelIdsParams {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWatchedChannelsLayoutParams {
    pub tab_id: String,
    pub layout: WatchedChannelsLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovePanelParams {
    pub tab_id: String,
    pub panel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignChannelToPanelParams {
    pub tab_id: String,
    pub panel_id: String,
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPanelParams {
    pub tab_id: String,
    pub panel_id: String,
    pub direction: SplitDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlParams {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitConfigType {
    Combined,
    Channel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub split_type: SplitConfigType,
    pub channel_id: Option<String>,
    pub size: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatLayoutMode {
    Combined,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLayout {
    pub version: u8,
    pub mode: ChatLayoutMode,
    pub splits: Vec<SplitConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfPingConfig {
    pub enabled: bool,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySettings {
    pub new_tab: String,
    pub next_tab: String,
    pub prev_tab: String,
    pub tab_selector: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatTheme {
    Modern,
    Compact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontFamily {
    Inter,
    Manrope,
    System,
}

#[derive(Debug, Clone)]
pub enum PlatformFilter {
    All,
    Platforms(Vec<Platform>),
}

impl Serialize for PlatformFilter {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::All => serializer.serialize_str("all"),
            Self::Platforms(platforms) => platforms.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for PlatformFilter {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;

        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::String(value) if value == "all" => Ok(Self::All),
            serde_json::Value::Array(values) => {
                let platforms = values
                    .into_iter()
                    .map(serde_json::from_value)
                    .collect::<Result<Vec<Platform>, _>>()
                    .map_err(D::Error::custom)?;
                Ok(Self::Platforms(platforms))
            }
            other => Err(D::Error::custom(format!(
                "invalid platform filter: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub background: String,
    pub text_color: String,
    pub font_size: f64,
    pub font_family: String,
    pub max_messages: usize,
    pub message_timeout: usize,
    pub show_platform_icon: bool,
    pub show_avatar: bool,
    pub show_badges: bool,
    pub animation: OverlayAnimation,
    pub position: OverlayPosition,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayAnimation {
    Slide,
    Fade,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    Bottom,
    Top,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
// AppSettings mirrors the frontend JSON schema; bool count is by design.
#[allow(clippy::struct_excessive_bools)]
pub struct AppSettings {
    pub theme: Theme,
    pub chat_theme: ChatTheme,
    pub font_family: FontFamily,
    pub font_size: f64,
    pub show_platform_color_stripe: bool,
    pub show_platform_icon: bool,
    pub show_timestamp: bool,
    pub show_avatars: bool,
    pub show_badges: bool,
    pub platform_filter: PlatformFilter,
    pub hotkeys: HotkeySettings,
    pub overlay: OverlayConfig,
    pub auto_check_updates: Option<bool>,
    pub chat_layout: Option<ChatLayout>,
    pub self_ping: Option<SelfPingConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatus {
    pub platform: Platform,
    pub channel_id: String,
    pub is_live: bool,
    pub title: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatusResponse {
    pub is_live: bool,
    pub title: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SevenTVEmote {
    pub id: String,
    pub alias: String,
    pub name: String,
    pub animated: bool,
    pub zero_width: bool,
    pub aspect_ratio: f64,
    pub image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySearchResult {
    pub id: String,
    pub name: String,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCategoriesResponse {
    pub categories: Vec<CategorySearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStreamRequest {
    pub platform: Platform,
    pub channel_id: String,
    pub title: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatusRequest {
    pub platform: Platform,
    pub channel_login: String,
    pub channel_id: Option<String>,
    pub user_access_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatus {
    pub platform: Platform,
    pub channel_login: String,
    pub is_live: bool,
    pub title: String,
    pub category_name: Option<String>,
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelsStatusResponse {
    pub channels: Vec<ChannelStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelStatus {
    pub channel_id: String,
    pub status: PlatformStatusInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPanelResponse {
    pub original: LayoutNode,
    pub new_panel: LayoutNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStreamResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResponse {
    pub update_available: bool,
    pub version: Option<String>,
    pub current_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
    Anonymous,
    Authenticated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStatusInfo {
    pub platform: Platform,
    pub status: PlatformStatus,
    pub error: Option<String>,
    pub mode: ConnectionMode,
    pub channel_login: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannel {
    pub id: String,
    pub platform: Platform,
    pub channel_slug: String,
    pub display_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub id: String,
    pub direction: SplitDirection,
    pub children: Vec<LayoutNode>,
    pub flex: f64,
    pub min_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PanelContent {
    Main,
    Watched { channel_id: String },
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub id: String,
    pub content: PanelContent,
    pub flex: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LayoutNode {
    Split(SplitNode),
    Panel(PanelNode),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelsLayoutMeta {
    pub created_at: i64,
    pub updated_at: i64,
    pub migrated_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelsLayout {
    pub version: u8,
    pub root: LayoutNode,
    pub meta: Option<WatchedChannelsLayoutMeta>,
}
