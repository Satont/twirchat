package contracts

import "time"

// Platform is a chat platform identifier used by the restored Vue frontend.
type Platform string

const (
	PlatformTwitch  Platform = "twitch"
	PlatformYouTube Platform = "youtube"
	PlatformKick    Platform = "kick"
)

type Badge struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Text     string `json:"text"`
	ImageURL string `json:"imageUrl,omitempty"`
}

type EmotePosition struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type Emote struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	ImageURL    string          `json:"imageUrl"`
	Positions   []EmotePosition `json:"positions"`
	AspectRatio *float64        `json:"aspectRatio,omitempty"`
}

type ChatAuthor struct {
	ID          string  `json:"id"`
	Username    string  `json:"username,omitempty"`
	DisplayName string  `json:"displayName"`
	Color       string  `json:"color,omitempty"`
	AvatarURL   string  `json:"avatarUrl,omitempty"`
	Badges      []Badge `json:"badges"`
}

type ReplyAuthor struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type MessageReply struct {
	ParentMessageID   string      `json:"parentMessageId"`
	ParentMessageText string      `json:"parentMessageText"`
	ParentAuthor      ReplyAuthor `json:"parentAuthor"`
}

// NormalizedChatMessage uses time.Time so encoding/json emits RFC 3339 ISO strings.
// The Vue facade converts those ISO strings into Date instances at the boundary.
type NormalizedChatMessage struct {
	ID        string        `json:"id"`
	Platform  Platform      `json:"platform"`
	ChannelID string        `json:"channelId"`
	Author    ChatAuthor    `json:"author"`
	Text      string        `json:"text"`
	Emotes    []Emote       `json:"emotes"`
	Timestamp time.Time     `json:"timestamp"`
	Type      string        `json:"type"`
	Reply     *MessageReply `json:"reply,omitempty"`
}

type EventUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
}

// NormalizedEvent uses the same ISO timestamp contract as NormalizedChatMessage.
type NormalizedEvent struct {
	ID        string         `json:"id"`
	Platform  Platform       `json:"platform"`
	Type      string         `json:"type"`
	User      EventUser      `json:"user"`
	Data      map[string]any `json:"data"`
	Timestamp time.Time      `json:"timestamp"`
}

type Account struct {
	ID             string   `json:"id"`
	Platform       Platform `json:"platform"`
	PlatformUserID string   `json:"platformUserId"`
	Username       string   `json:"username"`
	DisplayName    string   `json:"displayName"`
	AvatarURL      string   `json:"avatarUrl,omitempty"`
	Scopes         []string `json:"scopes"`
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
}

type UserAlias struct {
	Platform       Platform `json:"platform"`
	PlatformUserID string   `json:"platformUserId"`
	Alias          string   `json:"alias"`
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
}

type PlatformStatusInfo struct {
	Platform     Platform `json:"platform"`
	Status       string   `json:"status"`
	Error        string   `json:"error,omitempty"`
	Mode         string   `json:"mode"`
	ChannelLogin string   `json:"channelLogin,omitempty"`
}

type StreamStatus struct {
	Platform     Platform `json:"platform"`
	ChannelID    string   `json:"channelId"`
	IsLive       bool     `json:"isLive"`
	Title        string   `json:"title"`
	CategoryID   string   `json:"categoryId,omitempty"`
	CategoryName string   `json:"categoryName,omitempty"`
	ViewerCount  *int     `json:"viewerCount,omitempty"`
}

// ChannelStatus is the bulk stream-status payload consumed by the Vue polling store.
type ChannelStatus struct {
	Platform     Platform `json:"platform"`
	ChannelLogin string   `json:"channelLogin"`
	IsLive       bool     `json:"isLive"`
	Title        string   `json:"title"`
	CategoryName string   `json:"categoryName,omitempty"`
	ViewerCount  *int     `json:"viewerCount,omitempty"`
}

type ChannelsStatusResponse struct {
	Channels []ChannelStatus `json:"channels"`
}

type CategorySearchResult struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
}

type SevenTVEmote struct {
	ID          string  `json:"id"`
	Alias       string  `json:"alias"`
	Name        string  `json:"name"`
	Animated    bool    `json:"animated"`
	ZeroWidth   bool    `json:"zeroWidth"`
	AspectRatio float64 `json:"aspectRatio"`
	ImageURL    string  `json:"imageUrl"`
}

type WatchedChannel struct {
	ID          string   `json:"id"`
	Platform    Platform `json:"platform"`
	ChannelSlug string   `json:"channelSlug"`
	DisplayName string   `json:"displayName"`
	CreatedAt   int64    `json:"createdAt"`
}

type PanelContent struct {
	Type      string `json:"type"`
	ChannelID string `json:"channelId,omitempty"`
}

type LayoutNode struct {
	Type      string        `json:"type"`
	ID        string        `json:"id"`
	Direction string        `json:"direction,omitempty"`
	Children  []LayoutNode  `json:"children,omitempty"`
	Content   *PanelContent `json:"content,omitempty"`
	Flex      float64       `json:"flex"`
	MinSize   *float64      `json:"minSize,omitempty"`
}

type LayoutMeta struct {
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	MigratedFrom string `json:"migratedFrom,omitempty"`
}

type WatchedChannelsLayout struct {
	Version int         `json:"version"`
	Root    LayoutNode  `json:"root"`
	Meta    *LayoutMeta `json:"meta,omitempty"`
}

type UserChatHistoryCursor struct {
	CreatedAt int64  `json:"createdAt"`
	ID        string `json:"id"`
}

type UserChatHistoryPage struct {
	Messages   []NormalizedChatMessage `json:"messages"`
	NextCursor *UserChatHistoryCursor  `json:"nextCursor"`
	HasMore    bool                    `json:"hasMore"`
}

type AuthURL struct {
	Platform Platform `json:"platform"`
	URL      string   `json:"url"`
}

type AuthSuccess struct {
	Platform    Platform `json:"platform"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
}

type AuthError struct {
	Platform Platform `json:"platform"`
	Error    string   `json:"error"`
}

type ChannelEmotesSet struct {
	Platform  Platform       `json:"platform"`
	ChannelID string         `json:"channelId"`
	Emotes    []SevenTVEmote `json:"emotes"`
}

type ChannelEmoteAdded struct {
	Platform  Platform     `json:"platform"`
	ChannelID string       `json:"channelId"`
	Emote     SevenTVEmote `json:"emote"`
}

type ChannelEmoteRemoved struct {
	Platform  Platform `json:"platform"`
	ChannelID string   `json:"channelId"`
	EmoteID   string   `json:"emoteId"`
}

type ChannelEmoteUpdated struct {
	Platform  Platform `json:"platform"`
	ChannelID string   `json:"channelId"`
	EmoteID   string   `json:"emoteId"`
	NewAlias  string   `json:"newAlias"`
}

type WatchedChannelMessage struct {
	ChannelID string                `json:"channelId"`
	Message   NormalizedChatMessage `json:"message"`
}

type WatchedChannelStatus struct {
	ChannelID string             `json:"channelId"`
	Status    PlatformStatusInfo `json:"status"`
}

type ApplicationCapabilities struct {
	Updates bool `json:"updates"`
}
