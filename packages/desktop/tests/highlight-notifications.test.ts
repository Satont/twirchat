import { afterEach, beforeEach, expect, test } from 'bun:test'

import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { createDesktopEvents } from '../src/gpuix/backend/events'
import type { DesktopBackend } from '../src/gpuix/backend/server'
import { DEFAULT_CHAT_RULES } from '../src/gpuix/message-rules'
import { accountsStore, watchedChannelsStore, watchedStatusesStore } from '../src/gpuix/state/app'
import { chatRulesStore } from '../src/gpuix/state/chat-rules'
import {
  DEFAULT_NOTIFICATIONS,
  highlightFlashStore,
  notificationPreferences,
  parseNotificationPreferences,
  wireHighlightNotifications,
} from '../src/gpuix/state/highlight-notifications'
import {
  classifyIncomingSimilarity,
  messageSimilarityPreferences,
  resetSimilarityHistory,
} from '../src/gpuix/state/message-similarity'
import { streamerModeStore } from '../src/gpuix/state/streamer-mode'
import {
  clearWindowVisibility,
  registerWindowVisibility,
  updateWindowVisibility,
  windowVisibilityStore,
  type WindowVisibility,
} from '../src/gpuix/state/window-visibility'

const account: Account = {
  id: 'notify-test',
  platform: 'twitch',
  platformUserId: 'me',
  username: 'streamer',
  displayName: 'Streamer',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}
const originalSimilarity = messageSimilarityPreferences.store.get()
const originalStreamer = streamerModeStore.get()
const originalRules = chatRulesStore.get()
const originalAccounts = accountsStore.get()
const originalWatchedChannels = watchedChannelsStore.get()
const originalWatchedStatuses = watchedStatusesStore.get()
const originalNotifications = notificationPreferences.store.get()
const originalVisibility = windowVisibilityStore.get()
let off = () => {}
let events: ReturnType<typeof createDesktopEvents>
let calls: Parameters<DesktopBackend['api']['notify']>[0][]
const visibilityRegistrations: Array<() => void> = []
beforeEach(() => {
  accountsStore.set([account])
  watchedChannelsStore.set([])
  watchedStatusesStore.set(new Map())
  calls = []
  events = createDesktopEvents()
  notificationPreferences.store.update({
    value: structuredClone(DEFAULT_NOTIFICATIONS),
  })
  windowVisibilityStore.set({ initialized: false, windows: new Map() })
  updateWindowVisibility('main', 'hidden')
  chatRulesStore.update({
    value: {
      ...structuredClone(DEFAULT_CHAT_RULES),
      highlights: [
        {
          id: 'help',
          pattern: 'help',
          target: 'message',
          enabled: true,
          regex: false,
          caseSensitive: false,
          wholeWord: true,
          color: '#ffcc0080',
          mentions: true,
          sound: true,
          flash: false,
        },
      ],
    },
  })
  off = wireHighlightNotifications({
    events,
    api: {
      notify: async (params) => {
        calls.push(params)
      },
    },
  })
})
afterEach(() => {
  off()
  for (const unregister of visibilityRegistrations.splice(0)) unregister()
  streamerModeStore.set(originalStreamer)
  messageSimilarityPreferences.store.set(originalSimilarity)
  resetSimilarityHistory()
  accountsStore.set(originalAccounts)
  watchedChannelsStore.set(originalWatchedChannels)
  watchedStatusesStore.set(originalWatchedStatuses)
  chatRulesStore.set(originalRules)
  notificationPreferences.store.set(originalNotifications)
  windowVisibilityStore.set(originalVisibility)
  highlightFlashStore.set(new Map())
})
function message(id: string, channel = 'test'): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: channel,
    author: { id: 'viewer', displayName: 'Viewer', badges: [] },
    text: 'I need help',
    emotes: [],
    timestamp: new Date(),
    type: 'message',
  }
}

test('a sound-only highlight uses the sound helper without a desktop popup', () => {
  events.emit('chat_message', message('sound'))
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ sound: true, silent: true, body: 'I need help' })
})
test('one highlighted event received through own and watched paths alerts only once', () => {
  const current = chatRulesStore.get().value
  chatRulesStore.update({
    value: { ...current, highlights: current.highlights.map((rule) => ({ ...rule, flash: true })) },
  })
  const msg = message('dedup')
  events.emit('chat_message', msg)
  events.emit('watched_channel_message', { channelId: 'watched', message: msg })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.silent).toBe(false)
  expect(highlightFlashStore.get().get('twitch:test')?.color).toBe('#ffcc0080')
})
test('muted channels and hidden authors never trigger sounds', () => {
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, mutedChannels: ['twitch:muted'] },
  })
  events.emit('chat_message', message('muted', 'muted'))
  const current = chatRulesStore.get().value
  chatRulesStore.update({
    value: {
      ...current,
      ignores: [
        {
          id: 'ignore',
          pattern: 'Viewer',
          target: 'user',
          enabled: true,
          regex: false,
          caseSensitive: false,
          wholeWord: true,
          userId: 'viewer',
          placeholder: true,
        },
      ],
    },
  })
  events.emit('chat_message', message('hidden'))
  expect(calls).toHaveLength(0)
})
test('alert bursts are throttled per channel and disabling notifications suppresses all effects', () => {
  events.emit('chat_message', message('one'))
  events.emit('chat_message', message('two'))
  events.emit('chat_message', message('three', 'other'))
  expect(calls).toHaveLength(2)
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, enabled: false },
  })
  events.emit('chat_message', message('four', 'new'))
  expect(calls).toHaveLength(2)
})

test('a replay muted by streamer privacy cannot alert after privacy is disabled', () => {
  const msg = message('privacy-muted')
  streamerModeStore.update({ effectiveEnabled: true })
  events.emit('chat_message', msg)
  expect(calls).toHaveLength(0)
  streamerModeStore.update({ effectiveEnabled: false })
  events.emit('watched_channel_message', { channelId: 'watched', message: msg })
  expect(calls).toHaveLength(0)
  events.emit('chat_message', message('fresh-after-privacy'))
  expect(calls).toHaveLength(1)
})

test('messages received with notifications disabled remain deduplicated when enabled', () => {
  const msg = message('disabled-before-replay')
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, enabled: false },
  })
  events.emit('chat_message', msg)
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, enabled: true },
  })
  events.emit('chat_message', msg)
  expect(calls).toHaveLength(0)
  events.emit('chat_message', message('new-notification'))
  expect(calls).toHaveLength(1)
})

test('a replay suppressed by similarity does not alert after highlight policy changes', () => {
  resetSimilarityHistory()
  messageSimilarityPreferences.store.update({
    value: {
      ...originalSimilarity.value,
      enabled: true,
      hideSimilar: false,
      shownSimilarTriggerHighlights: false,
    },
  })
  const first = message('similarity-first')
  const duplicate = { ...message('similarity-muted'), text: first.text }
  classifyIncomingSimilarity(first)
  expect(classifyIncomingSimilarity(duplicate).similar).toBe(true)
  events.emit('chat_message', duplicate)
  expect(calls).toHaveLength(0)
  messageSimilarityPreferences.store.update({
    value: {
      ...messageSimilarityPreferences.store.get().value,
      shownSimilarTriggerHighlights: true,
    },
  })
  events.emit('watched_channel_message', { channelId: 'watched', message: duplicate })
  expect(calls).toHaveLength(0)
  const fresh = { ...duplicate, id: 'similarity-fresh' }
  classifyIncomingSimilarity(fresh)
  events.emit('chat_message', fresh)
  expect(calls).toHaveLength(1)
})

test('mentions and replies notify without requiring a custom sound or flash rule', () => {
  chatRulesStore.update({ value: structuredClone(DEFAULT_CHAT_RULES) })
  events.emit('chat_message', { ...message('mention'), text: '@streamer hello' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ sound: true, silent: false, body: '@streamer hello' })
  events.emit('chat_message', {
    ...message('reply', 'another'),
    text: 'A reply without the username',
    reply: {
      parentMessageId: 'parent',
      parentMessageText: 'Earlier message',
      parentAuthor: { id: 'me', username: 'streamer', displayName: 'Streamer' },
    },
  })
  expect(calls).toHaveLength(2)
})

test('disabling automatic mention alerts preserves custom highlight notifications', () => {
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, mentionsEnabled: false },
  })
  events.emit('chat_message', { ...message('mention-disabled'), text: '@streamer hello' })
  expect(calls).toHaveLength(0)
  events.emit('chat_message', message('custom-rule-still-enabled'))
  expect(calls).toHaveLength(1)
})

test('known bots and excluded usernames are matched case-insensitively with optional platform scopes', () => {
  events.emit('chat_message', {
    ...message('known-bot'),
    author: { id: 'bot', username: '@TwirApp', displayName: 'TwirApp', badges: [] },
    text: '@streamer hello',
  })
  expect(calls).toHaveLength(0)
  notificationPreferences.store.update({
    value: parseNotificationPreferences({
      ...notificationPreferences.store.get().value,
      excludedUsers: ['  kick:@HeLpEr  '],
    }),
  })
  const helper = {
    ...message('scoped-exclusion'),
    author: { id: 'helper', username: 'HELPER', displayName: 'Helper', badges: [] },
    text: '@streamer hello',
  }
  events.emit('chat_message', helper)
  events.emit('chat_message', { ...helper, id: 'kick-scoped', platform: 'kick' })
  expect(calls).toHaveLength(1)
})

test('bot badges can suppress alerts independently of the editable username list', () => {
  const bot = {
    ...message('bot-badge'),
    author: {
      id: 'custom-bot',
      username: 'custombot',
      displayName: 'CustomBot',
      badges: [{ id: 'bot', type: 'bot', text: 'Bot' }],
    },
    text: '@streamer hello',
  }
  events.emit('chat_message', bot)
  expect(calls).toHaveLength(0)
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, excludeBotBadges: false },
  })
  events.emit('chat_message', { ...bot, id: 'bot-badge-allowed' })
  expect(calls).toHaveLength(1)
})

test('a visible inactive window suppresses desktop alerts and sounds while retaining in-app flashes', () => {
  updateWindowVisibility('main', 'visible')
  const current = chatRulesStore.get().value
  chatRulesStore.update({
    value: { ...current, highlights: current.highlights.map((rule) => ({ ...rule, flash: true })) },
  })
  events.emit('chat_message', message('visible'))
  expect(calls).toHaveLength(0)
  expect(highlightFlashStore.get().has('twitch:test')).toBe(true)
  updateWindowVisibility('main', 'hidden')
  events.emit('chat_message', message('hidden-after-visible'))
  expect(calls).toHaveLength(1)
})

test('any visible or unknown extra window suppresses alerts until all app windows are hidden', () => {
  updateWindowVisibility('chat', 'visible')
  events.emit('chat_message', { ...message('extra-visible'), text: '@streamer hello' })
  updateWindowVisibility('chat', 'unknown')
  events.emit('chat_message', { ...message('extra-unknown'), text: '@streamer hello' })
  expect(calls).toHaveLength(0)
  clearWindowVisibility('chat')
  events.emit('chat_message', { ...message('all-hidden'), text: '@streamer hello' })
  expect(calls).toHaveLength(1)
})

test('initial unknown visibility suppresses alerts and never replays them when hidden', () => {
  windowVisibilityStore.set({ initialized: false, windows: new Map() })
  const incoming = { ...message('initial-visibility'), text: '@streamer hello' }
  events.emit('chat_message', incoming)
  updateWindowVisibility('main', 'hidden')
  events.emit('watched_channel_message', { channelId: 'watched', message: incoming })
  expect(calls).toHaveLength(0)
  events.emit('chat_message', { ...incoming, id: 'fresh-hidden' })
  expect(calls).toHaveLength(1)
})

test('closing all known windows permits tray-only alerts and background-only can be disabled', () => {
  clearWindowVisibility('main')
  events.emit('chat_message', { ...message('tray-only'), text: '@streamer hello' })
  expect(calls).toHaveLength(1)
  updateWindowVisibility('main', 'visible')
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, backgroundOnly: false },
  })
  events.emit('chat_message', { ...message('foreground-opt-in', 'other'), text: '@streamer hello' })
  expect(calls).toHaveLength(2)
})

test('the notification gate refreshes native visibility instead of trusting a stale poll', () => {
  let visibility: WindowVisibility = 'hidden'
  visibilityRegistrations.push(registerWindowVisibility('main', () => visibility))
  events.emit('chat_message', { ...message('fresh-hidden'), text: '@streamer hello' })
  expect(calls).toHaveLength(1)
  visibility = 'visible'
  events.emit('chat_message', {
    ...message('shown-between-polls', 'other'),
    text: '@streamer hello',
  })
  expect(calls).toHaveLength(1)
  expect(windowVisibilityStore.get().windows.get('main')).toBe('visible')
})

test('a failed native visibility read suppresses alerts and stale unregister cannot clear its replacement', () => {
  const read = () => {
    throw new Error('Native window visibility unavailable')
  }
  const oldRegistration = registerWindowVisibility('main', read)
  visibilityRegistrations.push(oldRegistration, registerWindowVisibility('main', read))
  oldRegistration()
  expect(windowVisibilityStore.get().windows.get('main')).toBe('unknown')
  events.emit('chat_message', { ...message('visibility-read-failed'), text: '@streamer hello' })
  expect(calls).toHaveLength(0)
})

test('own messages never trigger operating-system alerts', () => {
  events.emit('chat_message', {
    ...message('own'),
    author: { id: 'me', username: 'streamer', displayName: 'Streamer', badges: [] },
    text: '@streamer help',
  })
  expect(calls).toHaveLength(0)
})

test('legacy preferences gain safe mention and visibility defaults while invalid filters are rejected', () => {
  const migrated = parseNotificationPreferences({
    enabled: false,
    soundEnabled: false,
    desktopEnabled: true,
    soundPath: '',
    mutedChannels: ['  Twitch:Some_Channel ', 'twitch:some_channel', ''],
  })
  expect(migrated).toEqual({
    ...DEFAULT_NOTIFICATIONS,
    enabled: false,
    soundEnabled: false,
    mutedChannels: ['twitch:some_channel'],
  })
  expect(() =>
    parseNotificationPreferences({
      ...migrated,
      excludedUsers: Array.from({ length: 1001 }, () => 'bot'),
    }),
  ).toThrow()
  expect(() => parseNotificationPreferences({ ...migrated, backgroundOnly: 'yes' })).toThrow()
})

const kickAccount: Account = {
  ...account,
  id: 'kick:1',
  platform: 'kick',
  platformUserId: '3195252',
  username: 'satont',
  displayName: 'Satont',
}

function kickMessage(id: string, channelId = '3195252'): NormalizedChatMessage {
  return { ...message(id), platform: 'kick', channelId, text: '@satont hello' }
}

test('own Kick channels can be muted by their trusted login or canonical numeric ID', () => {
  accountsStore.set([kickAccount])
  for (const muted of ['kick:satont', 'satont', 'kick:3195252', '3195252']) {
    notificationPreferences.store.update({
      value: { ...notificationPreferences.store.get().value, mutedChannels: [muted] },
    })
    events.emit('chat_message', kickMessage(`muted-own-${muted}`))
  }
  expect(calls).toHaveLength(0)
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, mutedChannels: [] },
  })
  events.emit('chat_message', kickMessage('unmuted-own'))
  expect(calls).toHaveLength(1)
})

test('watched Kick slug mutes follow resolved channel IDs without muting unrelated channels', () => {
  accountsStore.set([kickAccount])
  watchedChannelsStore.set([
    {
      id: 'watch:a',
      platform: 'kick',
      channelSlug: 'OtherStreamer',
      displayName: 'Other',
      createdAt: 0,
    },
    {
      id: 'watch:b',
      platform: 'kick',
      channelSlug: 'different',
      displayName: 'Different',
      createdAt: 0,
    },
  ])
  watchedStatusesStore.set(
    new Map([
      [
        'watch:a',
        { platform: 'kick', mode: 'authenticated', status: 'connected', channelId: '777' },
      ],
      [
        'watch:b',
        { platform: 'kick', mode: 'authenticated', status: 'connected', channelId: '888' },
      ],
    ]),
  )
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, mutedChannels: ['kick:otherstreamer'] },
  })
  events.emit('watched_channel_message', {
    channelId: 'watch:a',
    message: kickMessage('muted-watched', '777'),
  })
  events.emit('chat_message', kickMessage('muted-watched-raw', '777'))
  expect(calls).toHaveLength(0)
  events.emit('watched_channel_message', {
    channelId: 'watch:b',
    message: kickMessage('other-watched', '888'),
  })
  expect(calls).toHaveLength(1)
})

test('trusted watched event routing can mute a channel before its status reaches the UI', () => {
  accountsStore.set([kickAccount])
  watchedChannelsStore.set([
    {
      id: 'watch:a',
      platform: 'kick',
      channelSlug: 'otherstreamer',
      displayName: 'Other',
      createdAt: 0,
    },
  ])
  notificationPreferences.store.update({
    value: { ...notificationPreferences.store.get().value, mutedChannels: ['otherstreamer'] },
  })
  events.emit('watched_channel_message', {
    channelId: 'watch:a',
    message: kickMessage('before-status', '777'),
  })
  expect(calls).toHaveLength(0)
})

test('sender usernames and mismatched watched scope cannot spoof the channel mute key', () => {
  accountsStore.set([kickAccount])
  watchedChannelsStore.set([
    { id: 'watch:a', platform: 'kick', channelSlug: 'muted', displayName: 'Muted', createdAt: 0 },
  ])
  watchedStatusesStore.set(
    new Map([
      [
        'watch:a',
        { platform: 'kick', mode: 'authenticated', status: 'connected', channelId: '777' },
      ],
    ]),
  )
  notificationPreferences.store.update({
    value: {
      ...notificationPreferences.store.get().value,
      mutedChannels: ['muted', 'kick:outsider'],
    },
  })
  events.emit('chat_message', {
    ...kickMessage('sender-not-channel', '888'),
    author: { id: 'viewer', username: 'outsider', displayName: 'Outsider', badges: [] },
  })
  expect(calls).toHaveLength(1)
  events.emit('watched_channel_message', {
    channelId: 'watch:a',
    message: kickMessage('wrong-scope', '999'),
  })
  expect(calls).toHaveLength(2)
})
