/**
 * GPUIX app state — ports the Pinia stores + App.vue reactive state into
 * framework-agnostic observable stores, plus the wiring that feeds them
 * from the in-process backend event bus.
 */

import type {
  Account,
  AppSettings,
  ModerationOutcome,
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import type {
  ChannelStatus,
  ChannelStatusRequest,
  EmoteCatalogEntry,
  SevenTVEmote,
} from '@twirchat/shared/protocol'

import { createStore } from './create-store'
import type { DesktopBackend } from '../backend/server'
import type { UserAlias } from '../backend/api'
import { mergeChatMessageSnapshot } from '../../views/main/utils/chat-message-buffer'
import { filterHomeChatMessages } from '../../views/main/utils/chat-send-targets'

// ── Simple stores ───────────────────────────────────────────────────────────

export const settingsStore = createStore<AppSettings | null>(null)
export const accountsStore = createStore<Account[]>([])
export const aliasesStore = createStore<UserAlias[]>([])
/** platform → status */
export const channelStatusStore = createStore<Partial<Record<Platform, PlatformStatusInfo>>>({})
export const watchedChannelsStore = createStore<WatchedChannel[]>([])
/** channelId → messages (oldest first, capped at 200) */
export const watchedMessagesStore = createStore<Map<string, NormalizedChatMessage[]>>(new Map())
/** channelId → status */
export const watchedStatusesStore = createStore<Map<string, PlatformStatusInfo>>(new Map())
export const eventsStore = createStore<NormalizedEvent[]>([])
export const unreadEventsStore = createStore(0)
/** 'platform:login' → stream status */
export const streamStatusStore = createStore<Map<string, ChannelStatus>>(new Map())
/** 'platform:channelId' → emote catalog */
export const emoteStore = createStore<Map<string, EmoteCatalogEntry[]>>(new Map())

export type MainTab = 'chat' | 'events' | 'platforms' | 'settings'
export const activeTabStore = createStore<MainTab>(
  (process.env.TWIRCHAT_GPUIX_START_MAIN_TAB as MainTab | undefined) ?? 'chat',
)
export const tabChannelIdsStore = createStore<string[]>([])
/** 'home' or a watched channel id */
export const activeWatchedTabStore = createStore<string>(
  process.env.TWIRCHAT_GPUIX_START_TAB ?? 'home',
)
/** tabId → channel display names shown in the tab label (from the layout tree) */
export const tabChannelNamesStore = createStore<Map<string, string[]>>(new Map())

export interface TransientNotice {
  kind: 'info' | 'success' | 'error'
  text: string
}
export const noticeStore = createStore<TransientNotice | null>(null)

// ── Home chat buffer ────────────────────────────────────────────────────────
// Own-channel messages only (see chat-send-targets.ts), capped at 500.

const HOME_BUFFER_LIMIT = 500
const homeBuffer = createStore<NormalizedChatMessage[]>([])
export { homeBuffer as homeMessagesStore }

export function appendHomeMessages(incoming: NormalizedChatMessage[]): void {
  const filtered = filterHomeChatMessages(incoming, accountsStore.get())
  if (filtered.length === 0) return
  homeBuffer.set((current) => mergeChatMessageSnapshot(current, filtered, HOME_BUFFER_LIMIT))
}

// ── Moderation outcomes (port of useModerationOutcomes.ts) ──────────────────

export interface ResolvedModerationOutcome {
  action: ModerationOutcome['action']
  isTombstone?: boolean
  label: string
}

const DELETED_MESSAGE_RETENTION_MS = 300_000
const SANCTION_CLOCK_SKEW_MS = 10_000

const deletedMessages = new Map<
  string,
  { expiresAt: number; resolved: ResolvedModerationOutcome }
>()
const userSanctions = new Map<string, { appliedAt: number; resolved: ResolvedModerationOutcome }>()
export const moderationRevisionStore = createStore(0)

function moderationMessageKey(platform: string, messageId: string): string {
  return `${platform}:${messageId}`
}

function moderationUserKey(platform: string, channelId: string, userId: string): string {
  return `${platform}:${channelId.trim().replace(/^#/, '').toLowerCase()}:${userId}`
}

function formatSanctionDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

export function applyModerationOutcome(outcome: ModerationOutcome): void {
  const now = Date.now()
  for (const [key, retained] of deletedMessages) {
    if (retained.expiresAt <= now) deletedMessages.delete(key)
  }

  if (outcome.action === 'delete_message') {
    if (!outcome.messageId) return
    const key = moderationMessageKey(outcome.platform, outcome.messageId)
    deletedMessages.set(key, {
      expiresAt: now + DELETED_MESSAGE_RETENTION_MS,
      resolved: { action: 'delete_message', isTombstone: true, label: '(message deleted)' },
    })
    setTimeout(() => {
      const entry = deletedMessages.get(key)
      if (entry && entry.expiresAt <= Date.now()) {
        deletedMessages.delete(key)
        moderationRevisionStore.set((v) => v + 1)
      }
    }, DELETED_MESSAGE_RETENTION_MS)
    moderationRevisionStore.set((v) => v + 1)
    return
  }

  if (!outcome.targetUserId) return
  let resolved: ResolvedModerationOutcome | undefined
  if (outcome.action === 'ban') {
    resolved = { action: 'ban', label: '(banned)' }
  } else if (
    outcome.action === 'timeout' &&
    outcome.durationSeconds !== undefined &&
    Number.isSafeInteger(outcome.durationSeconds) &&
    outcome.durationSeconds > 0
  ) {
    resolved = {
      action: 'timeout',
      label: `(timed out for ${formatSanctionDuration(outcome.durationSeconds)})`,
    }
  }
  if (!resolved) return
  userSanctions.set(moderationUserKey(outcome.platform, outcome.channelId, outcome.targetUserId), {
    appliedAt: now,
    resolved,
  })
  moderationRevisionStore.set((v) => v + 1)
}

export function moderationOutcomeFor(
  message: NormalizedChatMessage,
): ResolvedModerationOutcome | undefined {
  const deletion = deletedMessages.get(moderationMessageKey(message.platform, message.id))
  if (deletion) return deletion.resolved
  const sanction = userSanctions.get(
    moderationUserKey(message.platform, message.channelId, message.author.id),
  )
  if (!sanction) return undefined
  const timestamp =
    message.timestamp instanceof Date
      ? message.timestamp.getTime()
      : new Date(message.timestamp).getTime()
  if (timestamp > sanction.appliedAt + SANCTION_CLOCK_SKEW_MS) return undefined
  return sanction.resolved
}

// ── Emote catalog (port of stores/emoteStore.ts) ────────────────────────────

const emoteInflight = new Map<string, Promise<void>>()
const sevenTVVersions = new Map<string, number>()

function emoteKey(platform: string, channelId: string): string {
  return `${platform}:${channelId}`
}

function setEmoteCatalog(platform: string, channelId: string, emotes: EmoteCatalogEntry[]): void {
  emoteStore.set((current) => new Map(current).set(emoteKey(platform, channelId), emotes))
}

function sevenTVEntry(emote: SevenTVEmote): EmoteCatalogEntry {
  return { ...emote, source: 'seventv' }
}

function markSevenTVMutation(key: string): void {
  sevenTVVersions.set(key, (sevenTVVersions.get(key) ?? 0) + 1)
}

export function setSevenTVEmotes(
  platform: Platform,
  channelId: string,
  emotes: SevenTVEmote[],
): void {
  const key = emoteKey(platform, channelId)
  markSevenTVMutation(key)
  const existing = emoteStore.get().get(key) ?? []
  setEmoteCatalog(platform, channelId, [
    ...existing.filter((entry) => entry.source !== 'seventv'),
    ...emotes.map(sevenTVEntry),
  ])
}

export function addSevenTVEmote(platform: Platform, channelId: string, emote: SevenTVEmote): void {
  const key = emoteKey(platform, channelId)
  markSevenTVMutation(key)
  const existing = emoteStore.get().get(key) ?? []
  setEmoteCatalog(platform, channelId, [
    ...existing.filter((entry) => entry.source !== 'seventv' || entry.id !== emote.id),
    sevenTVEntry(emote),
  ])
}

export function removeSevenTVEmote(platform: Platform, channelId: string, emoteId: string): void {
  const key = emoteKey(platform, channelId)
  markSevenTVMutation(key)
  const existing = emoteStore.get().get(key)
  if (!existing) return
  setEmoteCatalog(
    platform,
    channelId,
    existing.filter((entry) => entry.source !== 'seventv' || entry.id !== emoteId),
  )
}

export function updateSevenTVEmote(
  platform: Platform,
  channelId: string,
  emoteId: string,
  newAlias: string,
): void {
  const key = emoteKey(platform, channelId)
  markSevenTVMutation(key)
  const existing = emoteStore.get().get(key)
  if (!existing) return
  setEmoteCatalog(
    platform,
    channelId,
    existing.map((entry) =>
      entry.source === 'seventv' && entry.id === emoteId ? { ...entry, alias: newAlias } : entry,
    ),
  )
}

export function loadEmotes(
  backend: DesktopBackend,
  platform: string,
  channelId: string,
  useSessionCache = true,
): Promise<void> {
  const key = emoteKey(platform, channelId)
  if (useSessionCache && emoteStore.get().has(key)) {
    return Promise.resolve()
  }

  const pending = emoteInflight.get(key)
  if (pending) return pending

  const sevenTVVersion = sevenTVVersions.get(key) ?? 0

  const promise = (async () => {
    try {
      const emotes = await backend.api.getChannelEmotes({
        platform: platform as Platform,
        channelId,
      })
      const liveSevenTV =
        sevenTVVersions.get(key) === sevenTVVersion
          ? undefined
          : (emoteStore.get().get(key) ?? []).filter((entry) => entry.source === 'seventv')
      setEmoteCatalog(platform, channelId, [
        ...emotes.filter((entry) => entry.source !== 'seventv'),
        ...(liveSevenTV ?? emotes.filter((entry) => entry.source === 'seventv')),
      ])
    } catch (err) {
      console.warn('[emotes] Failed to load emotes:', platform, channelId, err)
    } finally {
      emoteInflight.delete(key)
    }
  })()

  emoteInflight.set(key, promise)
  return promise
}

// ── Stream status polling (port of stores/streamStatus.ts) ──────────────────

const STREAM_STATUS_POLL_MS = 30_000
let streamStatusTimer: ReturnType<typeof setInterval> | null = null
let streamStatusRunning = false

async function refreshStreamStatuses(backend: DesktopBackend): Promise<void> {
  const accounts = accountsStore.get()
  const watched = watchedChannelsStore.get()

  const requests: ChannelStatusRequest[] = []
  for (const account of accounts) {
    if (account.platform !== 'twitch' && account.platform !== 'kick') continue
    requests.push({
      channelId: account.platformUserId,
      channelLogin: account.username,
      platform: account.platform,
    })
  }
  for (const channel of watched) {
    if (channel.platform === 'youtube') continue
    const platform = channel.platform as 'twitch' | 'kick'
    const key = `${platform}:${channel.channelSlug.toLowerCase()}`
    if (requests.some((r) => `${r.platform}:${r.channelLogin.toLowerCase()}` === key)) continue
    requests.push({ channelLogin: channel.channelSlug, platform })
  }

  if (requests.length === 0) return

  try {
    const response = await backend.api.getChannelsStatus({ channels: requests })
    streamStatusStore.set((current) => {
      const next = new Map(current)
      for (const status of response.channels ?? []) {
        next.set(`${status.platform}:${status.channelLogin.toLowerCase()}`, status)
      }
      return next
    })
  } catch {
    // stale status is acceptable
  }
}

export function startStreamStatusPolling(backend: DesktopBackend): void {
  if (streamStatusTimer) return
  const tick = async () => {
    if (streamStatusRunning) return
    streamStatusRunning = true
    try {
      await refreshStreamStatuses(backend)
    } finally {
      streamStatusRunning = false
    }
  }
  void tick()
  streamStatusTimer = setInterval(() => void tick(), STREAM_STATUS_POLL_MS)
}

export function getStreamStatus(
  platform: 'twitch' | 'kick',
  channelLogin: string,
): ChannelStatus | undefined {
  return streamStatusStore.get().get(`${platform}:${channelLogin.toLowerCase()}`)
}

// ── Transient notices (port of useTransientNotice + useConnectionNotice) ────

let noticeTimer: ReturnType<typeof setTimeout> | null = null

export function showNotice(kind: TransientNotice['kind'], text: string, durationMs = 3000): void {
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeStore.set({ kind, text })
  noticeTimer = setTimeout(() => noticeStore.set(null), durationMs)
}

const recentConnectionNotices = new Map<string, number>()

export function showConnectionNotice(status: PlatformStatusInfo): void {
  const key = `${status.platform}:${status.channelLogin ?? status.platform}`
  const now = Date.now()
  const last = recentConnectionNotices.get(key) ?? 0
  if (now - last < 5000 && status.status !== 'error') return
  recentConnectionNotices.set(key, now)

  const label = status.channelLogin ?? status.platform
  if (status.status === 'connected') {
    showNotice('success', `Connected to ${label}`, 3000)
  } else if (status.status === 'disconnected') {
    showNotice('info', `${label} disconnected`, 3000)
  } else if (status.status === 'error') {
    showNotice('error', status.error ?? `${label}: connection error`, 6000)
  } else if (status.status === 'connecting') {
    showNotice('info', `Connecting to ${label}…`, 3000)
  }
}

// ── Initial data load (port of App.vue loadInitialData) ─────────────────────

export async function loadInitialData(backend: DesktopBackend): Promise<void> {
  try {
    const [accs, aliases, setts, statList, watched] = await Promise.all([
      backend.api.getAccounts(),
      backend.api.getUserAliases(),
      backend.api.getSettings(),
      backend.api.getStatuses(),
      backend.api.getWatchedChannels(),
    ])
    accountsStore.set(accs)
    aliasesStore.set(aliases)
    settingsStore.set(setts)
    const statusMap: Partial<Record<Platform, PlatformStatusInfo>> = {}
    for (const s of statList) statusMap[s.platform] = s
    channelStatusStore.set(statusMap)
    watchedChannelsStore.set(watched)

    const persistedTabIds = await backend.api.getTabChannelIds()
    if (persistedTabIds && persistedTabIds.length > 0) {
      tabChannelIdsStore.set(persistedTabIds.filter((id) => watched.some((ch) => ch.id === id)))
    } else {
      tabChannelIdsStore.set(watched.map((ch) => ch.id))
      await backend.api.setTabChannelIds({ ids: watched.map((ch) => ch.id) })
    }

    // Pre-populate tab labels from persisted layouts.
    const collectNames = (node: import('@twirchat/shared/types').LayoutNode): string[] => {
      if (node.type === 'panel' && node.content.type === 'watched') {
        const ch = watched.find((c) => c.id === (node.content as { channelId: string }).channelId)
        return ch ? [ch.displayName] : []
      }
      if (node.type === 'split') return node.children.flatMap((child) => collectNames(child))
      return []
    }
    const nameMap = new Map<string, string[]>()
    for (const tabId of tabChannelIdsStore.get()) {
      try {
        const layout = await backend.api.getWatchedChannelsLayout({ tabId })
        if (layout) {
          const names = collectNames(layout.root)
          if (names.length > 0) nameMap.set(tabId, names)
        }
      } catch {
        // not fatal — tab falls back to the single-channel name
      }
    }
    tabChannelNamesStore.set(nameMap)

    try {
      const watchedStats = await backend.api.getWatchedChannelStatuses()
      watchedStatusesStore.set((current) => {
        const next = new Map(current)
        for (const { channelId, status } of watchedStats) next.set(channelId, status)
        return next
      })
    } catch {
      // not fatal
    }
  } catch (error) {
    console.warn('[state] Initial data load failed, retrying in 1s...', error)
    setTimeout(() => void loadInitialData(backend), 1000)
    return
  }

  try {
    const recent = await backend.api.getRecentMessages({})
    if (recent.length > 0) appendHomeMessages(recent)
  } catch (error) {
    console.warn('[state] Failed to load recent messages:', error)
  }

  for (const ch of watchedChannelsStore.get()) {
    try {
      const msgs = await backend.api.getWatchedChannelMessages({ id: ch.id })
      if (msgs.length > 0) {
        watchedMessagesStore.set((current) => {
          const next = new Map(current)
          next.set(ch.id, mergeChatMessageSnapshot(next.get(ch.id) ?? [], msgs, 200))
          return next
        })
      }
    } catch {
      // not fatal
    }
  }

  startStreamStatusPolling(backend)
}

// ── Backend event wiring ────────────────────────────────────────────────────

export function wireBackendToStores(backend: DesktopBackend): void {
  const { events } = backend

  events.on('chat_message', (msg) => {
    appendHomeMessages([msg])
  })

  events.on('chat_moderation', (outcome) => {
    applyModerationOutcome(outcome)
  })

  events.on('chat_event', (ev) => {
    eventsStore.set((current) => {
      const next = [...current, ev]
      return next.length > 200 ? next.slice(next.length - 200) : next
    })
    if (activeTabStore.get() !== 'events') {
      unreadEventsStore.set((v) => v + 1)
    }
  })

  events.on('platform_status', (s) => {
    showConnectionNotice(s)
    channelStatusStore.set((current) => ({ ...current, [s.platform]: s }))
  })

  events.on('channel_emotes_set', ({ platform, channelId, emotes }) => {
    setSevenTVEmotes(platform, channelId, emotes)
  })
  events.on('channel_emote_added', ({ platform, channelId, emote }) => {
    addSevenTVEmote(platform, channelId, emote)
    showNotice('info', `7TV: ${emote.alias} added to ${channelId}`)
  })
  events.on('channel_emote_removed', ({ platform, channelId, emoteId }) => {
    removeSevenTVEmote(platform, channelId, emoteId)
    showNotice('info', `7TV emote removed from ${channelId}`)
  })
  events.on('channel_emote_updated', ({ platform, channelId, emoteId, newAlias }) => {
    updateSevenTVEmote(platform, channelId, emoteId, newAlias)
    showNotice('info', `7TV emote renamed to ${newAlias} in ${channelId}`)
  })

  events.on('auth_success', () => {
    void backend.api.getAccounts().then((accs) => accountsStore.set(accs))
  })

  events.on('auth_error', ({ platform, error }) => {
    showNotice('error', `${platform}: ${error}`, 6000)
  })

  events.on('watched_channel_message', ({ channelId, message }) => {
    watchedMessagesStore.set((current) => {
      const next = new Map(current)
      next.set(channelId, mergeChatMessageSnapshot(next.get(channelId) ?? [], [message], 200))
      return next
    })
  })

  events.on('watched_channel_status', ({ channelId, status }) => {
    watchedStatusesStore.set((current) => new Map(current).set(channelId, status))
    if (status.status === 'error') {
      // The buffer may have been wiped server-side; refetch both views.
      void backend.api.getWatchedChannelMessages({ id: channelId }).then((msgs) => {
        watchedMessagesStore.set((current) => {
          const next = new Map(current)
          next.set(channelId, mergeChatMessageSnapshot(next.get(channelId) ?? [], msgs, 200))
          return next
        })
      })
      void backend.api.getWatchedChannelStatuses().then((stats) => {
        watchedStatusesStore.set((current) => {
          const next = new Map(current)
          for (const { channelId: id, status: s } of stats) next.set(id, s)
          return next
        })
      })
    }
  })
}
