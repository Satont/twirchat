import type {
  ChannelStatus,
  ChannelStatusRequest,
  EmoteCatalogEntry,
  SevenTVEmote,
} from '@twirchat/shared/protocol'
import type {
  Account,
  AppSettings,
  ModerationOutcome,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
} from '@twirchat/shared/types'

import { similarityChannelKey } from '../../services/message-similarity'
import {
  appendLiveChatMessagesWithCount,
  mergeChatMessageSnapshot,
} from '../../views/main/utils/chat-message-buffer'
/**
 * GPUIX app state — ports the Pinia stores + App.vue reactive state into
 * framework-agnostic observable stores, plus the wiring that feeds them
 * from the in-process backend event bus.
 */
import { filterHomeChatMessages } from '../../views/main/utils/chat-send-targets'
import {
  isPluginWatchedChannel,
  type DesktopWatchedChannel,
} from '../../watched-channels/plugin-channel-types'
import type { DesktopApi } from '../backend/api'
import type { UserAlias } from '../backend/api'
import type { DesktopEvents } from '../backend/events'
import type { DesktopBackend } from '../backend/server'
import { getLanguage, setLanguage, t, tPlural, type Language } from '../i18n'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { mentionAppearances } from './mention-appearances'
import { classifyIncomingSimilarity, hydrateSimilarityHistory } from './message-similarity'
import { persistentResource } from './persistent-resources'

function hydrateMessageHistory(messages: readonly NormalizedChatMessage[]): void {
  const channels = new Map<string, NormalizedChatMessage[]>()
  for (const message of messages) {
    mentionAppearances.addMessage(message)
    const key = similarityChannelKey(message)
    const entries = channels.get(key)
    if (entries) entries.push(message)
    else channels.set(key, [message])
  }
  for (const [key, entries] of channels) hydrateSimilarityHistory(key, entries.toReversed())
}

// ── Simple stores ───────────────────────────────────────────────────────────

export const settingsStore = persistentResource('settings', () =>
  createStore<AppSettings | null>(null),
)
export const accountsStore = persistentResource('accounts', () => createStore<Account[]>([]))
/** Every saved identity, active or not; chats may sign in with any of them. */
export const savedAccountsStore = persistentResource('savedAccounts', () =>
  createStore<Account[]>([]),
)
export const aliasesStore = persistentResource('aliases', () => createStore<UserAlias[]>([]))
/** platform → status */
export const channelStatusStore = persistentResource('channelStatuses', () =>
  createStore<Partial<Record<Platform, PlatformStatusInfo>>>({}),
)
export const watchedChannelsStore = persistentResource('watchedChannels', () =>
  createStore<DesktopWatchedChannel[]>([]),
)
/** channelId → messages (oldest first, capped at 200) */
export const watchedMessagesStore = persistentResource('watchedMessages', () =>
  createStore<Map<string, NormalizedChatMessage[]>>(new Map()),
)
/** channelId → status */
export const watchedStatusesStore = persistentResource('watchedStatuses', () =>
  createStore<Map<string, PlatformStatusInfo>>(new Map()),
)
/** 'platform:login' → stream status */
export const streamStatusStore = persistentResource('streamStatuses', () =>
  createStore<Map<string, ChannelStatus>>(new Map()),
)
/** 'platform:channelId' → emote catalog */
export const emoteStore = persistentResource('emotes', () =>
  createStore<Map<string, EmoteCatalogEntry[]>>(new Map()),
)
export const authorEmoteStore = persistentResource('authorEmotes', () =>
  createStore<Map<string, EmoteCatalogEntry[]>>(new Map()),
)

export type MainTab = 'chat' | 'platforms' | 'settings' | 'obs-remote'
function normalizeMainTab(tab: string | undefined): MainTab {
  return tab === 'platforms' || tab === 'settings' || tab === 'obs-remote' ? tab : 'chat'
}
export const activeTabStore = persistentResource('activeMainTab', () =>
  createStore(normalizeMainTab(process.env.TWIRCHAT_GPUIX_START_MAIN_TAB)),
)
// A hot reload can retain a selection from the previous version.
activeTabStore.set(normalizeMainTab(activeTabStore.get()))

export const tabChannelIdsStore = persistentResource('tabChannelIds', () =>
  createStore<string[]>([]),
)
/** 'home' or a watched channel id */
export const activeWatchedTabStore = persistentResource('activeWatchedTab', () =>
  createStore<string>(process.env.TWIRCHAT_GPUIX_START_TAB ?? 'home'),
)
/** tabId → channel display names shown in the tab label (from the layout tree) */
export const tabChannelNamesStore = persistentResource('tabChannelNames', () =>
  createStore<Map<string, string[]>>(new Map()),
)

export interface TransientNotice {
  kind: 'info' | 'success' | 'error'
  text: string
}
export const noticeStore = persistentResource('notice', () =>
  createStore<TransientNotice | null>(null),
)

// ── Home chat buffer ────────────────────────────────────────────────────────
// Own-channel messages only (see chat-send-targets.ts), capped at 500.

const HOME_BUFFER_LIMIT = 500
const homeBuffer = persistentResource('homeMessages', () =>
  createStore<NormalizedChatMessage[]>([]),
)
export { homeBuffer as homeMessagesStore }

export interface ChatActivity {
  total: number
  buckets: { second: number; count: number }[]
}

/** Live activity only: `home` or a watched channel ID, independent of retention. */
export const chatActivityStore = persistentResource('chatActivity', () =>
  createStore<Map<string, ChatActivity>>(new Map()),
)

export function chatMessageRate(activity: ChatActivity | undefined, now = Date.now()): number {
  const second = Math.floor(now / 1000)
  return (
    (activity?.buckets.reduce(
      (total, bucket) =>
        bucket.second > second - 10 && bucket.second <= second ? total + bucket.count : total,
      0,
    ) ?? 0) / 10
  )
}

function recordChatActivity(counts: Map<string, number>): void {
  if (counts.size === 0) return
  const second = Math.floor(Date.now() / 1000)
  chatActivityStore.modify((current) => {
    let next = current
    for (const [channelId, count] of counts) {
      if (count === 0) continue
      if (next === current) next = new Map(current)
      const existing = current.get(channelId)
      const buckets = (existing?.buckets ?? []).filter(
        (bucket) => bucket.second > second - 10 && bucket.second <= second,
      )
      const latest = buckets[buckets.length - 1]
      if (latest?.second === second) {
        buckets[buckets.length - 1] = { second, count: latest.count + count }
      } else {
        buckets.push({ second, count })
      }
      next.set(channelId, { total: (existing?.total ?? 0) + count, buckets })
    }
    return next
  })
}

export function appendHomeMessages(incoming: NormalizedChatMessage[]): void {
  const filtered = filterHomeChatMessages(incoming, accountsStore.get())
  if (filtered.length === 0) return
  homeBuffer.modify((current) => mergeChatMessageSnapshot(current, filtered, HOME_BUFFER_LIMIT))
}

// ── Moderation outcomes (port of useModerationOutcomes.ts) ──────────────────

export interface ResolvedModerationOutcome {
  action: ModerationOutcome['action']
  isTombstone?: boolean
  label: string
}

const DELETED_MESSAGE_RETENTION_MS = 300_000
const SANCTION_CLOCK_SKEW_MS = 10_000

interface RetainedDeletion {
  expiresAt: number
  resolved: ResolvedModerationOutcome
}
interface RetainedSanction {
  appliedAt: number
  resolved: ResolvedModerationOutcome
}
interface ModerationState {
  deletedMessages: Map<string, RetainedDeletion>
  userSanctions: Map<string, RetainedSanction>
  channelClears: Map<string, number>
}
export interface ModerationView {
  outcomeFor(message: NormalizedChatMessage): ResolvedModerationOutcome | undefined
}
const EMPTY_MODERATION_VIEW: ModerationView = { outcomeFor: () => undefined }
const moderationState = persistentResource('moderationState', (): ModerationState => ({
  deletedMessages: new Map(),
  userSanctions: new Map(),
  channelClears: new Map(),
}))
const { deletedMessages, userSanctions, channelClears } = moderationState
const clearedOutcomes = new Map<Language, ResolvedModerationOutcome>()
/** One object per language: memoized rows compare outcomes by identity. */
function clearedOutcome(): ResolvedModerationOutcome {
  const language = getLanguage()
  let outcome = clearedOutcomes.get(language)
  if (!outcome) {
    outcome = {
      action: 'delete_message',
      isTombstone: true,
      label: t('notices.moderation.chatCleared'),
    }
    clearedOutcomes.set(language, outcome)
  }
  return outcome
}
export const moderationRevisionStore = persistentResource('moderationRevision', () =>
  createStore<number>(0),
)

export function applyChannelClear({
  platform,
  channelId,
}: {
  platform: Platform
  channelId: string
}): void {
  const key = `${platform}:${channelId.replace(/^#/u, '').toLowerCase()}`
  channelClears.set(key, Date.now())
  publishModerationView()
}

function moderationMessageKey(platform: string, messageId: string): string {
  return `${platform}:${messageId}`
}

function moderationUserKey(platform: string, channelId: string, userId: string): string {
  return `${platform}:${channelId.trim().replace(/^#/, '').toLowerCase()}:${userId}`
}

function formatSanctionDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return tPlural('notices.moderation.durationDays', seconds / 86_400)
  if (seconds % 3_600 === 0) return tPlural('notices.moderation.durationHours', seconds / 3_600)
  if (seconds % 60 === 0) return tPlural('notices.moderation.durationMinutes', seconds / 60)
  return tPlural('notices.moderation.durationSeconds', seconds)
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
      resolved: {
        action: 'delete_message',
        isTombstone: true,
        label: t('notices.moderation.messageDeleted'),
      },
    })
    setTimeout(() => {
      const entry = deletedMessages.get(key)
      if (!entry || entry.expiresAt <= Date.now()) {
        deletedMessages.delete(key)
        publishModerationView()
      }
    }, DELETED_MESSAGE_RETENTION_MS)
    publishModerationView()
    return
  }

  if (!outcome.targetUserId) return
  let resolved: ResolvedModerationOutcome | undefined
  if (outcome.action === 'ban') {
    resolved = { action: 'ban', label: t('notices.moderation.banned') }
  } else if (
    outcome.action === 'timeout' &&
    outcome.durationSeconds !== undefined &&
    Number.isSafeInteger(outcome.durationSeconds) &&
    outcome.durationSeconds > 0
  ) {
    resolved = {
      action: 'timeout',
      label: t('notices.moderation.timedOut', {
        duration: formatSanctionDuration(outcome.durationSeconds),
      }),
    }
  }
  if (!resolved) return
  userSanctions.set(moderationUserKey(outcome.platform, outcome.channelId, outcome.targetUserId), {
    appliedAt: now,
    resolved,
  })
  publishModerationView()
}

function createModerationView(): ModerationView {
  if (deletedMessages.size === 0 && userSanctions.size === 0 && channelClears.size === 0)
    return EMPTY_MODERATION_VIEW
  const deletions = new Map(deletedMessages)
  const sanctions = new Map(userSanctions)
  const clears = new Map(channelClears)
  return {
    outcomeFor(message) {
      if (message.metadata?.twitchNotice) return undefined
      const clearedAt = clears.get(
        `${message.platform}:${message.channelId.replace(/^#/u, '').toLowerCase()}`,
      )
      const timestamp =
        message.timestamp instanceof Date
          ? message.timestamp.getTime()
          : new Date(message.timestamp).getTime()
      if (clearedAt !== undefined && timestamp <= clearedAt) return clearedOutcome()
      const deletion = deletions.get(moderationMessageKey(message.platform, message.id))
      if (deletion && deletion.expiresAt > Date.now()) return deletion.resolved
      const sanction = sanctions.get(
        moderationUserKey(message.platform, message.channelId, message.author.id),
      )
      return sanction && timestamp <= sanction.appliedAt + SANCTION_CLOCK_SKEW_MS
        ? sanction.resolved
        : undefined
    },
  }
}
export const moderationViewStore = persistentResource('moderationView', () =>
  createStore<ModerationView>(createModerationView()),
)
function publishModerationView(): void {
  moderationViewStore.set(createModerationView())
  moderationRevisionStore.modify((revision) => revision + 1)
}
export function moderationOutcomeFor(
  message: NormalizedChatMessage,
): ResolvedModerationOutcome | undefined {
  return moderationViewStore.get().outcomeFor(message)
}

declare module './persistent-resources' {
  interface PersistentResources {
    moderationState: ModerationState
    moderationView: Store<ModerationView>
  }
}

// ── Emote catalog (port of stores/emoteStore.ts) ────────────────────────────

const emoteInflight = new Map<string, Promise<void>>()
const sevenTVVersions = new Map<string, number>()

function emoteKey(platform: string, channelId: string): string {
  return `${platform}:${channelId}`
}

export function setEmoteCatalog(
  platform: string,
  channelId: string,
  emotes: EmoteCatalogEntry[],
): void {
  emoteStore.modify((current) => new Map(current).set(emoteKey(platform, channelId), emotes))
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
  platform: Platform,
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
        platform,
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
    if (isPluginWatchedChannel(channel) || channel.platform === 'youtube') continue
    const platform = channel.platform
    const key = `${platform}:${channel.channelSlug.toLowerCase()}`
    if (requests.some((r) => `${r.platform}:${r.channelLogin.toLowerCase()}` === key)) continue
    requests.push({ channelLogin: channel.channelSlug, platform })
  }

  if (requests.length === 0) return

  try {
    const response = await backend.api.getChannelsStatus({ channels: requests })
    streamStatusStore.modify((current) => {
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
  const poll = () => {
    void tick().catch((error) => console.warn('[stream status]', error))
  }
  poll()
  streamStatusTimer = setInterval(poll, STREAM_STATUS_POLL_MS)
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

/** Last status (and error text) toasted per platform/channel. */
const lastConnectionNotices = new Map<string, string>()

/**
 * Toasts connection transitions. Reconnect loops cycle connecting → error →
 * connecting… every few seconds, so 'connecting' is never toasted (the status
 * strip under the chat shows it) and a repeat of the last toasted status for
 * the same channel is dropped.
 */
export function showConnectionNotice(status: PlatformStatusInfo): void {
  if (status.status === 'connecting') return

  const key = `${status.platform}:${status.channelLogin ?? status.platform}`
  const signature = `${status.status}:${status.error ?? ''}`
  const previous = lastConnectionNotices.get(key)
  if (previous === signature) return
  // Startup reports 'disconnected' for channels that never connected yet —
  // only a drop from a live connection is news.
  if (status.status === 'disconnected' && !previous?.startsWith('connected:')) return
  lastConnectionNotices.set(key, signature)

  const label = status.channelLogin ?? status.platform
  if (status.status === 'connected') {
    showNotice('success', t('notices.app.connected', { name: label }), 3000)
  } else if (status.status === 'disconnected') {
    showNotice('info', t('notices.app.disconnected', { name: label }), 3000)
  } else if (status.status === 'error') {
    showNotice(
      'error',
      status.error
        ? t('notices.app.connectionErrorDetail', { name: label, error: status.error })
        : t('notices.app.connectionError', { name: label }),
      6000,
    )
  }
}

// ── Initial data load (port of App.vue loadInitialData) ─────────────────────

export async function loadInitialData(backend: DesktopBackend): Promise<void> {
  try {
    const [accs, saved, aliases, setts, statList, watched] = await Promise.all([
      backend.api.getAccounts(),
      backend.api.getSavedAccounts(),
      backend.api.getUserAliases(),
      backend.api.getSettings(),
      backend.api.getStatuses(),
      backend.api.getWatchedChannels(),
    ])
    accountsStore.set(accs)
    savedAccountsStore.set(saved)
    aliasesStore.set(aliases)
    settingsStore.set(setts)
    setLanguage(setts.language)
    const statusMap: Partial<Record<Platform, PlatformStatusInfo>> = {}
    for (const s of statList) statusMap[s.platform] = s
    channelStatusStore.set(statusMap)
    watchedChannelsStore.set(watched)

    const [{ initializeChatTabs }, { loadHomePluginChannels }] = await Promise.all([
      import('./chat-tabs'),
      import('./home-plugin-channels'),
    ])
    await Promise.all([initializeChatTabs(backend), loadHomePluginChannels(backend.api)])

    try {
      const watchedStats = await backend.api.getWatchedChannelStatuses()
      watchedStatusesStore.modify((current) => {
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
    if (recent.length > 0) {
      hydrateMessageHistory(recent)
      appendHomeMessages(recent)
    }
  } catch (error) {
    console.warn('[state] Failed to load recent messages:', error)
  }

  for (const ch of watchedChannelsStore.get()) {
    if (isPluginWatchedChannel(ch)) continue
    try {
      const msgs = await backend.api.getWatchedChannelMessages({ id: ch.id })
      if (msgs.length > 0) {
        hydrateMessageHistory(msgs)
        watchedMessagesStore.modify((current) => {
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

/** Quiet chat still appears within one frame. */
const MESSAGE_FLUSH_MS = 16
/** Every publication repaints the visible rows, so a flood shares one per interval. */
const MESSAGE_FLUSH_INTERVAL_MS = 66

// ── Backend event wiring ────────────────────────────────────────────────────

export interface AppStoreBackend {
  events: DesktopEvents
  api: Pick<
    DesktopApi,
    | 'getAccounts'
    | 'getSavedAccounts'
    | 'getWatchedChannels'
    | 'getWatchedChannelMessages'
    | 'getWatchedChannelStatuses'
  >
}
export function wireBackendToStores(backend: AppStoreBackend): () => void {
  const { events } = backend
  const subscriptions: Array<() => void> = []
  const subscribe: typeof events.on = (name, handler) => {
    const unsubscribe = events.on(name, handler)
    subscriptions.push(unsubscribe)
    return unsubscribe
  }
  let pendingHome: NormalizedChatMessage[] = []
  let pendingWatched = new Map<string, NormalizedChatMessage[]>()
  let messageTimer: ReturnType<typeof setTimeout> | undefined
  let lastMessageFlushAt = 0
  subscribe('chat_history_snapshot', ({ messages, watchedChannelId }) => {
    clearTimeout(messageTimer)
    flushMessages()
    hydrateMessageHistory(messages)
    if (watchedChannelId) {
      if (!watchedChannelsStore.get().some((channel) => channel.id === watchedChannelId)) return
      watchedMessagesStore.modify((current) => {
        const existing = current.get(watchedChannelId) ?? []
        const merged = mergeChatMessageSnapshot(existing, messages, 200)
        return merged === existing ? current : new Map(current).set(watchedChannelId, merged)
      })
    } else appendHomeMessages(messages)
  })

  // Coalesce platform bursts into one store publication per frame. The
  // event subscriptions (and this queue) live with the backend singleton,
  // so a hot remount cannot reset or strand messages already received.
  const flushMessages = () => {
    messageTimer = undefined
    lastMessageFlushAt = performance.now()
    const home = pendingHome
    const watched = pendingWatched
    pendingHome = []
    pendingWatched = new Map()
    const activityCounts = new Map<string, number>()
    if (home.length > 0) {
      const filtered = filterHomeChatMessages(home, accountsStore.get())
      const current = homeBuffer.get()
      const result = appendLiveChatMessagesWithCount(current, filtered, HOME_BUFFER_LIMIT)
      activityCounts.set('home', result.newMessageCount)
      homeBuffer.set(result.messages)
    }
    if (watched.size > 0) {
      watchedMessagesStore.modify((current) => {
        let next = current
        for (const [channelId, incoming] of watched) {
          const existing = current.get(channelId) ?? []
          const { messages, newMessageCount } = appendLiveChatMessagesWithCount(
            existing,
            incoming,
            200,
          )
          activityCounts.set(channelId, newMessageCount)
          if (messages === existing) continue
          if (next === current) next = new Map(current)
          next.set(channelId, messages)
        }
        return next
      })
    }
    recordChatActivity(activityCounts)
  }
  const scheduleMessages = () => {
    messageTimer ??= setTimeout(
      flushMessages,
      Math.max(
        MESSAGE_FLUSH_MS,
        lastMessageFlushAt + MESSAGE_FLUSH_INTERVAL_MS - performance.now(),
      ),
    )
  }

  subscribe('chat_message', (msg) => {
    mentionAppearances.addMessage(msg)
    classifyIncomingSimilarity(msg)
    pendingHome.push(msg)
    scheduleMessages()
  })

  subscribe('chat_moderation', (outcome) => {
    applyModerationOutcome(outcome)
  })

  subscribe('platform_status', (s) => {
    showConnectionNotice(s)
    channelStatusStore.modify((current) => ({ ...current, [s.platform]: s }))
  })

  subscribe('channel_emotes_set', ({ platform, channelId, emotes }) => {
    setSevenTVEmotes(platform, channelId, emotes)
  })
  subscribe('channel_emote_catalog', ({ platform, channelId, emotes }) => {
    setEmoteCatalog(platform, channelId, emotes)
  })
  subscribe('author_emote_catalog', ({ platform, authorId, emotes }) => {
    authorEmoteStore.modify((current) => {
      const next = new Map(current)
      next.delete(`${platform}:${authorId}`)
      next.set(`${platform}:${authorId}`, emotes)
      while (next.size > 256) next.delete(next.keys().next().value!)
      return next
    })
  })
  subscribe('channel_emote_added', ({ platform, channelId, emote }) => {
    addSevenTVEmote(platform, channelId, emote)
    showNotice('info', t('notices.app.emoteAdded', { emote: emote.alias, channel: channelId }))
  })
  subscribe('channel_emote_removed', ({ platform, channelId, emoteId }) => {
    removeSevenTVEmote(platform, channelId, emoteId)
    showNotice('info', t('notices.app.emoteRemoved', { channel: channelId }))
  })
  subscribe('channel_emote_updated', ({ platform, channelId, emoteId, newAlias }) => {
    updateSevenTVEmote(platform, channelId, emoteId, newAlias)
    showNotice('info', t('notices.app.emoteRenamed', { emote: newAlias, channel: channelId }))
  })

  subscribe('accounts_changed', () => {
    void Promise.all([
      backend.api.getAccounts(),
      backend.api.getSavedAccounts(),
      backend.api.getWatchedChannels(),
    ])
      .then(([accounts, saved, watched]) => {
        accountsStore.set(accounts)
        savedAccountsStore.set(saved)
        // Forgetting an account returns its chats to the default account.
        watchedChannelsStore.set(watched)
        homeBuffer.modify((messages) => filterHomeChatMessages(messages, accounts))
      })
      .catch((error) => showNotice('error', String(error)))
  })

  const refreshAccounts = async () => {
    const [accs, saved] = await Promise.all([
      backend.api.getAccounts(),
      backend.api.getSavedAccounts(),
    ])
    accountsStore.set(accs)
    savedAccountsStore.set(saved)
  }
  subscribe('auth_success', () => {
    refreshAccounts().catch((error) =>
      showNotice('error', t('notices.app.refreshAccountsFailed', { error: String(error) })),
    )
  })

  subscribe('auth_error', ({ platform, error }) => {
    showNotice('error', t('notices.app.authError', { platform, error }), 6000)
  })

  const queueWatchedMessage = (channelId: string, message: NormalizedChatMessage) => {
    const messages = pendingWatched.get(channelId)
    if (messages) messages.push(message)
    else pendingWatched.set(channelId, [message])
    scheduleMessages()
  }
  subscribe('watched_channel_message', ({ channelId, message }) => {
    mentionAppearances.addMessage(message)
    classifyIncomingSimilarity(message)
    queueWatchedMessage(channelId, message)
  })
  subscribe('twitch_chat_notice', ({ message, watchedChannelId }) => {
    mentionAppearances.addMessage(message)
    if (watchedChannelId) queueWatchedMessage(watchedChannelId, message)
    else {
      pendingHome.push(message)
      scheduleMessages()
    }
  })

  subscribe('watched_channel_status', ({ channelId, status }) => {
    watchedStatusesStore.modify((current) => new Map(current).set(channelId, status))
    if (status.status === 'error') {
      // The buffer may have been wiped server-side; refetch both views.
      void backend.api
        .getWatchedChannelMessages({ id: channelId })
        .then((msgs) => {
          hydrateMessageHistory(msgs)
          watchedMessagesStore.modify((current) => {
            const next = new Map(current)
            next.set(channelId, mergeChatMessageSnapshot(next.get(channelId) ?? [], msgs, 200))
            return next
          })
        })
        .catch((error) =>
          showNotice('error', t('notices.app.refreshHistoryFailed', { error: String(error) })),
        )
      void backend.api
        .getWatchedChannelStatuses()
        .then((stats) => {
          watchedStatusesStore.modify((current) => {
            const next = new Map(current)
            for (const { channelId: id, status: s } of stats) next.set(id, s)
            return next
          })
        })
        .catch((error) =>
          showNotice('error', t('notices.app.refreshStatusFailed', { error: String(error) })),
        )
    }
  })

  return () => {
    for (const unsubscribe of subscriptions) unsubscribe()
    clearTimeout(messageTimer)
    flushMessages()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    settings: Store<AppSettings | null>
    accounts: Store<Account[]>
    savedAccounts: Store<Account[]>
    aliases: Store<UserAlias[]>
    channelStatuses: Store<Partial<Record<Platform, PlatformStatusInfo>>>
    watchedChannels: Store<DesktopWatchedChannel[]>
    watchedMessages: Store<Map<string, NormalizedChatMessage[]>>
    watchedStatuses: Store<Map<string, PlatformStatusInfo>>
    streamStatuses: Store<Map<string, ChannelStatus>>
    emotes: Store<Map<string, EmoteCatalogEntry[]>>
    authorEmotes: Store<Map<string, EmoteCatalogEntry[]>>
    activeMainTab: Store<MainTab>
    tabChannelIds: Store<string[]>
    activeWatchedTab: Store<string>
    tabChannelNames: Store<Map<string, string[]>>
    notice: Store<TransientNotice | null>
    homeMessages: Store<NormalizedChatMessage[]>
    chatActivity: Store<Map<string, ChatActivity>>
    moderationRevision: Store<number>
  }
}
