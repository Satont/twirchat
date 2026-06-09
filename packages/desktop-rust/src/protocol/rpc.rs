use crate::protocol::error::{ProtocolDecodeError, decode_tagged};
use crate::protocol::messages::{
    ChannelStatusRequest, ChannelsStatusResponse, LiveStatusPlatform, SearchCategoriesResponse,
    SevenTvEmote, StreamStatusResponse, UpdateStreamResponse, UserCardMetadataRequest,
    UserCardMetadataResponse,
};
use crate::protocol::types::{
    Account, AppSettings, LayoutNode, NormalizedChatMessage, NormalizedEvent, Platform,
    PlatformStatusInfo, SplitDirection, WatchedChannel, WatchedChannelsLayout,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const BUN_REQUEST_TAGS: &[&str] = &[
    "getAccounts",
    "getSettings",
    "saveSettings",
    "getUserAliases",
    "setUserAlias",
    "removeUserAlias",
    "getChannels",
    "authStart",
    "authLogout",
    "joinChannel",
    "leaveChannel",
    "sendMessage",
    "getStreamStatus",
    "updateStream",
    "searchCategories",
    "getChannelsStatus",
    "getRecentMessages",
    "getUserChatHistory",
    "getUserCardMetadata",
    "getStatuses",
    "getUsernameColor",
    "getChannelEmotes",
    "checkForUpdate",
    "downloadUpdate",
    "applyUpdate",
    "skipUpdate",
    "getWatchedChannels",
    "addWatchedChannel",
    "removeWatchedChannel",
    "getWatchedChannelMessages",
    "sendWatchedChannelMessage",
    "getWatchedChannelStatuses",
    "openExternalUrl",
    "getTabChannelIds",
    "setTabChannelIds",
    "getWatchedChannelsLayout",
    "setWatchedChannelsLayout",
    "removePanel",
    "assignChannelToPanel",
    "splitPanel",
];

const WEBVIEW_MESSAGE_TAGS: &[&str] = &[
    "chat_message",
    "chat_event",
    "platform_status",
    "auth_url",
    "auth_success",
    "auth_error",
    "update_status",
    "watched_channel_message",
    "watched_channel_status",
    "channel_emotes_set",
    "channel_emote_added",
    "channel_emote_removed",
    "channel_emote_updated",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAlias {
    pub platform: Platform,
    pub platform_user_id: String,
    pub alias: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserChatHistoryCursor {
    pub created_at: u64,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserChatHistoryPage {
    pub messages: Vec<NormalizedChatMessage>,
    pub next_cursor: Option<UserChatHistoryCursor>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformParams {
    pub platform: Platform,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetUserAliasParams {
    pub platform: Platform,
    pub platform_user_id: String,
    pub alias: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIdentityParams {
    pub platform: Platform,
    pub platform_user_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSlugParams {
    pub platform: Platform,
    pub channel_slug: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    pub platform: Platform,
    pub channel_id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetStreamStatusParams {
    pub platform: LiveStatusPlatform,
    pub channel_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStreamParams {
    pub platform: LiveStatusPlatform,
    pub channel_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchCategoriesParams {
    pub platform: LiveStatusPlatform,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetChannelsStatusParams {
    pub channels: Vec<ChannelStatusRequest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetRecentMessagesParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetUserChatHistoryParams {
    pub platform: Platform,
    pub platform_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<UserChatHistoryCursor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GetUsernameColorParams {
    pub platform: Platform,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmotesParams {
    pub platform: Platform,
    pub channel_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckForUpdateResponse {
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DownloadUpdateResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkipUpdateParams {
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddWatchedChannelParams {
    pub platform: Platform,
    pub channel_slug: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IdParams {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendWatchedChannelMessageParams {
    pub id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelStatusEntry {
    pub channel_id: String,
    pub status: PlatformStatusInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenExternalUrlParams {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetTabChannelIdsParams {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabIdParams {
    pub tab_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWatchedChannelsLayoutParams {
    pub tab_id: String,
    pub layout: WatchedChannelsLayout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovePanelParams {
    pub tab_id: String,
    pub panel_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignChannelToPanelParams {
    pub tab_id: String,
    pub panel_id: String,
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPanelParams {
    pub tab_id: String,
    pub panel_id: String,
    pub direction: SplitDirection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SplitPanelResponse {
    pub original: LayoutNode,
    #[serde(rename = "newPanel")]
    pub new_panel: LayoutNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params")]
#[expect(
    clippy::large_enum_variant,
    reason = "RPC payloads mirror the shared protocol and are not stored in hot collections"
)]
pub enum BunRequestPayload {
    #[serde(rename = "getAccounts")]
    GetAccounts,
    #[serde(rename = "getSettings")]
    GetSettings,
    #[serde(rename = "saveSettings")]
    SaveSettings(AppSettings),
    #[serde(rename = "getUserAliases")]
    GetUserAliases,
    #[serde(rename = "setUserAlias")]
    SetUserAlias(SetUserAliasParams),
    #[serde(rename = "removeUserAlias")]
    RemoveUserAlias(UserIdentityParams),
    #[serde(rename = "getChannels")]
    GetChannels,
    #[serde(rename = "authStart")]
    AuthStart(PlatformParams),
    #[serde(rename = "authLogout")]
    AuthLogout(PlatformParams),
    #[serde(rename = "joinChannel")]
    JoinChannel(ChannelSlugParams),
    #[serde(rename = "leaveChannel")]
    LeaveChannel(ChannelSlugParams),
    #[serde(rename = "sendMessage")]
    SendMessage(SendMessageParams),
    #[serde(rename = "getStreamStatus")]
    GetStreamStatus(GetStreamStatusParams),
    #[serde(rename = "updateStream")]
    UpdateStream(UpdateStreamParams),
    #[serde(rename = "searchCategories")]
    SearchCategories(SearchCategoriesParams),
    #[serde(rename = "getChannelsStatus")]
    GetChannelsStatus(GetChannelsStatusParams),
    #[serde(rename = "getRecentMessages")]
    GetRecentMessages(Option<GetRecentMessagesParams>),
    #[serde(rename = "getUserChatHistory")]
    GetUserChatHistory(GetUserChatHistoryParams),
    #[serde(rename = "getUserCardMetadata")]
    GetUserCardMetadata(UserCardMetadataRequest),
    #[serde(rename = "getStatuses")]
    GetStatuses,
    #[serde(rename = "getUsernameColor")]
    GetUsernameColor(GetUsernameColorParams),
    #[serde(rename = "getChannelEmotes")]
    GetChannelEmotes(ChannelEmotesParams),
    #[serde(rename = "checkForUpdate")]
    CheckForUpdate,
    #[serde(rename = "downloadUpdate")]
    DownloadUpdate,
    #[serde(rename = "applyUpdate")]
    ApplyUpdate,
    #[serde(rename = "skipUpdate")]
    SkipUpdate(SkipUpdateParams),
    #[serde(rename = "getWatchedChannels")]
    GetWatchedChannels,
    #[serde(rename = "addWatchedChannel")]
    AddWatchedChannel(AddWatchedChannelParams),
    #[serde(rename = "removeWatchedChannel")]
    RemoveWatchedChannel(IdParams),
    #[serde(rename = "getWatchedChannelMessages")]
    GetWatchedChannelMessages(IdParams),
    #[serde(rename = "sendWatchedChannelMessage")]
    SendWatchedChannelMessage(SendWatchedChannelMessageParams),
    #[serde(rename = "getWatchedChannelStatuses")]
    GetWatchedChannelStatuses,
    #[serde(rename = "openExternalUrl")]
    OpenExternalUrl(OpenExternalUrlParams),
    #[serde(rename = "getTabChannelIds")]
    GetTabChannelIds,
    #[serde(rename = "setTabChannelIds")]
    SetTabChannelIds(SetTabChannelIdsParams),
    #[serde(rename = "getWatchedChannelsLayout")]
    GetWatchedChannelsLayout(TabIdParams),
    #[serde(rename = "setWatchedChannelsLayout")]
    SetWatchedChannelsLayout(SetWatchedChannelsLayoutParams),
    #[serde(rename = "removePanel")]
    RemovePanel(RemovePanelParams),
    #[serde(rename = "assignChannelToPanel")]
    AssignChannelToPanel(AssignChannelToPanelParams),
    #[serde(rename = "splitPanel")]
    SplitPanel(SplitPanelParams),
}

pub fn parse_bun_request_payload(text: &str) -> Result<BunRequestPayload, ProtocolDecodeError> {
    decode_tagged(text, "BunRequestPayload", "method", BUN_REQUEST_TAGS)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "payload")]
pub enum BunResponsePayload {
    #[serde(rename = "getAccounts")]
    GetAccounts(Vec<Account>),
    #[serde(rename = "getSettings")]
    GetSettings(AppSettings),
    #[serde(rename = "getUserAliases")]
    GetUserAliases(Vec<UserAlias>),
    #[serde(rename = "getChannels")]
    GetChannels(BTreeMap<Platform, Vec<String>>),
    #[serde(rename = "getStreamStatus")]
    GetStreamStatus(StreamStatusResponse),
    #[serde(rename = "updateStream")]
    UpdateStream(UpdateStreamResponse),
    #[serde(rename = "searchCategories")]
    SearchCategories(SearchCategoriesResponse),
    #[serde(rename = "getChannelsStatus")]
    GetChannelsStatus(ChannelsStatusResponse),
    #[serde(rename = "getRecentMessages")]
    GetRecentMessages(Vec<NormalizedChatMessage>),
    #[serde(rename = "getUserChatHistory")]
    GetUserChatHistory(UserChatHistoryPage),
    #[serde(rename = "getUserCardMetadata")]
    GetUserCardMetadata(UserCardMetadataResponse),
    #[serde(rename = "getStatuses")]
    GetStatuses(Vec<PlatformStatusInfo>),
    #[serde(rename = "getUsernameColor")]
    GetUsernameColor(Option<String>),
    #[serde(rename = "getChannelEmotes")]
    GetChannelEmotes(Vec<SevenTvEmote>),
    #[serde(rename = "checkForUpdate")]
    CheckForUpdate(CheckForUpdateResponse),
    #[serde(rename = "downloadUpdate")]
    DownloadUpdate(DownloadUpdateResponse),
    #[serde(rename = "getWatchedChannels")]
    GetWatchedChannels(Vec<WatchedChannel>),
    #[serde(rename = "addWatchedChannel")]
    AddWatchedChannel(WatchedChannel),
    #[serde(rename = "getWatchedChannelMessages")]
    GetWatchedChannelMessages(Vec<NormalizedChatMessage>),
    #[serde(rename = "getWatchedChannelStatuses")]
    GetWatchedChannelStatuses(Vec<WatchedChannelStatusEntry>),
    #[serde(rename = "getTabChannelIds")]
    GetTabChannelIds(Option<Vec<String>>),
    #[serde(rename = "getWatchedChannelsLayout")]
    GetWatchedChannelsLayout(Option<WatchedChannelsLayout>),
    #[serde(rename = "splitPanel")]
    SplitPanel(SplitPanelResponse),
    #[serde(rename = "void")]
    Void,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusPayload {
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelMessagePayload {
    pub channel_id: String,
    pub message: NormalizedChatMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedChannelStatusPayload {
    pub channel_id: String,
    pub status: PlatformStatusInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUrlPayload {
    pub platform: Platform,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSuccessPayload {
    pub platform: Platform,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthErrorPayload {
    pub platform: Platform,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmotesSetPayload {
    pub platform: Platform,
    pub channel_id: String,
    pub emotes: Vec<SevenTvEmote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmoteAddedPayload {
    pub platform: Platform,
    pub channel_id: String,
    pub emote: SevenTvEmote,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmoteRemovedPayload {
    pub platform: Platform,
    pub channel_id: String,
    pub emote_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEmoteUpdatedPayload {
    pub platform: Platform,
    pub channel_id: String,
    pub emote_id: String,
    pub new_alias: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "message", content = "payload", rename_all = "snake_case")]
pub enum WebviewMessagePayload {
    ChatMessage(NormalizedChatMessage),
    ChatEvent(NormalizedEvent),
    PlatformStatus(PlatformStatusInfo),
    AuthUrl(AuthUrlPayload),
    AuthSuccess(AuthSuccessPayload),
    AuthError(AuthErrorPayload),
    UpdateStatus(UpdateStatusPayload),
    WatchedChannelMessage(WatchedChannelMessagePayload),
    WatchedChannelStatus(WatchedChannelStatusPayload),
    ChannelEmotesSet(ChannelEmotesSetPayload),
    ChannelEmoteAdded(ChannelEmoteAddedPayload),
    ChannelEmoteRemoved(ChannelEmoteRemovedPayload),
    ChannelEmoteUpdated(ChannelEmoteUpdatedPayload),
}

pub fn parse_webview_message_payload(
    text: &str,
) -> Result<WebviewMessagePayload, ProtocolDecodeError> {
    decode_tagged(
        text,
        "WebviewMessagePayload",
        "message",
        WEBVIEW_MESSAGE_TAGS,
    )
}
