/**
 * GPUIX backend bridge — request API.
 *
 * Mirrors the Wails gateway contract (`LegacyRequestMap` in
 * src/views/main/services/desktop-api.ts) method-for-method, but executes
 * in-process against the TypeScript stores / adapters / managers.
 *
 * Semantics are ported from the Electrobun main process (src/bun/index.ts)
 * and the Go bridge handlers (internal/bridge/*.go) for the methods that
 * only exist in the Wails stack (moderation, chatters, avatar resolution).
 */

import type {
  Account,
  AppSettings,
  LayoutNode,
  NormalizedChatMessage,
  PanelNode,
  Platform,
  PlatformStatusInfo,
  SplitDirection,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'
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
import type { UserChatHistoryCursor, UserChatHistoryPage } from '../../shared/rpc'
import { logger } from '@twirchat/shared/logger'
import { getDb } from '../../store/db'
import {
  AccountStore,
  ChannelStore,
  MessageStore,
  SettingsStore,
  UsernameColorCache,
} from '../../store'
import { UserAliasStore } from '../../store/user-alias-store'
import { WatchedChannelsLayoutStore } from '../../store/watched-channels-layout-store'
import { backendFetch } from '../../runtime-config'
import {
  getKickAuthUrl,
  getTwitchAuthUrl,
  getYouTubeAuthUrl,
  prepareKickAuth,
  prepareTwitchAuth,
  prepareYouTubeAuth,
} from '../../auth'
import type { ChatAggregator } from '../../chat/aggregator'
import type { BackendConnection } from '../../backend-connection'
import type { WatchedChannelManager } from '../../watched-channels/manager'
import { sevenTVService } from '../../seventv'
import type { KickAdapter } from '../../platforms/kick/adapter'
import type { DesktopEvents } from './events'

const log = logger('gpuix-backend')

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

/** Functionalty-equivalent to the Wails `DesktopApi.request` surface. */
export interface DesktopApi {
  getAccounts(): Promise<Account[]>
  getSettings(): Promise<AppSettings>
  saveSettings(params: AppSettings): Promise<void>
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
  }): Promise<void>
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
    limit?: number
    cursor?: UserChatHistoryCursor
  }): Promise<UserChatHistoryPage>
  getUserCardMetadata(params: UserCardMetadataRequest): Promise<UserCardMetadataResponse>
  getStatuses(): Promise<PlatformStatusInfo[]>
  getUsernameColor(params: { platform: Platform; username: string }): Promise<string | null>
  getChannelEmotes(params: { platform: Platform; channelId: string }): Promise<EmoteCatalogEntry[]>
  /** Updates are handled by the Wails/Velopack build; the GPUIX build reports "no update". */
  checkForUpdate(): Promise<{ updateAvailable: boolean; version?: string; currentVersion: string }>
  downloadUpdate(): Promise<{ success: boolean; error?: string }>
  applyUpdate(): Promise<void>
  skipUpdate(params: { hash: string }): Promise<void>
  getWatchedChannels(): Promise<WatchedChannel[]>
  addWatchedChannel(params: {
    platform: 'twitch' | 'kick' | 'youtube'
    channelSlug: string
  }): Promise<WatchedChannel>
  removeWatchedChannel(params: { id: string }): Promise<void>
  getWatchedChannelMessages(params: { id: string }): Promise<NormalizedChatMessage[]>
  sendWatchedChannelMessage(params: {
    id: string
    text: string
    replyToMessageId?: string
  }): Promise<void>
  getWatchedChannelStatuses(): Promise<Array<{ channelId: string; status: PlatformStatusInfo }>>
  getChatters(params: { targets: ChattersTarget[] }): Promise<{ results: ChannelChatters[] }>
  openExternalUrl(params: { url: string }): Promise<void>
  /** GPUIX-only: generic UI preference stored in the settings KV table. */
  getUiState(params: { key: string }): Promise<string | null>
  setUiState(params: { key: string; value: string }): Promise<void>
  /** GPUIX-only: write to the system clipboard (GPUIX exposes no clipboard API). */
  copyText(params: { text: string }): Promise<void>
  getTabChannelIds(): Promise<string[] | null>
  setTabChannelIds(params: { ids: string[] }): Promise<void>
  getWatchedChannelsLayout(params: { tabId: string }): Promise<WatchedChannelsLayout | null>
  setWatchedChannelsLayout(params: { tabId: string; layout: WatchedChannelsLayout }): Promise<void>
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
  aggregator: ChatAggregator
  backendConn: BackendConnection
  watchedChannelManager: WatchedChannelManager
  currentStatuses: Map<string, PlatformStatusInfo>
  events: DesktopEvents
  openBrowser: (url: string) => void
}

const MAX_PANELS = 8

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
        const data = (await res.json()) as { user?: { profile_image_url?: string } }
        avatarUrl = data.user?.profile_image_url?.trim() ?? ''
      }
    } else {
      const slug = params.username?.trim()
      if (slug) {
        const res = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(slug)}`)
        if (res.ok) {
          const data = (await res.json()) as { avatarUrl?: string }
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

interface TwitchChattersResponse {
  broadcasterId?: string
  chatters?: Array<{
    userId?: string
    userLogin?: string
    userName?: string
    avatarUrl?: string
  }>
}

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
  const data = (await res.json()) as TwitchChattersResponse

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

interface KickChatter {
  slug?: string
  username?: string
  profilePicture?: string
}

async function fetchKickChatters(channelSlug: string): Promise<ChannelChatters> {
  // 1. Resolve the broadcaster id via the backend chatroom proxy.
  const roomRes = await backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(channelSlug)}`)
  if (!roomRes.ok) throw new Error('Kick chatters are currently unavailable.')
  const room = (await roomRes.json()) as { broadcasterUserId?: number; chatroomId?: number }
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
  const body = (await res.json()) as {
    data?: {
      moderators?: KickChatter[]
      vips?: KickChatter[]
      ogs?: KickChatter[]
      bots?: KickChatter[]
      chatters?: KickChatter[]
    }
  }
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

// ── Layout tree surgery (ported from src/bun/index.ts) ─────────────────────

function findNodeById(node: LayoutNode, id: string): PanelNode | null {
  if (node.type === 'panel' && node.id === id) return node
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findNodeById(child, id)
      if (found) return found
    }
  }
  return null
}

function findParentOfNode(
  root: LayoutNode,
  nodeId: string,
): { node: LayoutNode; children: LayoutNode[] } | null {
  if (root.type === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i]
      if (!child) continue
      if (child.id === nodeId) {
        return { node: root, children: root.children }
      }
      const found = findParentOfNode(child, nodeId)
      if (found) return found
    }
  }
  return null
}

function countPanels(node: LayoutNode): number {
  if (node.type === 'panel') return 1
  return node.children.reduce((sum, child) => sum + countPanels(child), 0)
}

// ── API factory ─────────────────────────────────────────────────────────────

export function createDesktopApi(ctx: DesktopApiContext): DesktopApi {
  const { aggregator, backendConn, watchedChannelManager, currentStatuses } = ctx

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
      const broadcasterUserId = (adapter as KickAdapter).getBroadcasterUserId()
      if (broadcasterUserId) sevenTvChannelId = String(broadcasterUserId)
    } else if (platform === 'twitch') {
      sevenTvPlatformUserId = getSevenTvTwitchPlatformUserId(channelSlug)
    }
    sevenTVService
      .subscribeToChannel(platform, sevenTvChannelId, [channelSlug], sevenTvPlatformUserId)
      .catch((error) => {
        log.error('Failed to subscribe to 7TV', {
          platform,
          channelSlug: sevenTvChannelId,
          error: String(error),
        })
      })
  }

  return {
    getAccounts: async () => AccountStore.findAll(),

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
      backendConn.send({ type: 'auth_logout', platform })
      AccountStore.deleteByPlatform(platform)
      void watchedChannelManager.reconnectByPlatform(platform).catch((err) => {
        log.error('Failed to reconnect watched channels after logout', {
          platform,
          error: String(err),
        })
      })
    },

    joinChannel: async ({ platform, channelSlug }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) {
        log.warn('No adapter registered for platform', { platform })
        return
      }
      ChannelStore.save(platform, channelSlug)
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
      sevenTVService.unsubscribeFromChannel(platform, channelSlug).catch((err) => {
        log.error('Failed to unsubscribe from 7TV', { platform, channelSlug, error: String(err) })
      })
      adapter.disconnect().catch((err) => {
        log.error('Failed to disconnect', { platform, error: String(err) })
      })
    },

    sendMessage: async ({ platform, channelId, text, replyToMessageId }) => {
      const adapter = aggregator.getAdapter(platform)
      if (!adapter) return
      await adapter.sendMessage(channelId, text, replyToMessageId).catch((err) => {
        log.error('Failed to send message', { platform, error: String(err) })
        throw err
      })
    },

    resolveAvatar: async (params) => resolveAvatarRemote(params),

    getModerationCapabilities: async ({ platform, channelSlug }) => {
      const body = await moderationBody(platform, channelSlug)
      const res = await backendFetch('/api/moderation/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`moderation capabilities: ${res.status}`)
      return (await res.json()) as { canModerate: boolean }
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
      if (!res.ok) throw new Error(`moderation action: ${res.status}`)
      const result = (await res.json()) as { success: boolean; error?: { message?: string } }
      if (!result.success) {
        throw new Error(result.error?.message || 'moderation action was rejected')
      }
      return { success: true }
    },

    getStreamStatus: async ({ platform, channelId }) => {
      const res = await backendFetch(
        `/api/stream-status?platform=${platform}&channelId=${encodeURIComponent(channelId)}`,
      )
      if (!res.ok) throw new Error(`stream-status: ${res.status}`)
      return (await res.json()) as StreamStatusResponse
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
      if (!res.ok) throw new Error(`update-stream: ${res.status}`)
      return (await res.json()) as UpdateStreamResponse
    },

    searchCategories: async ({ platform, query }) => {
      const res = await backendFetch(
        `/api/search-categories?platform=${platform}&query=${encodeURIComponent(query)}`,
      )
      if (!res.ok) throw new Error(`search-categories: ${res.status}`)
      return (await res.json()) as SearchCategoriesResponse
    },

    getChannelsStatus: async ({ channels }) => {
      const enriched = channels.map((ch) => {
        const account = AccountStore.findByPlatform(ch.platform as Platform)
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
      if (!res.ok) throw new Error(`channels-status: ${res.status}`)
      return (await res.json()) as ChannelsStatusResponse
    },

    getRecentMessages: async (params) => {
      return MessageStore.getRecent(params?.limit ?? 100)
    },

    getUserChatHistory: async ({ platform, platformUserId, limit, cursor }) => {
      return MessageStore.getByUser({ platform, platformUserId, limit, cursor })
    },

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
      if (!res.ok) throw new Error(`user-card-metadata: ${res.status}`)
      return (await res.json()) as UserCardMetadataResponse
    },

    getStatuses: async () => [...currentStatuses.values()],

    getUsernameColor: async ({ platform, username }) => {
      return UsernameColorCache.get(platform, username) ?? null
    },

    getChannelEmotes: async ({ platform, channelId }) => {
      return sevenTVService.getEmotes(platform, channelId) as unknown as EmoteCatalogEntry[]
    },

    // The GPUIX build has no updater (releases stay on the Wails build).
    checkForUpdate: async () => ({ updateAvailable: false, currentVersion: 'dev' }),
    downloadUpdate: async () => ({
      success: false,
      error: 'Updates are not available in this build',
    }),
    applyUpdate: async () => {},
    skipUpdate: async () => {},

    getWatchedChannels: async () => watchedChannelManager.getAll(),

    addWatchedChannel: async ({ platform, channelSlug }) => {
      return await watchedChannelManager.addChannel(platform, channelSlug)
    },

    removeWatchedChannel: async ({ id }) => {
      await watchedChannelManager.removeChannel(id)
      WatchedChannelsLayoutStore.remove(id)
    },

    getWatchedChannelMessages: async ({ id }) => {
      return watchedChannelManager.getMessages(id)
    },

    sendWatchedChannelMessage: async ({ id, text, replyToMessageId }) => {
      await watchedChannelManager.sendMessage(id, text, replyToMessageId)
    },

    getWatchedChannelStatuses: async () => {
      return watchedChannelManager.getAllStatuses()
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

    getUiState: async ({ key }) => {
      const db = getDb()
      const row = db
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get(`gpuix_ui_${key}`)
      return row?.value ?? null
    },

    setUiState: async ({ key, value }) => {
      const db = getDb()
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [`gpuix_ui_${key}`, value],
      )
    },

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
          const proc = Bun.spawn(cmd, { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited
          if (proc.exitCode === 0) return
        } catch (error) {
          lastError = error
        }
      }
      throw new Error(`clipboard unavailable: ${String(lastError)}`)
    },

    getTabChannelIds: async () => {
      const db = getDb()
      const row = db
        .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
        .get('tab_channel_ids')
      if (!row) return null
      try {
        return JSON.parse(row.value) as string[]
      } catch {
        return null
      }
    },

    setTabChannelIds: async ({ ids }) => {
      const db = getDb()
      db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['tab_channel_ids', JSON.stringify(ids)],
      )
    },

    getWatchedChannelsLayout: async ({ tabId }) => {
      return WatchedChannelsLayoutStore.get(tabId)
    },

    setWatchedChannelsLayout: async ({ tabId, layout }) => {
      WatchedChannelsLayoutStore.set(tabId, layout)
    },

    splitPanel: async ({ tabId, panelId, direction }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      if (countPanels(layout.root) >= MAX_PANELS) {
        throw new Error('Maximum panel limit reached (8)')
      }

      const panel = findNodeById(layout.root, panelId)
      if (!panel || panel.type !== 'panel') {
        throw new Error('Panel not found')
      }

      const newPanel: PanelNode = {
        type: 'panel',
        id: crypto.randomUUID(),
        content: { type: 'empty' },
        flex: 50,
      }

      const parent = findParentOfNode(layout.root, panelId)
      if (parent && parent.node.type === 'split' && parent.node.direction === direction) {
        const index = parent.children.findIndex((c) => c.id === panelId)
        parent.children.splice(index + 1, 0, newPanel)
        const flexPerChild = 100 / parent.children.length
        parent.children.forEach((child) => (child.flex = flexPerChild))
      } else {
        const newSplit: LayoutNode = {
          type: 'split',
          id: crypto.randomUUID(),
          direction,
          children: [panel, newPanel],
          flex: panel.flex,
        }
        panel.flex = 50
        if (parent) {
          const index = parent.children.findIndex((c) => c.id === panelId)
          parent.children[index] = newSplit
        } else {
          layout.root = newSplit
        }
      }

      WatchedChannelsLayoutStore.set(tabId, layout)
      return { original: panel, newPanel }
    },

    removePanel: async ({ tabId, panelId }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      const panelToRemove = findNodeById(layout.root, panelId)
      if (panelToRemove?.type === 'panel' && panelToRemove.content.type === 'main') {
        throw new Error('Cannot remove main panel')
      }

      const parent = findParentOfNode(layout.root, panelId)
      if (!parent) throw new Error('Panel not found')

      const index = parent.children.findIndex((c) => c.id === panelId)
      if (index === -1) throw new Error('Panel not found in parent')

      parent.children.splice(index, 1)

      if (parent.children.length === 1) {
        const onlyChild = parent.children[0]
        if (onlyChild) {
          const grandparent = findParentOfNode(layout.root, parent.node.id)
          if (grandparent) {
            const parentIndex = grandparent.children.findIndex((c) => c.id === parent.node.id)
            if (parentIndex !== -1) {
              grandparent.children[parentIndex] = onlyChild
            }
          } else {
            layout.root = onlyChild
          }
        }
      } else {
        const flexPerChild = 100 / parent.children.length
        parent.children.forEach((child) => (child.flex = flexPerChild))
      }

      WatchedChannelsLayoutStore.set(tabId, layout)
    },

    assignChannelToPanel: async ({ tabId, panelId, channelId }) => {
      const layout = WatchedChannelsLayoutStore.get(tabId)

      const panel = findNodeById(layout.root, panelId)
      if (!panel || panel.type !== 'panel') {
        throw new Error('Panel not found')
      }

      panel.content = channelId ? { type: 'watched', channelId } : { type: 'empty' }

      WatchedChannelsLayoutStore.set(tabId, layout)
    },
  }
}
