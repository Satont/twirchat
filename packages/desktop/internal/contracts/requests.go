package contracts

// RequestMethod keeps the legacy frontend request names stable while the Go
// services are ported incrementally behind one Wails gateway.
type RequestMethod string

const (
	RequestGetAccounts               RequestMethod = "getAccounts"
	RequestGetSettings               RequestMethod = "getSettings"
	RequestSaveSettings              RequestMethod = "saveSettings"
	RequestGetUserAliases            RequestMethod = "getUserAliases"
	RequestSetUserAlias              RequestMethod = "setUserAlias"
	RequestRemoveUserAlias           RequestMethod = "removeUserAlias"
	RequestGetChannels               RequestMethod = "getChannels"
	RequestAuthStart                 RequestMethod = "authStart"
	RequestAuthLogout                RequestMethod = "authLogout"
	RequestJoinChannel               RequestMethod = "joinChannel"
	RequestLeaveChannel              RequestMethod = "leaveChannel"
	RequestSendMessage               RequestMethod = "sendMessage"
	RequestGetStreamStatus           RequestMethod = "getStreamStatus"
	RequestUpdateStream              RequestMethod = "updateStream"
	RequestSearchCategories          RequestMethod = "searchCategories"
	RequestGetChannelsStatus         RequestMethod = "getChannelsStatus"
	RequestGetRecentMessages         RequestMethod = "getRecentMessages"
	RequestGetUserChatHistory        RequestMethod = "getUserChatHistory"
	RequestGetUserCardMetadata       RequestMethod = "getUserCardMetadata"
	RequestGetStatuses               RequestMethod = "getStatuses"
	RequestGetUsernameColor          RequestMethod = "getUsernameColor"
	RequestGetChannelEmotes          RequestMethod = "getChannelEmotes"
	RequestCheckForUpdate            RequestMethod = "checkForUpdate"
	RequestDownloadUpdate            RequestMethod = "downloadUpdate"
	RequestApplyUpdate               RequestMethod = "applyUpdate"
	RequestSkipUpdate                RequestMethod = "skipUpdate"
	RequestGetWatchedChannels        RequestMethod = "getWatchedChannels"
	RequestAddWatchedChannel         RequestMethod = "addWatchedChannel"
	RequestRemoveWatchedChannel      RequestMethod = "removeWatchedChannel"
	RequestGetWatchedChannelMessages RequestMethod = "getWatchedChannelMessages"
	RequestGetChatters               RequestMethod = "getChatters"
	RequestSendWatchedChannelMessage RequestMethod = "sendWatchedChannelMessage"
	RequestGetWatchedChannelStatuses RequestMethod = "getWatchedChannelStatuses"
	RequestOpenExternalURL           RequestMethod = "openExternalUrl"
	RequestGetTabChannelIDs          RequestMethod = "getTabChannelIds"
	RequestSetTabChannelIDs          RequestMethod = "setTabChannelIds"
	RequestGetWatchedChannelsLayout  RequestMethod = "getWatchedChannelsLayout"
	RequestSetWatchedChannelsLayout  RequestMethod = "setWatchedChannelsLayout"
	RequestRemovePanel               RequestMethod = "removePanel"
	RequestAssignChannelToPanel      RequestMethod = "assignChannelToPanel"
	RequestSplitPanel                RequestMethod = "splitPanel"
	RequestResolveAvatar             RequestMethod = "resolveAvatar"
	RequestGetModerationCapabilities RequestMethod = "getModerationCapabilities"
	RequestModerateMessage           RequestMethod = "moderateMessage"
)

// GatewayRequest is the single Wails binding method input. Params intentionally
// remains an object so the facade can preserve every historical argument shape.
type GatewayRequest struct {
	Method RequestMethod `json:"method"`
	Params any           `json:"params"`
}

type PlatformParams struct {
	Platform Platform `json:"platform"`
}

type UserAliasParams struct {
	Platform       Platform `json:"platform"`
	PlatformUserID string   `json:"platformUserId"`
	Alias          string   `json:"alias"`
}

type UserAliasIDParams struct {
	Platform       Platform `json:"platform"`
	PlatformUserID string   `json:"platformUserId"`
}

type ChannelParams struct {
	Platform    Platform `json:"platform"`
	ChannelSlug string   `json:"channelSlug"`
}

type SendMessageParams struct {
	Platform         Platform `json:"platform"`
	ChannelID        string   `json:"channelId"`
	Text             string   `json:"text"`
	ReplyToMessageID string   `json:"replyToMessageId,omitempty"`
}

// ResolveAvatarParams intentionally contains only public author metadata.
// Provider credentials stay in the Go process and are never sent to Vue.
type ResolveAvatarParams struct {
	Platform Platform `json:"platform"`
	AuthorID string   `json:"authorId"`
	Username string   `json:"username,omitempty"`
}

type ModerationCapabilitiesParams struct {
	Platform    Platform `json:"platform"`
	ChannelSlug string   `json:"channelSlug"`
}

type ModerationAction string

const (
	ModerationActionDeleteMessage ModerationAction = "delete_message"
	ModerationActionTimeout       ModerationAction = "timeout"
	ModerationActionBan           ModerationAction = "ban"
)

type ModerateMessageParams struct {
	Platform        Platform         `json:"platform"`
	ChannelSlug     string           `json:"channelSlug"`
	MessageID       string           `json:"messageId"`
	TargetUserID    string           `json:"targetUserId"`
	Action          ModerationAction `json:"action"`
	DurationSeconds *int             `json:"durationSeconds,omitempty"`
}

type StreamStatusParams struct {
	Platform  Platform `json:"platform"`
	ChannelID string   `json:"channelId"`
}

type UpdateStreamParams struct {
	Platform   Platform `json:"platform"`
	ChannelID  string   `json:"channelId"`
	Title      string   `json:"title,omitempty"`
	CategoryID string   `json:"categoryId,omitempty"`
}

type SearchCategoriesParams struct {
	Platform Platform `json:"platform"`
	Query    string   `json:"query"`
}

type ChannelStatusRequest struct {
	Platform     Platform `json:"platform"`
	ChannelLogin string   `json:"channelLogin"`
	ChannelID    string   `json:"channelId,omitempty"`
}

type ChannelsStatusParams struct {
	Channels []ChannelStatusRequest `json:"channels"`
}

type RecentMessagesParams struct {
	Limit *int `json:"limit,omitempty"`
}

type GetUserChatHistoryParams struct {
	Platform       Platform               `json:"platform"`
	PlatformUserID string                 `json:"platformUserId"`
	Limit          int                    `json:"limit,omitempty"`
	Cursor         *UserChatHistoryCursor `json:"cursor,omitempty"`
}

type UserCardMetadataParams struct {
	Platform       Platform `json:"platform"`
	PlatformUserID string   `json:"platformUserId"`
	Username       string   `json:"username,omitempty"`
	ChannelID      string   `json:"channelId,omitempty"`
	ChannelSlug    string   `json:"channelSlug,omitempty"`
}

type UsernameColorParams struct {
	Platform Platform `json:"platform"`
	Username string   `json:"username"`
}

type ChannelEmotesParams struct {
	Platform  Platform `json:"platform"`
	ChannelID string   `json:"channelId"`
}

type SkipUpdateParams struct {
	Hash string `json:"hash"`
}

type WatchedChannelIDParams struct {
	ID string `json:"id"`
}

type AddWatchedChannelParams struct {
	Platform    Platform `json:"platform"`
	ChannelSlug string   `json:"channelSlug"`
}

type SendWatchedChannelMessageParams struct {
	ID               string `json:"id"`
	Text             string `json:"text"`
	ReplyToMessageID string `json:"replyToMessageId,omitempty"`
}

type ExternalURLParams struct {
	URL string `json:"url"`
}

type TabChannelIDsParams struct {
	IDs []string `json:"ids"`
}

type WatchedChannelsLayoutParams struct {
	TabID string `json:"tabId"`
}

type SetWatchedChannelsLayoutParams struct {
	TabID  string                `json:"tabId"`
	Layout WatchedChannelsLayout `json:"layout"`
}

type PanelParams struct {
	TabID   string `json:"tabId"`
	PanelID string `json:"panelId"`
}

type AssignChannelToPanelParams struct {
	TabID     string `json:"tabId"`
	PanelID   string `json:"panelId"`
	ChannelID string `json:"channelId"`
}

type SplitPanelParams struct {
	TabID     string `json:"tabId"`
	PanelID   string `json:"panelId"`
	Direction string `json:"direction"`
}
