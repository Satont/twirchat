// ============================================================
// Общие типы платформ
// ============================================================

export type Platform = 'twitch' | 'youtube' | 'kick'

export interface Badge {
  id: string
  type: 'moderator' | 'subscriber' | 'vip' | 'broadcaster' | 'staff' | 'gifter' | string
  text: string
  imageUrl?: string
}

export interface Emote {
  id: string
  name: string
  imageUrl: string
  /** Начальная и конечная позиции в тексте */
  positions: { start: number; end: number }[]
  /** Соотношение сторон для широких смайлов (например 3 для privet) */
  aspectRatio?: number
}

// ============================================================
// Нормализованные сообщения и события
// ============================================================

export interface NormalizedChatMessage {
  id: string
  platform: Platform
  channelId: string
  author: {
    id: string
    username?: string
    displayName: string
    color?: string
    avatarUrl?: string
    badges: Badge[]
  }
  text: string
  emotes: Emote[]
  timestamp: Date
  type: 'message' | 'action' | 'system'
  reply?: {
    parentMessageId: string
    parentMessageText: string
    parentAuthor: {
      id: string
      username: string
      displayName: string
    }
  }
}

export interface NormalizedEvent {
  id: string
  platform: Platform
  type:
    | 'follow'
    | 'sub'
    | 'resub'
    | 'gift_sub'
    | 'raid'
    | 'host'
    | 'bits'
    | 'superchat'
    | 'membership'
  user: {
    id: string
    displayName: string
    avatarUrl?: string
  }
  data: Record<string, unknown>
  timestamp: Date
}

// ============================================================
// Аккаунты и настройки
// ============================================================

export interface Account {
  id: string
  platform: Platform
  platformUserId: string
  username: string
  displayName: string
  avatarUrl?: string
  scopes: string[]
  createdAt: number
  updatedAt: number
}

// ============================================================
// Chat layout (combined / split)
// ============================================================

export interface SplitConfig {
  id: string
  type: 'combined' | 'channel'
  channelId?: string
  size: number
}

export interface ChatLayout {
  /** literal 1 for migration safety */
  version: 1
  mode: 'combined' | 'split'
  splits: SplitConfig[]
}

export interface SelfPingConfig {
  /** Highlight messages that mention the user's own platform nickname */
  enabled: boolean
  /** Background color applied to self-ping messages (CSS color string) */
  color: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  chatTheme: 'modern' | 'compact'
  fontFamily: 'inter' | 'manrope' | 'system'
  fontSize: number
  showPlatformColorStripe: boolean
  showPlatformIcon: boolean
  showTimestamp: boolean
  showAvatars: boolean
  showBadges: boolean
  platformFilter: Platform[] | 'all'
  overlay: OverlayConfig
  /** Auto-check for updates on startup */
  autoCheckUpdates?: boolean
  /** Chat layout configuration (combined / split) */
  chatLayout?: ChatLayout
  /** Self-ping highlight settings */
  selfPing?: SelfPingConfig
}

export interface OverlayConfig {
  background: string
  textColor: string
  fontSize: number
  fontFamily: string
  maxMessages: number
  messageTimeout: number
  showPlatformIcon: boolean
  showAvatar: boolean
  showBadges: boolean
  animation: 'slide' | 'fade' | 'none'
  position: 'bottom' | 'top'
  port: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  chatTheme: 'modern',
  fontFamily: 'inter',
  fontSize: 14,
  overlay: {
    animation: 'slide',
    background: 'transparent',
    fontFamily: 'inter',
    fontSize: 14,
    maxMessages: 20,
    messageTimeout: 0,
    port: 45823,
    position: 'bottom',
    showAvatar: true,
    showBadges: true,
    showPlatformIcon: true,
    textColor: '#ffffff',
  },
  platformFilter: 'all',
  showAvatars: true,
  showBadges: true,
  showPlatformColorStripe: true,
  showPlatformIcon: true,
  showTimestamp: true,
  theme: 'dark',
  chatLayout: {
    version: 1,
    mode: 'combined',
    splits: [{ id: 'default', type: 'combined', size: 100 }],
  },
  selfPing: {
    enabled: true,
    color: 'rgba(167, 139, 250, 0.15)',
  },
}

// ============================================================
// Статус трансляции
// ============================================================

export interface StreamStatus {
  platform: Platform
  channelId: string
  isLive: boolean
  title: string
  categoryId?: string
  categoryName?: string
  viewerCount?: number
}

// ============================================================
// Статус платформы
// ============================================================

export type PlatformStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export interface PlatformStatusInfo {
  platform: Platform
  status: PlatformStatus
  error?: string
  /** Anonymous = слушаем без OAuth */
  mode: 'anonymous' | 'authenticated'
  /** The channel login name this adapter is connected to (lowercase) */
  channelLogin?: string
}

// ============================================================
// Watched Channels
// ============================================================

export interface WatchedChannel {
  id: string
  platform: 'twitch' | 'kick' | 'youtube'
  channelSlug: string
  displayName: string
  createdAt: number
}

// ============================================================
// Hierarchical Layout Tree (v2)
// ============================================================

export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  children: LayoutNode[]
  flex: number // 0-100
  minSize?: number // default 48
}

export type PanelContent =
  | { type: 'main' }
  | { type: 'watched'; channelId: string }
  | { type: 'empty' }

export interface PanelNode {
  type: 'panel'
  id: string
  content: PanelContent
  flex: number
}

export type LayoutNode = SplitNode | PanelNode

// Legacy flat format (for migration)
export interface LegacySplitConfig {
  id: string
  type: 'combined' | 'channel'
  channelId?: string
  size: number
}

export interface LegacyChatLayout {
  version: 1
  mode: 'combined' | 'split'
  splits: LegacySplitConfig[]
}

// New hierarchical format
export interface WatchedChannelsLayout {
  version: 2
  root: LayoutNode
  meta?: {
    createdAt: number
    updatedAt: number
    migratedFrom?: 'legacy'
  }
}

// ============================================================
// Twitch Badges API
// ============================================================

/** Ответ от GET /api/twitch/badges?broadcasterLogin=<login> */
export interface TwitchBadgesResponse {
  /** "setId/version" → imageUrl, например "subscriber/6" → "https://..." */
  badges: Record<string, string>
}
