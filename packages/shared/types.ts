import { OVERLAY_SERVER_PORT } from './constants'

// ============================================================
// Общие типы платформ
// ============================================================

export type Platform = 'twitch' | 'youtube' | 'kick' | 'vkplay'

export type ChatSendReceipt =
  | { channelId: string; messageId?: string; held?: never }
  | { channelId: string; messageId?: never; held: true }

export interface Badge {
  id: string
  type: string
  text: string
  description?: string
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
  source?: 'channel' | 'seventv' | 'collectibles' | 'global' | 'bttv' | 'ffz' | 'personal'
  provider?: 'twitch' | 'seventv' | 'bttv' | 'ffz'
  animated?: boolean
  zeroWidth?: boolean
  modifier?: boolean
}

// ============================================================
// Нормализованные сообщения и события
// ============================================================

export interface TwitchChatNotice {
  kind:
    | 'sub'
    | 'resub'
    | 'gift_sub'
    | 'community_gift'
    | 'raid'
    | 'reward_gift'
    | 'moderation'
    | 'modiversary'
    | 'watch_streak'
  detail?: string
}

export type TwitchNoticeKind = TwitchChatNotice['kind']

export type SevenTvSystemAction = 'added' | 'removed' | 'changed'

export interface NormalizedChatMessage {
  id: string
  /** Desktop history ID superseded by this Twitch message. */
  localTwitchEchoId?: string
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
  metadata?: {
    firstMessage?: boolean
    returningChatter?: boolean
    highlighted?: boolean
    rewardId?: string
    rewardTitle?: string
    bits?: number
    announcement?: string
    twitchNotice?: TwitchChatNotice
    /** What a 7TV system row reports, so its styling never depends on translated text. */
    sevenTvAction?: SevenTvSystemAction
    subscriptionMonths?: number
    rewardCost?: number
    flags?: Record<string, boolean>
    clientDetection?: string
    sharedChat?: {
      sourceChannelId: string
      sourceMessageId?: string
    }
  }
  reply?: {
    parentMessageId: string
    parentMessageText: string
    threadRootMessageId?: string
    parentAuthor: {
      id: string
      username: string
      displayName: string
    }
  }
  /** @deprecated Legacy desktop delivery state retained for compatibility. */
  delivery?: {
    state: 'pending' | 'confirmed' | 'failed'
    error?: string
  }
}

export type ModerationAction = 'delete_message' | 'timeout' | 'ban'

// A live moderation notification, emitted separately from chat messages. It
// stays session-only so persisted message history remains provider-authored.
export interface ModerationOutcome {
  platform: Platform
  channelId: string
  action: ModerationAction
  messageId?: string
  targetUserId?: string
  durationSeconds?: number
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

export interface HotkeySettings {
  /** Open Add Channel modal */
  newTab: string
  /** Cycle to next watched-channel tab */
  nextTab: string
  /** Cycle to previous watched-channel tab */
  prevTab: string
  /** Open fuzzy tab selector modal */
  tabSelector: string
}

export type ThemePreset =
  | 'dark'
  | 'light'
  | 'midnight'
  | 'ocean'
  | 'forest'
  | 'ember'
  | 'rose'
  | 'paper'
  | 'aura'
  | 'ayu'
  | 'carbonfox'
  | 'cobalt2'
  | 'cursor'
  | 'dracula'
  | 'everforest'
  | 'flexoki'
  | 'catppuccin'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'github'
  | 'gruvbox'
  | 'kanagawa'
  | 'material'
  | 'matrix'
  | 'mercury'
  | 'monokai'
  | 'nightowl'
  | 'nord'
  | 'one-dark'
  | 'opencode'
  | 'orng'
  | 'lucent-orng'
  | 'osaka-jade'
  | 'palenight'
  | 'rosepine'
  | 'solarized'
  | 'synthwave84'
  | 'tokyonight'
  | 'vercel'
  | 'vesper'
  | 'zenburn'

export type ThemeMode = 'dark' | 'light'

export interface CustomPalette {
  readonly background: string
  readonly surface: string
  readonly text: string
  readonly muted: string
  readonly accent: string
}

/** Supported UI languages. */
export type Language = 'en' | 'ru'

/** Message timestamp formats supported by the desktop chat. */
export type TimestampFormat = 'HH:MM:SS' | 'HH:MM' | 'HH:MM:SS.sss' | 'hh:MM A' | 'hh:MM:SS A'

export interface AppSettings {
  /** UI language; new installs start in English. */
  language: Language
  theme: ThemePreset | 'custom'
  themeMode: ThemeMode
  customPalette?: CustomPalette
  chatTheme: 'modern' | 'compact'
  fontFamily: 'inter' | 'manrope' | 'system'
  fontSize: number
  showPlatformColorStripe: boolean
  showPlatformIcon: boolean
  showTimestamp: boolean
  timestampFormat: TimestampFormat
  /** Double-clicking a chat message starts a reply to it. */
  replyOnDoubleClick: boolean
  showAvatars: boolean
  showBadges: boolean
  showChannelLabel: boolean
  showModerationRail?: boolean
  emoteSessionCache: boolean
  platformFilter: Platform[] | 'all'
  hotkeys: HotkeySettings
  overlay: OverlayConfig
  /** Auto-check for updates on startup */
  autoCheckUpdates?: boolean
  twirIntegrationEnabled?: boolean
  jeetbotIntegrationEnabled?: boolean
  fossabotIntegrationEnabled?: boolean
  nightbotIntegrationEnabled?: boolean
  potatIntegrationEnabled?: boolean
  supibotIntegrationEnabled?: boolean
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
  language: 'en',
  fontFamily: 'inter',
  fontSize: 14,
  hotkeys: {
    newTab: 'ctrl+t',
    nextTab: 'ctrl+tab',
    prevTab: 'alt+arrowleft',
    tabSelector: 'ctrl+l',
  },
  overlay: {
    animation: 'slide',
    background: 'transparent',
    fontFamily: 'inter',
    fontSize: 14,
    maxMessages: 20,
    messageTimeout: 0,
    port: OVERLAY_SERVER_PORT,
    position: 'bottom',
    showAvatar: true,
    showBadges: true,
    showPlatformIcon: true,
    textColor: '#ffffff',
  },
  platformFilter: 'all',
  showAvatars: true,
  showBadges: true,
  showChannelLabel: true,
  showModerationRail: true,
  emoteSessionCache: true,
  showPlatformColorStripe: true,
  showPlatformIcon: true,
  showTimestamp: true,
  timestampFormat: 'HH:MM:SS',
  replyOnDoubleClick: true,
  theme: 'dark',
  themeMode: 'dark',
  twirIntegrationEnabled: true,
  jeetbotIntegrationEnabled: true,
  fossabotIntegrationEnabled: true,
  nightbotIntegrationEnabled: true,
  potatIntegrationEnabled: true,
  supibotIntegrationEnabled: true,
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
  /** Canonical message channel ID; Kick uses the broadcaster user ID. */
  channelId?: string
}

// ============================================================
// Watched Channels
// ============================================================

export interface WatchedChannel {
  id: string
  platform: 'twitch' | 'kick' | 'youtube' | 'vkplay'
  channelSlug: string
  displayName: string
  createdAt: number
  /** Saved account this chat signs in and sends with; absent uses the platform's default account. */
  accountId?: string
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

export interface WatchedPaneSource {
  channelId: string
  /** The saved account this pane sends with; absent follows the chat's account. */
  accountId?: string
}

export type PanelContent =
  | { type: 'main' }
  | ({ type: 'watched' } & WatchedPaneSource)
  | { type: 'feed'; sources: WatchedPaneSource[] }
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
  badgeMetadata?: Record<string, { title: string; description: string }>
}
