import type {
  Account,
  NormalizedChatMessage,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { runInBackground } from '../../services/background-task'
import { deleteOldestEntry } from '../../services/bounded-cache'
import type { DesktopApi } from '../backend/api'
import type { DesktopBackend } from '../backend/server'
import { chatMessageKey, createMentionMatcher } from '../chat-tools'
import { compileMessageRules } from '../message-rules'
import { accountsStore, watchedChannelsStore, watchedStatusesStore } from './app'
import { chatRulesStore } from './chat-rules'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { getMessageSimilarity } from './message-similarity'
import { persistentResource } from './persistent-resources'
import type { PreferenceStore } from './preferences'
import { createPreferenceStore } from './preferences'
import { streamerModeStore } from './streamer-mode'
import { canNotifyVisibility, readWindowVisibility } from './window-visibility'

const DEFAULT_EXCLUDED_USERS = ['twirapp', 'nightbot', 'streamelements', 'streamlabs', 'moobot']

function normalizeUserFilter(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|:)@/g, '$1')
}

function normalizeChannel(value: string): string {
  return value.trim().replace(/^#/u, '').toLowerCase()
}

function kickChannelAliases(
  accounts: readonly Account[],
  watched: readonly WatchedChannel[],
  statuses: ReadonlyMap<string, PlatformStatusInfo>,
): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>()
  function add(id: string, slug: string): void {
    const key = normalizeChannel(id)
    const name = normalizeChannel(slug)
    if (!key || !name) return
    const names = aliases.get(key)
    if (names) names.add(name)
    else aliases.set(key, new Set([name]))
  }
  for (const account of accounts) {
    if (account.platform === 'kick') add(account.platformUserId, account.username)
  }
  for (const channel of watched) {
    const status = statuses.get(channel.id)
    if (channel.platform === 'kick' && status?.platform === 'kick' && status.channelId)
      add(status.channelId, channel.channelSlug)
  }
  return aliases
}

const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  soundEnabled: z.boolean(),
  desktopEnabled: z.boolean(),
  soundPath: z.string().max(4096),
  mutedChannels: z
    .array(z.string().max(256))
    .max(1000)
    .transform((values) => [
      ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    ]),
  mentionsEnabled: z.boolean().default(true),
  backgroundOnly: z.boolean().default(true),
  excludeBotBadges: z.boolean().default(true),
  excludedUsers: z
    .array(z.string().max(160))
    .max(1000)
    .default(DEFAULT_EXCLUDED_USERS)
    .transform((values) => [...new Set(values.map(normalizeUserFilter).filter(Boolean))]),
})

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  enabled: true,
  soundEnabled: true,
  desktopEnabled: true,
  soundPath: '',
  mutedChannels: [],
  mentionsEnabled: true,
  backgroundOnly: true,
  excludeBotBadges: true,
  excludedUsers: [...DEFAULT_EXCLUDED_USERS],
}

export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  return notificationPreferencesSchema.parse(value)
}

export const notificationPreferences = persistentResource('preference:notifications_v1', () =>
  createPreferenceStore('notifications_v1', DEFAULT_NOTIFICATIONS, parseNotificationPreferences),
)
export const highlightFlashStore = persistentResource('highlightFlashes', () =>
  createStore<Map<string, { until: number; color?: string }>>(new Map()),
)
export const notificationErrorStore = persistentResource('notificationError', () =>
  createStore<string | null>(null),
)

export function wireHighlightNotifications(backend: {
  events: DesktopBackend['events']
  api: Pick<DesktopApi, 'notify'>
}): () => void {
  const seen = new Map<string, true>()
  const clocks = new Map<string, number>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let notificationSettings = notificationPreferences.store.get().value
  let excludedUsers = new Set(notificationSettings.excludedUsers)
  let mutedChannels = new Set(notificationSettings.mutedChannels)
  let accounts = accountsStore.get()
  let aliasAccounts = accounts
  let watchedChannels = watchedChannelsStore.get()
  let watchedStatuses = watchedStatusesStore.get()
  let watchedById = new Map(watchedChannels.map((channel) => [channel.id, channel]))
  let channelAliases = kickChannelAliases(accounts, watchedChannels, watchedStatuses)
  let rules = chatRulesStore.get().value
  let ownMention = createMentionMatcher(accounts)
  let engine = compileMessageRules(rules, accounts, (message) => ({
    similar: getMessageSimilarity(message)?.similar,
  }))
  const receive = (message: NormalizedChatMessage, watchedChannelId?: string) => {
    const key = chatMessageKey(message)
    if (seen.has(key)) return
    seen.set(key, true)
    if (seen.size > 8000) deleteOldestEntry(seen)
    const settings = notificationPreferences.store.get().value
    if (!settings.enabled) return
    if (notificationSettings !== settings) {
      notificationSettings = settings
      excludedUsers = new Set(settings.excludedUsers)
      mutedChannels = new Set(settings.mutedChannels)
    }
    if (getMessageSimilarity(message)?.triggerHighlights === false) return
    const streamer = streamerModeStore.get()
    if (streamer.effectiveEnabled && streamer.settings.muteMentions) return
    if (
      aliasAccounts !== accountsStore.get() ||
      watchedChannels !== watchedChannelsStore.get() ||
      watchedStatuses !== watchedStatusesStore.get()
    ) {
      aliasAccounts = accountsStore.get()
      watchedChannels = watchedChannelsStore.get()
      watchedStatuses = watchedStatusesStore.get()
      watchedById = new Map(watchedChannels.map((channel) => [channel.id, channel]))
      channelAliases = kickChannelAliases(aliasAccounts, watchedChannels, watchedStatuses)
    }
    const channelId = normalizeChannel(message.channelId)
    const channel = `${message.platform}:${channelId}`
    const aliases = new Set([channelId])
    if (message.platform === 'kick') {
      for (const alias of channelAliases.get(channelId) ?? []) aliases.add(alias)
      const watched = watchedChannelId ? watchedById.get(watchedChannelId) : undefined
      const status = watchedChannelId ? watchedStatuses.get(watchedChannelId) : undefined
      if (
        watched?.platform === 'kick' &&
        (!status ||
          (status.platform === 'kick' &&
            (!status.channelId || normalizeChannel(status.channelId) === channelId)))
      )
        aliases.add(normalizeChannel(watched.channelSlug))
    }
    if (
      [...aliases].some(
        (alias) => mutedChannels.has(alias) || mutedChannels.has(`${message.platform}:${alias}`),
      )
    )
      return
    if (accounts !== accountsStore.get() || rules !== chatRulesStore.get().value) {
      accounts = accountsStore.get()
      rules = chatRulesStore.get().value
      ownMention = createMentionMatcher(accounts)
      engine = compileMessageRules(rules, accounts, (message) => ({
        similar: getMessageSimilarity(message)?.similar,
      }))
    }
    const classification = engine.classify(message)
    if (classification.hidden) return
    const own = accounts.some(
      (account) =>
        account.platform === message.platform && account.platformUserId === message.author.id,
    )
    const mention =
      settings.mentionsEnabled &&
      classification.mention &&
      ownMention(rules.highlightReplies ? message : { ...message, reply: undefined })
    if (!mention && !classification.sound && !classification.flash) return
    const now = Date.now()
    if (classification.flash) {
      highlightFlashStore.modify((entries) =>
        new Map(entries).set(channel, { until: now + 2000, color: classification.color }),
      )
      clearTimeout(timers.get(channel))
      timers.set(
        channel,
        setTimeout(() => {
          timers.delete(channel)
          highlightFlashStore.modify((entries) => {
            const next = new Map(entries)
            next.delete(channel)
            return next
          })
        }, 2000),
      )
    }
    const author = normalizeUserFilter(message.author.username ?? message.author.displayName)
    if (
      own ||
      excludedUsers.has(author) ||
      excludedUsers.has(`${message.platform}:${author}`) ||
      (settings.excludeBotBadges &&
        message.author.badges.some((badge) => badge.type.toLowerCase() === 'bot')) ||
      (settings.backgroundOnly && !canNotifyVisibility(readWindowVisibility()))
    )
      return
    if (now - (clocks.get(channel) ?? 0) < 1500) return
    clocks.set(channel, now)
    if (clocks.size > 1000) deleteOldestEntry(clocks)
    const sound = settings.soundEnabled && (classification.sound || mention)
    const desktop = settings.desktopEnabled && (classification.flash || mention)
    if (!desktop && !sound) return
    runInBackground(
      backend.api
        .notify({
          title: `${message.author.displayName} · ${message.channelId}`,
          body: classification.message.text,
          sound,
          ...(sound && settings.soundPath ? { soundPath: settings.soundPath } : {}),
          silent: !desktop,
        })
        .catch((error) =>
          notificationErrorStore.set(error instanceof Error ? error.message : String(error)),
        ),
      'highlight-notifications background operation failed',
    )
  }
  const off = [
    backend.events.on('chat_message', receive),
    backend.events.on('watched_channel_message', ({ channelId, message }) =>
      receive(message, channelId),
    ),
  ]
  return () => {
    for (const unsubscribe of off) unsubscribe()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    'preference:notifications_v1': PreferenceStore<typeof DEFAULT_NOTIFICATIONS>
    highlightFlashes: Store<Map<string, { until: number; color?: string }>>
    notificationError: Store<string | null>
  }
}
