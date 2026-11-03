import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type {
  Account,
  NormalizedChatMessage,
  PanelNode,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import { createDesktopEvents } from '../src/gpuix/backend/events'
import {
  accountsStore,
  activeTabStore,
  activeWatchedTabStore,
  tabChannelIdsStore,
  watchedChannelsStore,
} from '../src/gpuix/state/app'
import { layoutStore } from '../src/gpuix/state/layout'
import { clearTabUnread, tabUnreadStore, wireTabUnread } from '../src/gpuix/state/tab-unread'

const account: Account = {
  id: 'twitch:me',
  platform: 'twitch',
  platformUserId: 'me',
  username: 'streamer',
  displayName: 'Streamer',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}

function message(id: string, text = 'hello'): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'streamer',
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    text,
    emotes: [],
    type: 'message',
    timestamp: new Date(),
  }
}

function layout(...contents: PanelNode['content'][]): WatchedChannelsLayout {
  return {
    version: 2,
    root: {
      id: 'split',
      type: 'split',
      direction: 'vertical',
      flex: 100,
      children: contents.map((content, index) => ({
        id: `panel-${index}`,
        type: 'panel',
        flex: 100 / contents.length,
        content,
      })),
    },
  }
}

describe('tab unread activity', () => {
  let events = createDesktopEvents()
  let stop = () => {}
  let previous: {
    accounts: ReturnType<typeof accountsStore.get>
    main: ReturnType<typeof activeTabStore.get>
    active: string
    tabs: string[]
    watched: ReturnType<typeof watchedChannelsStore.get>
    layouts: ReturnType<typeof layoutStore.get>
    unread: ReturnType<typeof tabUnreadStore.get>
  }

  beforeEach(() => {
    previous = {
      accounts: accountsStore.get(),
      main: activeTabStore.get(),
      active: activeWatchedTabStore.get(),
      tabs: tabChannelIdsStore.get(),
      watched: watchedChannelsStore.get(),
      layouts: layoutStore.get(),
      unread: tabUnreadStore.get(),
    }
    accountsStore.set([account])
    activeTabStore.set('chat')
    activeWatchedTabStore.set('home')
    tabChannelIdsStore.set(['a', 'b', 'c'])
    watchedChannelsStore.set(
      ['a', 'b', 'c'].map((id) => ({
        id,
        platform: 'twitch',
        channelSlug: id,
        displayName: id,
        createdAt: 0,
      })),
    )
    layoutStore.set(new Map())
    tabUnreadStore.set(new Map())
    events = createDesktopEvents()
    stop = wireTabUnread({ events })
  })

  afterEach(() => {
    stop()
    accountsStore.set(previous.accounts)
    activeTabStore.set(previous.main)
    activeWatchedTabStore.set(previous.active)
    tabChannelIdsStore.set(previous.tabs)
    watchedChannelsStore.set(previous.watched)
    layoutStore.set(previous.layouts)
    tabUnreadStore.set(previous.unread)
  })

  test('batches inactive messages, counts mentions/replies, and deduplicates events', async () => {
    const normal = message('normal')
    const mention = message('mention', '@streamer hello')
    const reply = message('reply')
    reply.reply = {
      parentMessageId: 'parent',
      parentMessageText: 'earlier',
      parentAuthor: { id: 'me', username: 'streamer', displayName: 'Streamer' },
    }
    for (const incoming of [normal, mention, reply, mention]) {
      events.emit('watched_channel_message', { channelId: 'a', message: incoming })
    }
    events.emit('watched_channel_message', { channelId: 'unknown', message: normal })
    events.emit('watched_channel_message', {
      channelId: 'a',
      message: { ...normal, id: 'system', type: 'system' },
    })
    expect(tabUnreadStore.get().size).toBe(0)
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('a')).toEqual({ unread: 3, mentions: 2, color: '#a78bfa' })
    expect(tabUnreadStore.get().has('unknown')).toBe(false)
  })

  test('does not count visible chat and clears a burst when its tab opens', async () => {
    events.emit('chat_message', message('visible-home'))
    events.emit('watched_channel_message', { channelId: 'a', message: message('before-open') })
    activeWatchedTabStore.set('a')
    events.emit('watched_channel_message', { channelId: 'a', message: message('visible-a') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().size).toBe(0)
    activeTabStore.set('settings')
    events.emit('watched_channel_message', { channelId: 'a', message: message('hidden-a') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('a')?.unread).toBe(1)
    activeTabStore.set('chat')
    await Bun.sleep(5)
    expect(tabUnreadStore.get().has('a')).toBe(false)
  })

  test('home counts only own channels while another main screen is open', async () => {
    activeTabStore.set('events')
    events.emit('chat_message', message('own', 'Streamer!'))
    events.emit('chat_message', { ...message('foreign'), channelId: 'another-channel' })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('home')).toEqual({ unread: 1, mentions: 1, color: '#a78bfa' })
    clearTabUnread('home')
    events.emit('chat_message', message('queued'))
    clearTabUnread('home')
    await Bun.sleep(35)
    expect(tabUnreadStore.get().has('home')).toBe(false)
  })

  test('routes splits to the channels they contain and invalidates routes after reassignment', async () => {
    layoutStore.set(
      new Map([
        [
          'a',
          {
            layout: layout(
              { type: 'watched', channelId: 'b' },
              { type: 'watched', channelId: 'b' },
              { type: 'main' },
            ),
            isLoading: false,
            error: null,
          },
        ],
        [
          'b',
          { layout: layout({ type: 'watched', channelId: 'c' }), isLoading: false, error: null },
        ],
      ]),
    )
    events.emit('watched_channel_message', { channelId: 'b', message: message('b') })
    events.emit('watched_channel_message', { channelId: 'c', message: message('c') })
    events.emit('watched_channel_message', { channelId: 'a', message: message('not-in-layout') })
    events.emit('chat_message', message('own'))
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('a')).toEqual({ unread: 2, mentions: 0 })
    expect(tabUnreadStore.get().get('b')).toEqual({ unread: 1, mentions: 0 })
    expect(tabUnreadStore.get().get('c')).toEqual({ unread: 1, mentions: 0 })

    clearTabUnread('a')
    layoutStore.modify((current) =>
      new Map(current).set('a', {
        layout: layout({ type: 'watched', channelId: 'c' }),
        isLoading: false,
        error: null,
      }),
    )
    events.emit('watched_channel_message', { channelId: 'b', message: message('b-after') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().has('a')).toBe(false)
    events.emit('watched_channel_message', { channelId: 'c', message: message('c-after') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('a')?.unread).toBe(1)
  })

  test('compiles new mention identities when accounts change and removes closed tabs', async () => {
    accountsStore.set([{ ...account, username: 'newname', displayName: 'NewName' }])
    events.emit('watched_channel_message', { channelId: 'a', message: message('old', '@streamer') })
    events.emit('watched_channel_message', { channelId: 'a', message: message('new', '@newname') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().get('a')).toEqual({ unread: 2, mentions: 1, color: '#a78bfa' })
    tabChannelIdsStore.set(['b', 'c'])
    await Bun.sleep(5)
    expect(tabUnreadStore.get().has('a')).toBe(false)
    stop()
    events.emit('watched_channel_message', { channelId: 'b', message: message('stopped') })
    await Bun.sleep(35)
    expect(tabUnreadStore.get().has('b')).toBe(false)
  })
})
