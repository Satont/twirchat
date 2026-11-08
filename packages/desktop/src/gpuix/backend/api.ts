import {
  PLATFORM_COMMAND_NAMES,
  type PlatformCommandResult,
  type RoomState,
} from '@twirchat/shared/channel-tools'
import { logger } from '@twirchat/shared/logger'
import type {
  ChannelStatusRequest,
  ChannelsStatusResponse,
  EmoteCatalogEntry,
  SearchCategoriesResponse,
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  UserCardMetadataRequest,
  UserCardMetadataResponse,
} from '@twirchat/shared/protocol'
import type {
  TwitchActivitiesSnapshot,
  TwitchActivityAction,
  TwitchRedemptionsPage,
  TwitchFollowingPage,
  TwitchWebSessionStatus,
} from '@twirchat/shared/twitch-activities'
/** UI request boundary; stores, credentials and platform adapters stay backend-owned. */
import type {
  TwitchActivitySnapshotPart,
  TwitchActivityCapability,
  TwitchRewardQueueSummary,
} from '@twirchat/shared/twitch-activities'
import type {
  Account,
  ChatSendReceipt,
  AppSettings,
  LayoutNode,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  SplitDirection,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
import type {
  ModerationSettings,
  UserProfileRequest,
  UserProfileSnapshot,
} from '@twirchat/shared/user-profile'
import { z } from 'zod'

import {
  getKickAuthUrl,
  getTwitchAuthUrl,
  getYouTubeAuthUrl,
  prepareKickAuth,
  prepareTwitchAuth,
  prepareYouTubeAuth,
} from '../../auth'
import type { BackendConnection } from '../../backend-connection'
import { APP_VERSION } from '../../build-info'
import type { ChatAggregator } from '../../chat/aggregator'
import { KickAdapter } from '../../platforms/kick/adapter'
import type { PluginTransportInfo } from '../../plugins/api'
import { backendFetch } from '../../runtime-config'
import type { AccountSessions } from '../../services/account-sessions'
import type { ChannelActions, PlayerSettings } from '../../services/channel-actions'
import {
  getUserCosmetics,
  getPaintNameImage,
  type UserCosmetics,
  type CosmeticPaint,
} from '../../services/cosmetics'
import { getProviderErrors } from '../../services/emote-providers'
import {
  readClipboardUploadFile,
  type ClipboardImageUpload,
  type ClipboardUploadImage,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import {
  resolveMentionUser,
  type MentionUser,
  type MentionUserRequest,
} from '../../services/mention-user'
import { createDesktopProviderRuntime, type ProviderRuntime } from '../../services/provider-runtime'
import { createSnapshotRequests } from '../../services/snapshot-requests'
import type {
  StreamerMode,
  StreamerModeService,
  StreamerModeSettings,
  StreamerModeStatus,
} from '../../services/streamer-mode'
import { systemIntegration } from '../../services/system-integration'
import {
  createTwirCommandsClient,
  type TwirCommand,
  type TwirCommandsOptions,
  type TwirCommandTarget,
} from '../../services/twir-commands'
import type { TwitchActivityRefreshClient } from '../../services/twitch-activity-refresh'
import type { TwitchEventSubClient } from '../../services/twitch-eventsub'
import { sevenTVService } from '../../seventv'
import type { UserChatHistoryCursor, UserChatHistoryPage } from '../../shared/rpc'
import {
  AccountStore,
  ChannelStore,
  MessageStore,
  SettingsStore,
  UsernameColorCache,
} from '../../store'
import { TwitchWebSessionStore } from '../../store/twitch-web-session-store'
import { UserAliasStore } from '../../store/user-alias-store'
import { WatchedChannelsLayoutStore } from '../../store/watched-channels-layout-store'
import { mergeChatMessageSnapshot } from '../../views/main/utils/chat-message-buffer'
import type { WatchedChannelManager } from '../../watched-channels/manager'
import {
  isPluginPlatform,
  type DesktopWatchedChannel,
  type WatchedPlatform,
} from '../../watched-channels/plugin-channel-types'
import type { PluginChannels } from '../../watched-channels/plugin-channels'
import {
  twitchActivitiesSnapshotSchema,
  twitchRewardQueueSummarySchema,
  twitchRedemptionsPageSchema,
  twitchFollowingPageSchema,
  twitchWebSessionSchema,
  platformCommandResultSchema,
  roomStateSchema,
  streamStatusResponseSchema,
  updateStreamResponseSchema,
  searchCategoriesResponseSchema,
  channelsStatusResponseSchema,
  userProfileSnapshotSchema,
  userCardMetadataResponseSchema,
  twitchChattersSchema,
  kickChatroomSchema,
  kickChattersSchema,
} from './api-schemas'
import {
  getChatHistory as readChatHistory,
  getChatLoggingSettings as readChatLoggingSettings,
  saveChatLoggingSettings as writeChatLoggingSettings,
  exportChatHistory as writeChatHistoryExport,
  getChatLoggingStatus as readChatLoggingStatus,
  flushChatLogs as flushRecordedChatLogs,
  type ChatHistoryQuery,
  type ChatLoggingSettings,
} from './chat-history'
import type { DesktopEvents } from './events'
import * as imageUploader from './image-uploader'
import { createLayoutApi } from './layout-api'
import { readCachedReleaseNotes, writeCachedReleaseNotes } from './release-notes-cache'
import { createStreamerModeApi } from './streamer-mode-api'
import * as translation from './translation'
import type {
  TranslationSettings,
  TranslationSettingsView,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
  TranslationLanguage,
} from './translation'
import type { TwitchHistoryRuntime } from './twitch-history'
import { createUpdater } from './updater'
import {
  getUserNotes,
  setUserNotes,
  getModerationSettings,
  saveModerationSettings,
} from './user-preferences'

const log = logger('gpuix-backend')
const platformCommands = new Set<string>(PLATFORM_COMMAND_NAMES)

const githubReleaseSchema = z.object({
  tag_name: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
})

export interface UserAlias {
  platform: Platform
  platformUserId: string
  alias: string
  createdAt: number
  updatedAt: number
}

export type ModerationPlatform = 'twitch' | 'kick'
export type ModerationAction = 'delete_message' | 'timeout' | 'ban'
export type ChatterRole = 'broadcaster' | 'moderators' | 'vips' | 'ogs' | 'bots' | 'chatters'

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
}

export interface ChannelChatters {
  platform: 'twitch' | 'kick'
  channelSlug: string
  total: number
  groups: ChatterGroup[]
  error?: string
}

export interface DesktopApi {
  getStreamerMode(): Promise<StreamerModeStatus>
  setStreamerMode(params: { mode: StreamerMode | 'toggle' }): Promise<StreamerModeStatus>
  getStreamerModeSettings(): Promise<StreamerModeSettings>
  setStreamerModeSettings(params: { settings: StreamerModeSettings }): Promise<StreamerModeStatus>
  reconnectChat(params: { watchedChannelId?: string; platform?: Platform }): Promise<void>
  reloadChatEmotes(params: {
    platform: Platform
    channelSlug: string
    kind?: 'channel' | 'subscriber'
  }): Promise<void>
  openChannelPlayer(params: {
    platform: Platform
    channelSlug: string
    mode: 'browser' | 'custom' | 'streamlink'
  }): Promise<void>
  getPlayerSettings(): Promise<PlayerSettings>
  savePlayerSettings(params: { settings: PlayerSettings }): Promise<void>
  setProviderActiveChannel(
    params: { platform: Platform; channelId: string; channelSlug?: string } | null,
  ): Promise<void>
  getImageUploaderSettings(): Promise<ImageUploaderSettings>
  saveImageUploaderSettings(settings: ImageUploaderSettings): Promise<ImageUploaderSettings>
  connectTwirImageUploader(params: { signal: AbortSignal }): Promise<ImageUploaderSettings>
  disconnectTwirImageUploader(): Promise<ImageUploaderSettings>
  readClipboardUploadFile(path: string): Promise<ClipboardUploadImage | null>
  uploadClipboardImage(request: ClipboardImageUpload): Promise<ImageUploadResult>
  getTranslationSettings(): Promise<TranslationSettingsView>
  saveTranslationSettings(settings: TranslationSettings): Promise<TranslationSettingsView>
  setTranslationCredential(params: {
    provider: TranslationProvider
    key: string
  }): Promise<TranslationSettingsView>
  removeTranslationCredential(params: {
    provider: TranslationProvider
  }): Promise<TranslationSettingsView>
  translateText(request: TranslationRequest): Promise<TranslationResult>
  getTranslationLanguages(params?: {
    provider?: TranslationProvider
  }): Promise<TranslationLanguage[]>
  getChatHistory(query: ChatHistoryQuery): Promise<UserChatHistoryPage>
  getChatLoggingSettings(): Promise<ChatLoggingSettings>
  saveChatLoggingSettings(settings: ChatLoggingSettings): Promise<void>
  exportChatHistory(params: {
    query: ChatHistoryQuery
    path: string
  }): Promise<{ path: string; count: number; history?: UserChatHistoryPage['history'] }>
  getChatLoggingStatus(): Promise<{ error: string | null; queued: number }>
  flushChatLogs(): Promise<void>
  getTwitchActivities(params: {
    channelSlug: string
    sections?: TwitchActivitySnapshotPart[]
  }): Promise<TwitchActivitiesSnapshot>
  getTwitchActivityCapability(params: { channelSlug: string }): Promise<TwitchActivityCapability>
  getTwitchRewardQueueSummary(params: { channelSlug: string }): Promise<TwitchRewardQueueSummary>
  executeTwitchActivityAction(params: TwitchActivityAction): Promise<{ message?: string }>
  getTwitchRewardRedemptions(params: {
    channelSlug: string
    rewardId?: string
    status?: string
    cursor?: string
    order?: 'NEWEST' | 'OLDEST'
  }): Promise<TwitchRedemptionsPage>
  getTwitchFollowing(params?: { liveOnly?: boolean; cursor?: string }): Promise<TwitchFollowingPage>
  setTwitchWebSession(params: { token: string }): Promise<TwitchWebSessionStatus>
  getTwitchWebSessionStatus(): Promise<TwitchWebSessionStatus>
  clearTwitchWebSession(): Promise<void>
  watchTwitchActivities(params: { channelSlug: string; watch: boolean }): Promise<void>
  executePlatformCommand(params: {
    platform: Platform
    channelSlug: string
    text: string
  }): Promise<PlatformCommandResult>
  getChannelRoomState(params: { platform: Platform; channelSlug: string }): Promise<RoomState>
  getAccounts(): Promise<Account[]>
  getSavedAccounts(): Promise<Account[]>
  setActiveAccount(params: { platform: Platform; accountId: string | null }): Promise<void>
  forgetAccount(params: { accountId: string }): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(params: AppSettings): Promise<void>
  getTwirCommands(
    target: TwirCommandTarget,
    options?: TwirCommandsOptions,
  ): Promise<readonly TwirCommand[]>
  getUserAliases(): Promise<UserAlias[]>
  setUserAlias(params: { platform: Platform; platformUserId: string; alias: string }): Promise<void>
  removeUserAlias(params: { platform: Platform; platformUserId: string }): Promise<void>
  getChannels(): Promise<Partial<Record<Platform, string[]>>>
  authStart(params: { platform: Platform }): Promise<void>
  authLogout(params: { platform: Platform }): Promise<void>
  joinChannel(params: { platform: Platform; channelSlug: string }): Promise<void>
  leaveChannel(params: { platform: Platform; channelSlug: string }): Promise<void>
  sendMessage(params: {
    platform: Platform
    channelId: string
    text: string
    replyToMessageId?: string
  }): Promise<void | ChatSendReceipt>
  resolveAvatar(params: {
    platform: ModerationPlatform
    authorId: string
    username?: string
  }): Promise<{ avatarUrl?: string }>
  getModerationCapabilities(params: {
    platform: ModerationPlatform
    channelSlug: string
  }): Promise<{ canModerate: boolean }>
  moderateMessage(params: {
    platform: ModerationPlatform
    channelSlug: string
    messageId: string
    targetUserId: string
    action: ModerationAction
    durationSeconds?: number
  }): Promise<{ success: boolean }>
  getStreamStatus(params: {
    platform: 'twitch' | 'kick'
    channelId: string
  }): Promise<StreamStatusResponse>
  updateStream(params: Omit<UpdateStreamRequest, 'userAccessToken'>): Promise<UpdateStreamResponse>
  searchCategories(params: {
    platform: 'twitch' | 'kick'
    query: string
  }): Promise<SearchCategoriesResponse>
  getChannelsStatus(params: { channels: ChannelStatusRequest[] }): Promise<ChannelsStatusResponse>
  getRecentMessages(params?: { limit?: number }): Promise<NormalizedChatMessage[]>
  getUserChatHistory(params: {
    platform: Platform
    platformUserId: string
    channelId?: string
    username?: string
    limit?: number
    cursor?: UserChatHistoryCursor
  }): Promise<UserChatHistoryPage>
  getUserCardMetadata(params: UserCardMetadataRequest): Promise<UserCardMetadataResponse>
  getUserProfile(params: UserProfileRequest): Promise<UserProfileSnapshot>
  getUserNotes(params: { platform: Platform; platformUserId: string }): Promise<string>
  setUserNotes(params: { platform: Platform; platformUserId: string; text: string }): Promise<void>
  getModerationSettings(): Promise<ModerationSettings>
  saveModerationSettings(settings: ModerationSettings): Promise<void>
  getStatuses(): Promise<PlatformStatusInfo[]>
  getUsernameColor(params: { platform: Platform; username: string }): Promise<string | null>
  resolveMentionUser(params: MentionUserRequest): Promise<MentionUser | null>
  getChannelEmotes(params: { platform: Platform; channelId: string }): Promise<EmoteCatalogEntry[]>
  getEmoteProviderErrors(): Promise<Array<{ url: string; error: string }>>
  getUserCosmetics(params: {
    platform: Platform
    platformUserId: string
    username?: string
  }): Promise<UserCosmetics | null>
  getPaintNameImage(params: {
    name: string
    paint: CosmeticPaint
    fontSize?: number
    fontFamily?: string
  }): Promise<{ path: string; width: number; height: number }>
  /** Velopack updater; dev/unpackaged builds always report "no update". */
  getAppVersion(): Promise<string>
  checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string; currentVersion: string }>
  downloadUpdate(): Promise<{ success: boolean; error?: string }>
  applyUpdate(): Promise<void>
  skipUpdate(params: { hash: string }): Promise<void>
  getWatchedChannels(): Promise<DesktopWatchedChannel[]>
  setActiveWatchedChannels(params: { ids: string[] }): Promise<void>
  addWatchedChannel(params: {
    platform: WatchedPlatform
    channelSlug: string
  }): Promise<DesktopWatchedChannel>
  removeWatchedChannel(params: { id: string }): Promise<void>
  getWatchedChannelMessages(params: { id: string }): Promise<NormalizedChatMessage[]>
  sendWatchedChannelMessage(params: {
    id: string
    text: string
    replyToMessageId?: string
  }): Promise<void | ChatSendReceipt>
  getWatchedChannelStatuses(): Promise<Array<{ channelId: string; status: PlatformStatusInfo }>>
  getPluginTransports(): readonly PluginTransportInfo[]
  observePluginChannel: PluginChannels['observe']
  sendPluginChannelMessage(params: { id: string; text: string }): Promise<void>
  getChatters(params: { targets: ChattersTarget[] }): Promise<{ results: ChannelChatters[] }>
  openExternalUrl(params: { url: string }): Promise<void>
  /** GPUIX-only: generic UI preference stored in the settings KV table. */
  getUiState(params: { key: string }): Promise<string | null>
  setUiState(params: { key: string; value: string }): Promise<void>
  /** Get the last seen app version (for update changelog). */
  getLastSeenVersion(): Promise<string | null>
  /** Set the last seen app version. */
  setLastSeenVersion(params: { version: string }): Promise<void>
  /** Fetch release notes for a specific version from GitHub. */
  getReleaseNotes(params: { version: string }): Promise<{
    version: string
    releaseNotes: string
    publishedAt: string
    htmlUrl: string
  } | null>
  /** GPUIX-only: write to the system clipboard (GPUIX exposes no clipboard API). */
  copyText(params: { text: string }): Promise<void>
  readClipboard(): Promise<string>
  notify(params: {
    title: string
    body: string
    sound?: boolean
    soundPath?: string
    silent?: boolean
  }): Promise<void>
  getTabChannelIds(): Promise<string[] | null>
  setTabChannelIds(params: { ids: string[] }): Promise<void>
  getWatchedChannelsLayout(params: { tabId: string }): Promise<WatchedChannelsLayout | null>
  setWatchedChannelsLayout(params: { tabId: string; layout: WatchedChannelsLayout }): Promise<void>
  removeWatchedChannelsLayout(params: { tabId: string }): Promise<void>
  removePanel(params: { tabId: string; panelId: string }): Promise<void>
  assignChannelToPanel(params: {
    tabId: string
    panelId: string
    channelId: string | null
  }): Promise<void>
  splitPanel(params: {
    tabId: string
    panelId: string
    direction: SplitDirection
  }): Promise<{ original: LayoutNode; newPanel: LayoutNode }>
}

export interface DesktopApiContext {
  twitchHistory?: TwitchHistoryRuntime
  streamerMode?: StreamerModeService
  channelActions?: ChannelActions
  accountSessions?: AccountSessions
  providerRuntime?: ProviderRuntime
  twitchActivityRefresh?: TwitchActivityRefreshClient
  twitchEventSub?: TwitchEventSubClient
  aggregator: ChatAggregator
  backendConn: BackendConnection
  watchedChannelManager: WatchedChannelManager
  pluginChannels?: PluginChannels
  onUiStateSaved?: (key: string, value: string) => void
  currentStatuses: Map<string, PlatformStatusInfo>
  events: DesktopEvents
  openBrowser: (url: string) => void
}

const activitySnapshots = createSnapshotRequests<TwitchActivitiesSnapshot>(2)

async function prepareTwitchActivitiesRequest(
  operation: string,
  params: Record<string, unknown> = {},
) {
  let credentials: Record<string, unknown> = {}
  let selectedAccountId: string | null = null
  const checkIdentity = () => {
    if (selectedAccountId && AccountStore.findByPlatform('twitch')?.id !== selectedAccountId)
      throw new Error(
        'The active Twitch account changed. Retry this action in the selected account.',
      )
  }
  if (operation !== 'validate_session') {
    const account = AccountStore.findByPlatform('twitch')
    const tokens = account ? AccountStore.getTokens(account.id) : null
    if (!account || !tokens?.accessToken)
      throw new Error('Connect your Twitch account on the Platforms tab first.')
    selectedAccountId = account.id
    credentials = {
      accessToken: tokens.accessToken,
      platformUserId: account.platformUserId,
      scopes: account.scopes,
      webSession: await TwitchWebSessionStore.get(),
    }
  }
  const run = async (): Promise<unknown> => {
    checkIdentity()
    const response = await backendFetch('/api/twitch/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, ...params, operation }),
    })
    if (!response.ok) throw await backendFailure('Twitch activity failed', response)
    const result: unknown = await response.json()
    checkIdentity()
    return result
  }
  const key = `${credentials.platformUserId}:${String(params.channelSlug).toLowerCase()}:${credentials.webSession ? 'web' : 'oauth'}`
  return { key, run }
}

export async function twitchActivitiesRequest<T>(
  operation: string,
  params: Record<string, unknown>,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const request = await prepareTwitchActivitiesRequest(operation, params)
  return responseSchema.parse(await request.run())
}

export async function requestTwitchActivitiesSnapshot(params: {
  channelSlug: string
  sections?: TwitchActivitySnapshotPart[]
}): Promise<TwitchActivitiesSnapshot> {
  const request = await prepareTwitchActivitiesRequest('snapshot', params)
  return activitySnapshots.request(request.key, params.sections, async () =>
    twitchActivitiesSnapshotSchema.parse(await request.run()),
  )
}

// ── Avatar resolution (port of internal/avatar/resolver.go) ────────────────

const AVATAR_POSITIVE_TTL_MS = 30 * 60 * 1000
const AVATAR_NEGATIVE_TTL_MS = 2 * 60 * 1000
const AVATAR_MAX_ENTRIES = 2000

interface AvatarCacheEntry {
  avatarUrl: string
  expiresAt: number
  createdAt: number
}

const avatarCache = new Map<string, AvatarCacheEntry>()
const avatarInFlight = new Map<string, Promise<{ avatarUrl?: string }>>()

async function resolveAvatarRemote(params: {
  platform: ModerationPlatform
  authorId: string
  username?: string
}): Promise<{ avatarUrl?: string }> {
  const key = `${params.platform}:${params.authorId}:${params.username ?? ''}`
  const now = Date.now()
  const cached = avatarCache.get(key)
  if (cached && now < cached.expiresAt) {
    return { avatarUrl: cached.avatarUrl || undefined }
  }
  if (cached) avatarCache.delete(key)

  const inFlight = avatarInFlight.get(key)
  if (inFlight) return inFlight

  const promise = (async (): Promise<{ avatarUrl?: string }> => {
    let avatarUrl = ''
    if (params.platform === 'twitch') {
      const res = await backendFetch(
        `/api/twitch/user?userId=${encodeURIComponent(params.authorId)}`,
      )
      if (res.ok) {
        const data = z
          .object({ user: z.object({ profile_image_url: z.string().optional() }).optional() })
          .parse(await res.json())
        avatarUrl = data.user?.profile_image_url?.trim() ?? ''
      }
    } else {
      const slug = params.username?.trim()
      if (slug) {
        const res = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(slug)}`)
        if (res.ok) {
          const data = kickChatroomSchema.parse(await res.json())
          avatarUrl = data.avatarUrl?.trim() ?? ''
        }
      }
    }
    return { avatarUrl: avatarUrl || undefined }
  })()

  avatarInFlight.set(key, promise)
  try {
    const result = await promise
    if (avatarCache.size >= AVATAR_MAX_ENTRIES) {
      let oldestKey: string | null = null
      let oldest = Infinity
      for (const [k, entry] of avatarCache) {
        if (entry.createdAt < oldest) {
          oldest = entry.createdAt
          oldestKey = k
        }
      }
      if (oldestKey) avatarCache.delete(oldestKey)
    }
    avatarCache.set(key, {
      avatarUrl: result.avatarUrl ?? '',
      createdAt: now,
      expiresAt: now + (result.avatarUrl ? AVATAR_POSITIVE_TTL_MS : AVATAR_NEGATIVE_TTL_MS),
    })
    return result
  } finally {
    avatarInFlight.delete(key)
  }
}

// ── Moderation (port of internal/bridge/moderation_handlers.go) ────────────

/**
 * Turns a failed backend response into a user-facing error: the route's
 * `{ error }` body when present, with expired platform OAuth called out.
 */
async function backendFailure(action: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = z.object({ error: z.string().optional() }).parse(await res.json())
    if (body?.error) detail = String(body.error).replace(/^Error:\s*/, '')
  } catch {
    // Non-JSON body — fall back to the status code.
  }
  if (res.status === 401 || /\b401\b|Invalid OAuth token|Unauthorized/i.test(detail)) {
    return new Error(
      `${action}: authorization expired — reconnect the account on the Platforms tab`,
    )
  }
  return new Error(detail ? `${action}: ${detail}` : `${action} (HTTP ${res.status})`)
}

async function moderationBody(platform: ModerationPlatform, channelSlug: string) {
  if (platform !== 'twitch' && platform !== 'kick') {
    throw new Error(`moderation: unsupported platform "${platform}"`)
  }
  if (!channelSlug) throw new Error('moderation: channel slug is required')

  const account = AccountStore.findByPlatform(platform)
  if (!account) {
    throw new Error(`moderation: authenticate with ${platform} before moderating`)
  }
  const tokens = AccountStore.getTokens(account.id)
  if (!tokens?.accessToken) {
    throw new Error(`moderation: ${platform} credentials are unavailable`)
  }
  return {
    platform,
    channelSlug,
    accessToken: tokens.accessToken,
    platformUserId: account.platformUserId,
    scopes: account.scopes,
  }
}

// ── Chatters (port of internal/platforms/{twitch,kick}/chatters.go) ────────

const KICK_ACTIVE_CHATTERS_URL = 'https://web.kick.com/api/v1/channels'

async function fetchTwitchChatters(channelSlug: string): Promise<ChannelChatters> {
  const account = AccountStore.findByPlatform('twitch')
  const tokens = account ? AccountStore.getTokens(account.id) : null
  if (!account || !tokens?.accessToken) {
    throw new Error('Connect a Twitch account with moderator access to see the chatters list.')
  }
  const res = await backendFetch('/api/twitch/chatters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: tokens.accessToken,
      broadcasterLogin: channelSlug,
      moderatorId: account.platformUserId,
    }),
  })
  if (!res.ok) {
    if (res.status === 401)
      throw new Error('Twitch rejected the credentials. Reconnect the account.')
    if (res.status === 403)
      throw new Error('Moderator access is required to see the chatters list.')
    if (res.status === 404) throw new Error('Channel not found on Twitch.')
    throw new Error('Twitch chatters are currently unavailable.')
  }
  const data = twitchChattersSchema.parse(await res.json())

  const broadcaster: ChatterGroup = { role: 'broadcaster', users: [] }
  const chatters: ChatterGroup = { role: 'chatters', users: [] }
  const seen = new Set<string>()
  for (const chatter of data.chatters ?? []) {
    const user: ChatterUser = {
      userId: chatter.userId,
      username: chatter.userLogin ?? '',
      displayName: chatter.userName ?? chatter.userLogin ?? '',
      avatarUrl: chatter.avatarUrl,
    }
    if (chatter.userId && chatter.userId === data.broadcasterId) {
      if (broadcaster.users.length === 0) broadcaster.users.push(user)
      continue
    }
    if (user.userId && seen.has(user.userId)) continue
    if (user.userId) seen.add(user.userId)
    chatters.users.push(user)
  }
  return {
    platform: 'twitch',
    channelSlug,
    total: broadcaster.users.length + chatters.users.length,
    groups: [broadcaster, chatters],
  }
}

async function fetchKickChatters(channelSlug: string): Promise<ChannelChatters> {
  // 1. Resolve the broadcaster id via the backend chatroom proxy.
  const roomRes = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(channelSlug)}`)
  if (!roomRes.ok) throw new Error('Kick chatters are currently unavailable.')
  const room = kickChatroomSchema.parse(await roomRes.json())
  const broadcasterId = room.broadcasterUserId ?? 0
  if (broadcasterId <= 0) throw new Error('Kick chatters are currently unavailable.')

  // 2. Hit Kick's web internal API directly (mirrors the Go service).
  const endpoint = `${KICK_ACTIVE_CHATTERS_URL}/${broadcasterId}/chat/active-chatters`
  const res = await fetch(endpoint, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${channelSlug}`,
    },
  })
  if (!res.ok) throw new Error('Kick chatters are currently unavailable.')
  const body = kickChattersSchema.parse(await res.json())
  const data = body.data
  if (!data) throw new Error('Kick chatters are currently unavailable.')

  const roles: ChatterRole[] = ['moderators', 'vips', 'ogs', 'bots', 'chatters']
  const lists = [data.moderators, data.vips, data.ogs, data.bots, data.chatters]
  const seen = new Set<string>()
  let total = 0
  const groups: ChatterGroup[] = roles.map((role, index) => {
    const users: ChatterUser[] = []
    for (const chatter of lists[index] ?? []) {
      const username = (chatter.slug ?? chatter.username ?? '').trim()
      if (!username) continue
      const key = username.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      users.push({
        username,
        displayName: (chatter.username ?? username).trim() || username,
        avatarUrl: chatter.profilePicture,
      })
      total += 1
    }
    return { role, users }
  })

  return { platform: 'kick', channelSlug, total, groups }
}

// ── API factory ─────────────────────────────────────────────────────────────

export function createDesktopApi(ctx: DesktopApiContext): DesktopApi {
  const { aggregator, backendConn, watchedChannelManager, currentStatuses } = ctx
  const updater = createUpdater(ctx.events)

  const getSevenTvTwitchPlatformUserId = (channelSlug: string): string | undefined => {
    const twitchAccount = AccountStore.findByPlatform('twitch')
    if (!twitchAccount) return undefined
    if (twitchAccount.username.toLowerCase() !== channelSlug.toLowerCase()) return undefined
    return twitchAccount.platformUserId
  }

  const subscribeSevenTv = (platform: Platform, channelSlug: string, adapter: unknown): void => {
    let sevenTvChannelId = channelSlug
    let sevenTvPlatformUserId: string | undefined
    if (platform === 'kick') {
      const broadcasterUserId =
        adapter instanceof KickAdapter ? adapter.getBroadcasterUserId() : undefined
      if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
    } else if (platform === 'twitch') {
      sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(channelSlug)
    }
    sevenTVService
      .subscribeToChannel(
        platform,
        sevenTvChannelId,
        [channelSlug],
        sevenTvPlatformUserId,
        `own:${platform}`,
      )
      .catch((error) => {
        log.error('Failed to subscribe to 7TV', {
          platform,
          channelSlug: sevenTvChannelId,
          error: String(error),
        })
      })
  }

  return {
    getTwirCommands: createTwirCommandsClient(),
    getTwitchActivities: async (params) => {
      const snapshot = await requestTwitchActivitiesSnapshot(params)
      ctx.twitchActivityRefresh?.observeSnapshot(snapshot)
      return snapshot
    },
    getTwitchRewardQueueSummary: (params) =>
      twitchActivitiesRequest('reward_queue_summary', params, twitchRewardQueueSummarySchema),
    getTwitchActivityCapability: async ({ channelSlug }) => {
      if (!ctx.twitchActivityRefresh) throw new Error('Twitch activities are not initialized.')
      return ctx.twitchActivityRefresh.capability(channelSlug)
    },
    executeTwitchActivityAction: (action) =>
      twitchActivitiesRequest('action', { action }, platformCommandResultSchema),
    getTwitchRewardRedemptions: (params) =>
      twitchActivitiesRequest('redemptions', params, twitchRedemptionsPageSchema),
    getTwitchFollowing: (params = {}) =>
      twitchActivitiesRequest('following', params, twitchFollowingPageSchema),
    getTwitchWebSessionStatus: () => TwitchWebSessionStore.status(),
    setTwitchWebSession: async ({ token }) => {
      const session = await twitchActivitiesRequest(
        'validate_session',
        { token },
        twitchWebSessionSchema,
      )
      const account = AccountStore.findByPlatform('twitch')
      if (account && account.platformUserId !== session.userId)
        throw new Error('Use a web session belonging to your connected Twitch account.')
      await TwitchWebSessionStore.set(session)
      ctx.twitchActivityRefresh?.restart()
      return TwitchWebSessionStore.status()
    },
    clearTwitchWebSession: async () => {
      await TwitchWebSessionStore.clear()
      ctx.twitchActivityRefresh?.restart()
    },
    watchTwitchActivities: async ({ channelSlug, watch }) => {
      if (!ctx.twitchEventSub) throw new Error('Twitch events are not initialized.')
      void ctx.twitchEventSub.watch(channelSlug, watch).catch(() =>
        ctx.events.emit('twitch_eventsub_status', {
          status: 'error',
          message: 'Could not update Twitch event subscriptions.',
        }),
      )
      await ctx.twitchActivityRefresh?.watch(channelSlug, watch)
    },
    ...createStreamerModeApi(ctx.streamerMode),
    reconnectChat: async (params) => {
      if (!ctx.channelActions) throw new Error('Chat reconnection is unavailable.')
      return ctx.channelActions.reconnectChat(params)
    },
    reloadChatEmotes: async (params) => {
      if (!ctx.channelActions) throw new Error('Emote reload is unavailable.')
      return ctx.channelActions.reloadChatEmotes(params)
    },
    openChannelPlayer: async (params) => {
      if (!ctx.channelActions) throw new Error('Channel players are unavailable.')
      return ctx.channelActions.openChannelPlayer(params)
    },
    getPlayerSettings: async () => {
      if (!ctx.channelActions) throw new Error('Player settings are unavailable.')
      return ctx.channelActions.getPlayerSettings()
    },
    savePlayerSettings: async ({ settings }) => {
      if (!ctx.channelActions) throw new Error('Player settings are unavailable.')
      return ctx.channelActions.savePlayerSettings(settings)
    },
    getAccounts: async () => AccountStore.findAllActive(),
    getSavedAccounts: async () => AccountStore.findAllSaved(),
    setActiveAccount: async ({ platform, accountId }) => {
      if (!ctx.accountSessions) throw new Error('Account switching is not initialized.')
      await ctx.accountSessions.select(platform, accountId)
    },
    forgetAccount: async ({ accountId }) => {
      if (!ctx.accountSessions) throw new Error('Account switching is not initialized.')
      await ctx.accountSessions.forget(accountId)
    },
    setProviderActiveChannel: async (params) => {
      ctx.providerRuntime?.setActiveChannel(params)
    },
    getImageUploaderSettings: imageUploader.getImageUploaderSettings,
    saveImageUploaderSettings: imageUploader.saveImageUploaderSettings,
    connectTwirImageUploader: imageUploader.connectTwirImageUploader,
    disconnectTwirImageUploader: imageUploader.disconnectTwirImageUploader,
    readClipboardUploadFile,
    uploadClipboardImage: imageUploader.uploadClipboardImage,
    getTranslationSettings: translation.getTranslationSettings,
    saveTranslationSettings: translation.saveTranslationSettings,
    setTranslationCredential: translation.setTranslationCredential,
    removeTranslationCredential: translation.removeTranslationCredential,
    translateText: translation.translateText,
    getTranslationLanguages: translation.getTranslationLanguages,
    getChatHistory: (query) => ctx.twitchHistory?.query(query) ?? readChatHistory(query),
    getChatLoggingSettings: () => readChatLoggingSettings(),
    saveChatLoggingSettings: (settings) => writeChatLoggingSettings(settings),
    exportChatHistory: (params) =>
      ctx.twitchHistory?.export(params) ?? writeChatHistoryExport(params),
    getChatLoggingStatus: () => readChatLoggingStatus(),
    flushChatLogs: () => flushRecordedChatLogs(),

    getSettings: async () => SettingsStore.get(),

    saveSettings: async (params) => {
      SettingsStore.set(params)
    },

    getUserAliases: async () => UserAliasStore.findAll(),

    setUserAlias: async ({ platform, platformUserId, alias }) => {
      if (!alias) {
        UserAliasStore.remove(platform, platformUserId)
      } else {
        UserAliasStore.upsert(platform, platformUserId, alias)
      }
    },

    removeUserAlias: async ({ platform, platformUserId }) => {
      UserAliasStore.remove(platform, platformUserId)
    },

    getChannels: async () => ChannelStore.findAll(),

    authStart: async ({ platform }) => {
      if (platform === 'twitch') {
        const { codeChallenge, state } = prepareTwitchAuth()
        const url = await getTwitchAuthUrl(codeChallenge, state)
        ctx.openBrowser(url)
      } else if (platform === 'kick') {
        const { codeChallenge, state } = prepareKickAuth()
        const url = await getKickAuthUrl(codeChallenge, state)
        ctx.openBrowser(url)
      } else if (platform === 'youtube') {
        const { codeChallenge, state } = prepareYouTubeAuth()
        const url = await getYouTubeAuthUrl(codeChallenge, state)
        ctx.openBrowser(url)
      } else {
        backendConn.send({ type: 'auth_start', platform })
      }
    },

    authLogout: async ({ platform }) => {
      if (!ctx.accountSessions) throw new Error('Account switching is not initialized.')
      await ctx.accountSessions.select(platform, null)
    },

    joinChannel: async ({ platform, channelSlug }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) {
        log.warn('No adapter registered for platform', { platform })
        return
      }
      ChannelStore.save(platform, channelSlug)
      ctx.providerRuntime?.setJoined(`own:${platform}`, platform, channelSlug)
      adapter
        .connect(channelSlug)
        .then(() => subscribeSevenTv(platform, channelSlug, adapter))
        .catch((err) => {
          log.error('Failed to connect', { platform, channelSlug, error: String(err) })
        })
    },

    leaveChannel: async ({ platform, channelSlug }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) return
      ChannelStore.remove(platform, channelSlug)
      ctx.providerRuntime?.setJoined(`own:${platform}`, platform, null)
      sevenTVService
        .unsubscribeFromChannel(platform, channelSlug, `own:${platform}`)
        .catch((err) => {
          log.error('Failed to unsubscribe from 7TV', { platform, channelSlug, error: String(err) })
        })
      adapter.disconnect().catch((err) => {
        log.error('Failed to disconnect', { platform, error: String(err) })
      })
    },

    sendMessage: async ({ platform, channelId, text, replyToMessageId }) => {
      const command = text
        .trim()
        .match(/^\/([a-z]+)/i)?.[1]
        ?.toLowerCase()
      if (command && platformCommands.has(command)) {
        throw new Error('Use the platform command handler for slash commands.')
      }
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) throw new Error(`No ${platform} chat adapter is connected.`)
      return adapter.sendMessage(channelId, text, replyToMessageId).catch((err) => {
        log.error('Failed to send message', { platform, error: String(err) })
        throw err
      })
    },

    resolveAvatar: async (params) => resolveAvatarRemote(params),

    executePlatformCommand: async ({ platform, channelSlug, text }) => {
      if (platform !== 'twitch' && platform !== 'kick')
        throw new Error(`Platform commands are unavailable for ${platform}.`)
      const body = await moderationBody(platform, channelSlug)
      const res = await backendFetch('/api/chat-tools/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, text }),
      })
      if (!res.ok) throw await backendFailure('Platform command failed', res)
      return platformCommandResultSchema.parse(await res.json())
    },

    getChannelRoomState: async ({ platform, channelSlug }) => {
      const own = aggregator.getAdapter(platform)?.getRoomState?.()
      const current =
        own?.channelId === channelSlug.toLowerCase()
          ? own
          : watchedChannelManager.getRoomState(platform, channelSlug)
      if (current) return current
      if (platform !== 'twitch') throw new Error(`Room settings are unavailable for ${platform}.`)
      const body = await moderationBody(platform, channelSlug)
      const res = await backendFetch('/api/chat-tools/room-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await backendFailure('Could not load chat settings', res)
      return roomStateSchema.parse(await res.json())
    },

    getModerationCapabilities: async ({ platform, channelSlug }) => {
      const body = await moderationBody(platform, channelSlug)
      const res = await backendFetch('/api/moderation/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await backendFailure("Couldn't check moderation permissions", res)
      return z.object({ canModerate: z.boolean() }).parse(await res.json())
    },

    moderateMessage: async (params) => {
      const body = await moderationBody(params.platform, params.channelSlug)
      const res = await backendFetch('/api/moderation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          messageId: params.messageId,
          targetUserId: params.targetUserId,
          action: params.action,
          durationSeconds: params.durationSeconds,
        }),
      })
      if (!res.ok) throw await backendFailure('Moderation action failed', res)
      const result = z
        .object({
          success: z.boolean(),
          error: z.object({ message: z.string().optional() }).optional(),
        })
        .parse(await res.json())
      if (!result.success) {
        throw new Error(result.error?.message || 'moderation action was rejected')
      }
      return { success: true }
    },

    getStreamStatus: async ({ platform, channelId }) => {
      const res = await backendFetch(
        `/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
      )
      if (!res.ok) throw await backendFailure("Couldn't load stream info", res)
      return streamStatusResponseSchema.parse(await res.json())
    },

    updateStream: async (params) => {
      const account = AccountStore.findByPlatform(params.platform)
      if (!account) throw new Error(`No ${params.platform} account found`)
      const tokens = AccountStore.getTokens(account.id)
      if (!tokens?.accessToken) throw new Error(`No access token for ${params.platform}`)

      const body: UpdateStreamRequest = { ...params, userAccessToken: tokens.accessToken }
      const res = await backendFetch(`/api/update-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await backendFailure("Couldn't update the stream", res)
      return updateStreamResponseSchema.parse(await res.json())
    },

    searchCategories: async ({ platform, query }) => {
      const res = await backendFetch(
        `/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
      )
      if (!res.ok) throw await backendFailure('Category search failed', res)
      return searchCategoriesResponseSchema.parse(await res.json())
    },

    getChannelsStatus: async ({ channels }) => {
      const enriched = channels.map((ch) => {
        const account = AccountStore.findByPlatform(ch.platform)
        if (account) {
          const tokens = AccountStore.getTokens(account.id)
          if (tokens?.accessToken) {
            return { ...ch, userAccessToken: tokens.accessToken }
          }
        }
        return ch
      })

      const res = await backendFetch(`/api/channels-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: enriched }),
      })
      if (!res.ok) throw await backendFailure("Couldn't load channel status", res)
      return channelsStatusResponseSchema.parse(await res.json())
    },

    getRecentMessages: async (params) => {
      const account = AccountStore.findByPlatform('twitch')
      if (account)
        void ctx.twitchHistory
          ?.refresh(account.username)
          .catch((error) => log.debug('Twitch history unavailable', { error: String(error) }))
      return MessageStore.getRecent(params?.limit ?? 100)
    },

    getUserChatHistory: async ({
      platform,
      platformUserId,
      channelId,
      username,
      limit,
      cursor,
    }) => {
      const query = { platform, channelId, authorId: platformUserId, limit: limit ?? 50, cursor }
      return ctx.twitchHistory?.query(query, username) ?? readChatHistory(query)
    },

    getUserProfile: async (params) => {
      const account = AccountStore.findByPlatform('twitch')
      const tokens = account ? AccountStore.getTokens(account.id) : undefined
      const twitchAuth =
        account && tokens?.accessToken
          ? {
              accessToken: tokens.accessToken,
              platformUserId: account.platformUserId,
              scopes: account.scopes,
            }
          : undefined
      const response = await backendFetch('/api/user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, twitchAuth }),
      })
      if (!response.ok) throw await backendFailure('Could not load user profile', response)
      return userProfileSnapshotSchema.parse(await response.json())
    },
    getUserNotes: async (params) => getUserNotes(params),
    setUserNotes: async (params) => setUserNotes(params),
    getModerationSettings: async () => getModerationSettings(),
    saveModerationSettings: async (settings) => saveModerationSettings(settings),

    getUserCardMetadata: async ({ platform, platformUserId, username, channelId, channelSlug }) => {
      const body: Record<string, unknown> = {
        platform,
        platformUserId,
        username,
        channelId,
        channelSlug,
      }
      const account = AccountStore.findByPlatform(platform)
      if (platform === 'twitch' && account) {
        const tokens = AccountStore.getTokens(account.id)
        if (tokens?.accessToken) {
          body['twitchAuth'] = {
            accessToken: tokens.accessToken,
            platformUserId: account.platformUserId,
            scopes: account.scopes,
          }
        }
      }
      const res = await backendFetch('/api/user-card-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw await backendFailure("Couldn't load account details", res)
      return userCardMetadataResponseSchema.parse(await res.json())
    },

    getStatuses: async () => [...currentStatuses.values()],

    getUsernameColor: async ({ platform, username }) => {
      return UsernameColorCache.get(platform, username) ?? null
    },
    resolveMentionUser,

    getChannelEmotes: async ({ platform, channelId }) => {
      const runtime = (ctx.providerRuntime ??= createDesktopProviderRuntime())
      runtime.refreshPreferences()
      return runtime.warm(platform, channelId)
    },
    getEmoteProviderErrors: async () => getProviderErrors(),
    getUserCosmetics: async ({ platform, platformUserId, username }) => {
      const cosmetics = await getUserCosmetics(platform, platformUserId, username)
      if (cosmetics && cosmetics.lookupStatus !== 'unavailable')
        void ctx.providerRuntime
          ?.warmAuthorPersonal(platform, platformUserId, cosmetics.personalEmoteSetId)
          .catch((error) => log.warn('Could not warm personal emotes', { error: String(error) }))
      return cosmetics
    },
    getPaintNameImage: ({ name, paint, fontSize, fontFamily }) =>
      getPaintNameImage(name, paint, fontSize, fontFamily),

    getAppVersion: async () => APP_VERSION,
    checkForUpdate: () => updater.check(),
    downloadUpdate: () => updater.download(),
    applyUpdate: () => updater.apply(),
    skipUpdate: ({ hash }) => updater.skip(hash),
    getReleaseNotes: async ({ version }) => {
      const cached = readCachedReleaseNotes(version)
      // Preview remounts must not burn the unauthenticated GitHub API limit.
      const preview = process.env.TWIRCHAT_CHANGELOG_PREVIEW === '1'
      if (preview && cached && process.env.TWIRCHAT_RELEASE_NOTES_REFRESH !== '1') return cached

      const url = `https://api.github.com/repos/Satont/twirchat/releases/tags/v${version}`
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'TwirChat',
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return cached
        const release = githubReleaseSchema.parse(await res.json())
        const notes = {
          version: release.tag_name?.replace(/^v/u, '') ?? version,
          releaseNotes: release.body ?? '',
          publishedAt: release.published_at ?? '',
          htmlUrl:
            release.html_url ?? `https://github.com/Satont/twirchat/releases/tag/v${version}`,
        }
        if (notes.releaseNotes) writeCachedReleaseNotes(notes)
        return notes
      } catch (error) {
        log.warn('Could not load release notes', { version, error: String(error) })
        return cached
      }
    },

    getWatchedChannels: async () => {
      const builtin = watchedChannelManager.getAll()
      const external = ctx.pluginChannels?.list() ?? []
      return external.length === 0
        ? builtin
        : [...builtin, ...external].toSorted((a, b) => a.createdAt - b.createdAt)
    },

    setActiveWatchedChannels: async ({ ids }) => {
      const active = new Set(ids)
      for (const channel of watchedChannelManager.getAll())
        ctx.providerRuntime?.setJoined(
          `watched:${channel.id}`,
          channel.platform,
          active.has(channel.id) ? channel.channelSlug : null,
        )
      ctx.pluginChannels?.setActive(active)
      await watchedChannelManager.setActiveChannels(ids)
    },

    addWatchedChannel: async ({ platform, channelSlug }) => {
      if (isPluginPlatform(platform)) {
        if (!ctx.pluginChannels) throw new Error('Plugin transports are unavailable.')
        return ctx.pluginChannels.add(platform, channelSlug)
      }
      void ctx.providerRuntime?.warm(platform, channelSlug).catch((error) =>
        log.warn('Could not warm channel emotes', {
          platform,
          channelSlug,
          error: String(error),
        }),
      )
      const channel = await watchedChannelManager.addChannel(platform, channelSlug)
      return channel
    },

    removeWatchedChannel: async ({ id }) => {
      if (ctx.pluginChannels?.remove(id)) return
      const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === id)
      if (channel) ctx.providerRuntime?.setJoined(`watched:${id}`, channel.platform, null)
      await watchedChannelManager.removeChannel(id)
      WatchedChannelsLayoutStore.remove(id)
    },

    getWatchedChannelMessages: async ({ id }) => {
      const channel = watchedChannelManager.getAll().find((candidate) => candidate.id === id)
      if (!channel) return []
      if (channel.platform === 'twitch')
        void ctx.twitchHistory
          ?.refresh(channel.channelSlug)
          .catch((error) => log.debug('Twitch history unavailable', { error: String(error) }))
      const local = await readChatHistory({
        platform: channel.platform,
        channelId: channel.channelSlug,
        limit: 200,
      })
      return mergeChatMessageSnapshot(watchedChannelManager.getMessages(id), local.messages, 200)
    },

    sendWatchedChannelMessage: async ({ id, text, replyToMessageId }) => {
      const command = text
        .trim()
        .match(/^\/([a-z]+)/i)?.[1]
        ?.toLowerCase()
      if (command && platformCommands.has(command)) {
        throw new Error('Use the platform command handler for slash commands.')
      }
      return watchedChannelManager.sendMessage(id, text, replyToMessageId)
    },

    getWatchedChannelStatuses: async () => {
      return watchedChannelManager.getAllStatuses()
    },

    getPluginTransports: () => ctx.pluginChannels?.transports() ?? [],
    observePluginChannel: (id, listener) => ctx.pluginChannels?.observe(id, listener) ?? (() => {}),
    sendPluginChannelMessage: async ({ id, text }) => {
      if (!ctx.pluginChannels) throw new Error('Plugin transports are unavailable.')
      await ctx.pluginChannels.sendMessage(id, text)
    },

    getChatters: async ({ targets }) => {
      const results: ChannelChatters[] = []
      for (const target of targets) {
        try {
          if (target.platform === 'twitch') {
            results.push(await fetchTwitchChatters(target.channelSlug))
          } else if (target.platform === 'kick') {
            results.push(await fetchKickChatters(target.channelSlug))
          } else {
            results.push({
              ...target,
              total: 0,
              groups: [],
              error: `get chatters: platform "${target.platform}" is not supported`,
            })
          }
        } catch (error) {
          results.push({ ...target, total: 0, groups: [], error: String(error) })
        }
      }
      return { results }
    },

    openExternalUrl: async ({ url }) => {
      ctx.openBrowser(url)
    },

    ...createLayoutApi((key, value) => {
      if (key === 'emote_preferences_v1') ctx.providerRuntime?.refreshPreferences()
      ctx.onUiStateSaved?.(key, value)
    }),

    copyText: async ({ text }) => {
      const candidates: string[][] =
        process.platform === 'darwin'
          ? [['pbcopy']]
          : process.platform === 'win32'
            ? [['clip']]
            : process.env.WAYLAND_DISPLAY
              ? [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard']]
              : [['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard'], ['wl-copy']]
      let lastError: unknown = null
      for (const cmd of candidates) {
        try {
          const proc = Bun.spawn(cmd, {
            stdin: 'pipe',
            stdout: 'ignore',
            stderr: 'ignore',
            windowsHide: true,
          })
          await proc.stdin.write(text)
          await proc.stdin.end()
          await proc.exited
          if (proc.exitCode === 0) return
        } catch (error) {
          lastError = error
        }
      }
      throw new Error(`clipboard unavailable: ${String(lastError)}`)
    },
    readClipboard: () => systemIntegration.readClipboard(),
    notify: (params) => systemIntegration.notify(params),
  }
}
