import { expect, test } from 'bun:test'

import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { filterHomeChatMessages } from '../src/views/main/utils/chat-send-targets'
import { required } from './fixture-values'

const accounts: Account[] = [
  {
    id: 'twitch:1',
    platform: 'twitch',
    platformUserId: '1',
    username: 'MyStreamer',
    displayName: 'MyStreamer',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'kick:2',
    platform: 'kick',
    platformUserId: '2',
    username: 'MyKick',
    displayName: 'MyKick',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
]

function message(
  id: string,
  platform: 'twitch' | 'kick',
  channelId: string,
): NormalizedChatMessage {
  return {
    id,
    platform,
    channelId,
    author: {
      id: 'viewer',
      username: 'viewer',
      displayName: 'Viewer',
      badges: [],
    },
    text: id,
    type: 'message',
    emotes: [],
    timestamp: new Date('2026-07-14T00:00:00.000Z'),
  }
}

test('keeps My channels scoped to the connected account channels', () => {
  const messages = [
    message('twitch-own', 'twitch', 'MYSTREAMER'),
    message('twitch-watched', 'twitch', 'another-streamer'),
    message('kick-own', 'kick', 'mykick'),
    message('kick-watched', 'kick', 'another-kick'),
  ]

  expect(filterHomeChatMessages(messages, accounts).map((item) => item.id)).toEqual([
    'twitch-own',
    'kick-own',
  ])
})

test('history replaces saved Twitch echoes while preserving queued live messages', async () => {
  const {
    accountsStore,
    homeMessagesStore,
    watchedChannelsStore,
    watchedMessagesStore,
    chatActivityStore,
    wireBackendToStores,
  } = await import('../src/gpuix/state/app')
  const { createDesktopEvents } = await import('../src/gpuix/backend/events')
  const events = createDesktopEvents()
  const previous = {
    accounts: accountsStore.get(),
    home: homeMessagesStore.get(),
    channels: watchedChannelsStore.get(),
    watched: watchedMessagesStore.get(),
    activity: chatActivityStore.get(),
  }
  const echo = message('local:twitch:mystreamer:echo', 'twitch', 'MyStreamer')
  accountsStore.set(accounts)
  homeMessagesStore.set([echo])
  watchedChannelsStore.set([
    {
      id: 'watched',
      platform: 'twitch',
      channelSlug: 'mystreamer',
      displayName: 'MyStreamer',
      createdAt: 0,
    },
  ])
  watchedMessagesStore.set(new Map([['watched', [echo]]]))
  chatActivityStore.set(new Map())
  const stop = wireBackendToStores({
    events,
    api: {
      getAccounts: async () => accounts,
      getWatchedChannelMessages: async () => [],
      getWatchedChannelStatuses: async () => [],
    },
  })
  let liveEvents = 0
  const unsubscribe = events.on('chat_message', () => {
    liveEvents++
  })
  try {
    const live = message('same-id', 'twitch', 'MyStreamer')
    const historical = { ...live, text: 'stale historical copy', localTwitchEchoId: echo.id }
    const older = message('older-history', 'twitch', 'mystreamer')
    older.timestamp = new Date('2026-07-13T00:00:00Z')
    events.emit('chat_message', live)
    events.emit('watched_channel_message', { channelId: 'watched', message: live })
    events.emit('chat_history_snapshot', {
      channelId: 'mystreamer',
      messages: [older, historical, older],
    })
    events.emit('chat_history_snapshot', {
      channelId: 'mystreamer',
      watchedChannelId: 'watched',
      messages: [older, historical],
    })
    await Bun.sleep(30)
    const expected = [older, { ...live, localTwitchEchoId: echo.id }]
    expect(homeMessagesStore.get()).toEqual(expected)
    expect(watchedMessagesStore.get().get('watched')).toEqual(expected)
    expect(chatActivityStore.get().get('home')?.total).toBe(1)
    expect(liveEvents).toBe(1)
    events.emit('chat_history_snapshot', {
      channelId: 'mystreamer',
      messages: [older],
      watchedChannelId: 'already-removed',
    })
    expect(watchedMessagesStore.get().has('already-removed')).toBe(false)
  } finally {
    unsubscribe()
    stop()
    accountsStore.set(previous.accounts)
    homeMessagesStore.set(previous.home)
    watchedChannelsStore.set(previous.channels)
    watchedMessagesStore.set(previous.watched)
    chatActivityStore.set(previous.activity)
  }
})

test('keeps real Kick broadcaster IDs while excluding watched channels, even for the same sender', () => {
  const kick = { ...required(accounts[1]), platformUserId: '3195252', username: 'satont' }
  const own = message('kick-canonical-own', 'kick', '3195252')
  own.author = {
    id: '3195252',
    username: 'satont',
    displayName: 'Satont',
    badges: [{ id: 'broadcaster', type: 'broadcaster', text: 'Broadcaster' }],
  }
  const elsewhere = { ...own, id: 'kick-watched', channelId: '999999' }
  const foreignPlatform = message('twitch-same-id', 'twitch', '3195252')
  expect(filterHomeChatMessages([own, elsewhere, foreignPlatform], [kick])).toEqual([own])
})

test('coalesces live bursts per channel without overwriting an in-flight history snapshot', async () => {
  const {
    accountsStore,
    appendHomeMessages,
    chatActivityStore,
    chatMessageRate,
    homeMessagesStore,
    watchedMessagesStore,
    wireBackendToStores,
  } = await import('../src/gpuix/state/app')
  const { createDesktopEvents } = await import('../src/gpuix/backend/events')
  const events = createDesktopEvents()
  const previousAccounts = accountsStore.get()
  const previousHome = homeMessagesStore.get()
  const previousWatched = watchedMessagesStore.get()
  const previousActivity = chatActivityStore.get()
  accountsStore.set(accounts)
  homeMessagesStore.set([])
  watchedMessagesStore.set(new Map())
  chatActivityStore.set(new Map())
  let watchedPublications = 0
  const unsubscribeWatched = watchedMessagesStore.subscribe(() => {
    watchedPublications += 1
  })
  const stop = wireBackendToStores({
    events,
    api: {
      getAccounts: async () => accounts,
      getWatchedChannelMessages: async () => [],
      getWatchedChannelStatuses: async () => [],
    },
  })
  try {
    const first = message('first-live', 'twitch', 'MyStreamer')
    const second = message('second-live', 'twitch', 'MyStreamer')
    second.timestamp = new Date('2026-07-14T00:00:01.000Z')
    events.emit('chat_message', first)
    events.emit('chat_message', second)
    events.emit('chat_message', first)
    events.emit('chat_message', message('foreign', 'twitch', 'other-channel'))
    events.emit('watched_channel_message', { channelId: 'watched', message: first })
    events.emit('watched_channel_message', { channelId: 'watched', message: second })
    expect(homeMessagesStore.get()).toEqual([])
    expect(watchedMessagesStore.get().size).toBe(0)

    const history = message('history', 'kick', 'MyKick')
    history.timestamp = new Date('2026-07-13T23:00:00.000Z')
    appendHomeMessages([history])
    await Bun.sleep(40)
    expect(homeMessagesStore.get()).toEqual([history, first, second])
    expect(watchedMessagesStore.get().get('watched')).toEqual([first, second])
    expect(watchedPublications).toBe(1)
    expect(chatActivityStore.get().get('home')?.total).toBe(2)
    expect(chatActivityStore.get().get('watched')?.total).toBe(2)
    expect(chatMessageRate(chatActivityStore.get().get('home'))).toBe(0.2)

    for (let index = 0; index < 250; index += 1) {
      const incoming = message(`burst-${index}`, 'twitch', 'MyStreamer')
      incoming.timestamp = new Date(Date.parse('2026-07-14T00:00:02.000Z') + index)
      events.emit('watched_channel_message', { channelId: 'watched', message: incoming })
    }
    await Bun.sleep(40)
    expect(watchedMessagesStore.get().get('watched')?.length).toBe(200)
    expect(chatActivityStore.get().get('watched')?.total).toBe(252)

    const retained = watchedMessagesStore.get()
    const activity = chatActivityStore.get()
    events.emit('watched_channel_message', {
      channelId: 'watched',
      message: required(required(watchedMessagesStore.get().get('watched'))[199]),
    })
    await Bun.sleep(40)
    expect(watchedMessagesStore.get()).toBe(retained)
    expect(watchedPublications).toBe(2)
    expect(chatActivityStore.get()).toBe(activity)
    expect(chatMessageRate(activity.get('home'), Date.now() + 11_000)).toBe(0)
    stop()
    events.emit('chat_message', message('after-stop', 'kick', 'MyKick'))
    await Bun.sleep(25)
    expect(homeMessagesStore.get()).toEqual([history, first, second])
  } finally {
    stop()
    unsubscribeWatched()
    accountsStore.set(previousAccounts)
    homeMessagesStore.set(previousHome)
    watchedMessagesStore.set(previousWatched)
    chatActivityStore.set(previousActivity)
  }
})
