export type TwitchViewerRole = 'broadcaster' | 'moderators' | 'vips' | 'bots' | 'chatters'

export type ChatterRole = TwitchViewerRole | 'ogs'

export interface ChatterUser {
  userId?: string
  username: string
  displayName: string
  avatarUrl?: string
}

export interface ChatterGroup {
  role: ChatterRole
  users: ChatterUser[]
}

export interface ChattersTarget {
  platform: 'twitch' | 'kick'
  channelSlug: string
  accountId?: string
}

interface ChannelChattersBase {
  platform: 'twitch' | 'kick'
  channelSlug: string
  total: number
  groups: ChatterGroup[]
}

export type ChannelChatters = ChannelChattersBase &
  (
    | { channelId: string; source?: 'community'; error?: never }
    | { channelId?: never; source?: never; error: string }
  )
