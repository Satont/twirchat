package contracts

type ChatterRole string

const (
	ChatterRoleBroadcaster ChatterRole = "broadcaster"
	ChatterRoleModerators  ChatterRole = "moderators"
	ChatterRoleVips        ChatterRole = "vips"
	ChatterRoleOgs         ChatterRole = "ogs"
	ChatterRoleBots        ChatterRole = "bots"
	ChatterRoleChatters    ChatterRole = "chatters"
)

type ChatterUser struct {
	UserID      string `json:"userId,omitempty"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
}

type ChatterGroup struct {
	Role  ChatterRole   `json:"role"`
	Users []ChatterUser `json:"users"`
}

type ChattersTarget struct {
	Platform    Platform `json:"platform"`
	ChannelSlug string   `json:"channelSlug"`
}

type ChattersParams struct {
	Targets []ChattersTarget `json:"targets"`
}

type ChannelChatters struct {
	Platform    Platform       `json:"platform"`
	ChannelSlug string         `json:"channelSlug"`
	Total       int            `json:"total"`
	Groups      []ChatterGroup `json:"groups"`
	Error       string         `json:"error,omitempty"`
}

type WatchedChannelChatters = ChannelChatters

type ChattersResponse struct {
	Results []ChannelChatters `json:"results"`
}
