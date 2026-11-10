import { expect, test, afterEach } from 'bun:test'

import type {
  NormalizedChatMessage,
  WatchedChannel,
  WatchedChannelsLayout,
} from '@twirchat/shared/types'

import {
  activeTabStore,
  activeWatchedTabStore,
  homeMessagesStore,
  noticeStore,
  tabChannelIdsStore,
  watchedChannelsStore,
  watchedMessagesStore,
} from '../src/gpuix/state/app'
import {
  buildChatSearchSnapshot,
  captureOpenChatSnapshot,
  searchChatSnapshot,
  resolveChatSearchJump,
  requestChatSearchJump,
  finishChatSearchJump,
  chatSearchJumpStore,
  type ChatSearchInput,
} from '../src/gpuix/state/chat-search'
import {
  registerChatWindow,
  registerChatWindowManager,
  registerChatWindowNavigator,
} from '../src/gpuix/state/chat-windows'
import { layoutStore } from '../src/gpuix/state/layout'
import { required } from './fixture-values'

const message = (
  id: string,
  channelId = 'room',
  platform: NormalizedChatMessage['platform'] = 'twitch',
): NormalizedChatMessage => ({
  id,
  channelId,
  platform,
  author: { id: 'alice-id', username: 'alice', displayName: 'Alice', badges: [] },
  text: 'hello chat',
  timestamp: new Date('2026-11-01'),
  type: 'message',
  emotes: [],
})
const channel = (id: string): WatchedChannel => ({
  id,
  platform: 'twitch',
  channelSlug: id,
  displayName: id,
  createdAt: 0,
})
const layout = (ids: string[]): WatchedChannelsLayout => ({
  version: 2,
  root: {
    type: 'split',
    id: 'split',
    direction: 'horizontal',
    flex: 100,
    children: ids.map((id, index) => ({
      type: 'panel',
      id: String(index),
      flex: 100 / ids.length,
      content: id === 'home' ? { type: 'main' } : { type: 'watched', channelId: id },
    })),
  },
})
function input(): ChatSearchInput {
  return {
    tabIds: ['tab-a', 'tab-b'],
    layouts: new Map([
      ['tab-a', layout(['room', 'other'])],
      ['tab-b', layout(['room', 'home'])],
      ['closed-tab', layout(['closed'])],
    ]),
    channels: ['room', 'other', 'closed'].map(channel),
    homeMessages: [message('mine', 'own')],
    watchedMessages: new Map([
      ['room', [message('m')]],
      ['other', [message('other', 'other')]],
      ['closed', [message('secret', 'closed')]],
    ]),
  }
}
afterEach(() => {
  chatSearchJumpStore.set(null)
  homeMessagesStore.set([])
  watchedMessagesStore.set(new Map())
  layoutStore.set(new Map())
  tabChannelIdsStore.set([])
  watchedChannelsStore.set([])
  noticeStore.set(null)
})

test('home searches target the actual split pane after the home layout is split', () => {
  const source = input()
  source.layouts = new Map(source.layouts).set('home', layout(['home', 'room']))
  const snapshot = buildChatSearchSnapshot(source)
  const own = required(snapshot.results.find((result) => result.message.id === 'mine'))
  expect(own.locations.filter((location) => location.tabId === 'home')).toEqual([
    { tabId: 'home', paneId: 'home:0', watchedChannelId: null },
  ])
  expect(resolveChatSearchJump(own, source)).toEqual({
    tabId: 'home',
    paneId: 'home:0',
    watchedChannelId: null,
  })
})

test('search keeps detached windows available after main closes and jumps in their own window', async () => {
  let activated = 0,
    navigated = 0
  const stopManager = registerChatWindowManager()
  const stopMain = registerChatWindow('main', { activate: () => {} })
  const stopChild = registerChatWindow('window:child', {
    tabId: 'window:layout',
    activate: () => {
      activated++
    },
  })
  const stopNavigation = registerChatWindowNavigator('window:child', () => {
    navigated++
  })
  try {
    tabChannelIdsStore.set(['main-tab'])
    watchedChannelsStore.set([channel('room')])
    homeMessagesStore.set([message('own', 'own')])
    watchedMessagesStore.set(new Map([['room', [message('detached')]]]))
    layoutStore.set(
      new Map([['window:layout', { layout: layout(['room']), isLoading: false, error: null }]]),
    )
    activeWatchedTabStore.set('main-tab')
    stopMain()
    const snapshot = await captureOpenChatSnapshot({ getWatchedChannelsLayout: async () => null })
    expect(snapshot.results.map((result) => result.message.id)).toEqual(['detached'])
    expect(snapshot.unavailableTabs).toEqual([])
    expect(requestChatSearchJump(required(snapshot.results[0]), 'window:child')).toBe(true)
    expect(chatSearchJumpStore.get()?.target).toEqual({
      tabId: 'window:layout',
      paneId: 'window:layout:0',
      watchedChannelId: 'room',
      windowId: 'window:child',
    })
    expect([activated, navigated]).toEqual([1, 1])
    expect(activeWatchedTabStore.get()).toBe('main-tab')
    finishChatSearchJump(required(chatSearchJumpStore.get()).requestId, true)
  } finally {
    stopMain()
    stopChild()
    stopNavigation()
    stopManager()
  }
})

test('capture reads buffers at completion and excludes tabs closed while layouts are loading', async () => {
  tabChannelIdsStore.set(['pending', 'stable'])
  watchedChannelsStore.set([channel('room')])
  watchedMessagesStore.set(new Map([['room', [message('before')]]]))
  layoutStore.set(
    new Map([['stable', { layout: layout(['room']), isLoading: false, error: null }]]),
  )
  const { promise: resolvePromise, resolve } = Promise.withResolvers<WatchedChannelsLayout>()
  const pending = captureOpenChatSnapshot({
    getWatchedChannelsLayout: () => resolvePromise,
  })
  tabChannelIdsStore.set(['stable', 'newly-opened'])
  watchedMessagesStore.set(new Map([['room', [message('after')]]]))
  const changedAt = Date.now()
  resolve(layout(['room']))
  const snapshot = await pending
  expect(snapshot.results.map((result) => result.message.id)).toEqual(['after'])
  expect(required(snapshot.results[0]).locations.map((location) => location.tabId)).toEqual([
    'stable',
  ])
  expect(snapshot.capturedAt).toBeGreaterThanOrEqual(changedAt)
  expect(snapshot.unavailableTabs).toEqual(['newly-opened'])
  expect(layoutStore.get().has('pending')).toBe(false)
})

test('a superseded capture cannot populate a stale layout before the newest capture completes', async () => {
  tabChannelIdsStore.set(['tab'])
  watchedChannelsStore.set([channel('old'), channel('new')])
  watchedMessagesStore.set(
    new Map([
      ['old', [message('old', 'old')]],
      ['new', [message('new', 'new')]],
    ]),
  )
  const { promise: resolveOldPromise, resolve: resolveOld } =
    Promise.withResolvers<WatchedChannelsLayout>()
  const { promise: resolveNewPromise, resolve: resolveNew } =
    Promise.withResolvers<WatchedChannelsLayout>()
  const first = captureOpenChatSnapshot({
    getWatchedChannelsLayout: () => resolveOldPromise,
  })
  const second = captureOpenChatSnapshot({
    getWatchedChannelsLayout: () => resolveNewPromise,
  })
  resolveOld(layout(['old']))
  const stale = await first
  expect(stale.unavailableTabs).toEqual(['tab'])
  expect(layoutStore.get().has('tab')).toBe(false)
  resolveNew(layout(['new']))
  expect((await second).results.map((result) => result.message.id)).toEqual(['new'])
})

test('closing search aborts pending layout hydration without mutating global layout state', async () => {
  tabChannelIdsStore.set(['pending'])
  const { promise: resolvePromise, resolve } = Promise.withResolvers<WatchedChannelsLayout>()
  const controller = new AbortController()
  const pending = captureOpenChatSnapshot(
    {
      getWatchedChannelsLayout: () => resolvePromise,
    },
    controller.signal,
  )
  controller.abort()
  resolve(layout(['room']))
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(layoutStore.get().has('pending')).toBe(false)
})

test('captures actual open layout assignments, home panes and excludes unopened saved channel buffers', () => {
  const snapshot = buildChatSearchSnapshot(input())
  expect(snapshot.results.map((result) => result.message.id).sort()).toEqual(['m', 'mine', 'other'])
  expect(snapshot.sourceCount).toBe(3)
  const repeated = required(snapshot.results.find((result) => result.message.id === 'm'))
  expect(repeated.locations.map((location) => location.paneId)).toEqual(['tab-a:0', 'tab-b:0'])
  expect(
    required(snapshot.results.find((result) => result.message.id === 'mine')).locations,
  ).toHaveLength(2)
})

test('combined feed search uses the source channel identity and navigates to the shared pane', () => {
  const source = input()
  source.tabIds = ['feed']
  source.layouts = new Map<string, WatchedChannelsLayout>([
    [
      'feed',
      {
        version: 2,
        root: {
          type: 'panel',
          id: 'combined',
          flex: 100,
          content: { type: 'feed', sources: [{ channelId: 'room' }, { channelId: 'other' }] },
        },
      },
    ],
  ])
  source.watchedMessages = new Map(source.watchedMessages).set('other', [
    message('m', '1234', 'kick'),
  ])
  const snapshot = buildChatSearchSnapshot(source)
  const kick = required(snapshot.results.find((result) => result.message.platform === 'kick'))
  expect(snapshot.sourceCount).toBe(3)
  expect(kick.details.channelName).toBe('other')
  expect(resolveChatSearchJump(kick, source)).toMatchObject({
    tabId: 'feed',
    paneId: 'feed:combined',
    watchedChannelId: 'other',
  })
})

test('freezes nested messages, metadata and aliases until explicit new capture', () => {
  const source = input()
  source.detailsFor = () => ({ alias: 'Friendly Alice', highlighted: true })
  const snapshot = buildChatSearchSnapshot(source, 123)
  required(source.homeMessages[0]).text = 'changed'
  required(source.homeMessages[0]).author.displayName = 'Changed'
  required(source.watchedMessages.get('room')).push(message('later'))
  expect(snapshot.capturedAt).toBe(123)
  expect(
    searchChatSnapshot(snapshot, 'from:"Friendly Alice" hello is:highlighted').results,
  ).toHaveLength(3)
  expect(
    required(snapshot.results.find((result) => result.message.id === 'mine')).message.author
      .displayName,
  ).toBe('Alice')
  expect(snapshot.results.some((result) => result.message.id === 'later')).toBe(false)
  expect(
    buildChatSearchSnapshot(source).results.some((result) => result.message.id === 'later'),
  ).toBe(true)
})

test('deduplicates only composite provider/channel/message identities and supports frozen PCRE queries', () => {
  const source = input()
  required(source.watchedMessages.get('room')).push(
    message('m', 'another'),
    message('m', 'room', 'kick'),
  )
  const snapshot = buildChatSearchSnapshot(source)
  expect(snapshot.results.filter((result) => result.message.id === 'm')).toHaveLength(3)
  expect(
    searchChatSnapshot(snapshot, String.raw`regex:"(?<=hello )\w+" platform:kick`).results,
  ).toHaveLength(1)
})

test('jump resolves another open pane if original closes and refuses evicted or wrong-channel IDs', () => {
  const source = input()
  const result = required(
    buildChatSearchSnapshot(source).results.find((result) => result.message.id === 'm'),
  )
  source.tabIds = ['tab-b']
  expect(resolveChatSearchJump(result, source)?.paneId).toBe('tab-b:0')
  source.watchedMessages = new Map(source.watchedMessages).set('room', [
    message('m', 'different-channel'),
  ])
  expect(resolveChatSearchJump(result, source)).toBeNull()
  source.watchedMessages = new Map(source.watchedMessages).set('room', [])
  expect(resolveChatSearchJump(result, source)).toBeNull()
})

test('jump activates exact split and completion cannot clear a newer request', () => {
  const source = input()
  tabChannelIdsStore.set([...source.tabIds])
  watchedChannelsStore.set([...source.channels])
  homeMessagesStore.set([...source.homeMessages])
  watchedMessagesStore.set(new Map(source.watchedMessages))
  layoutStore.set(
    new Map(
      [...source.layouts].map(([id, value]) => [
        id,
        { layout: value, isLoading: false, error: null },
      ]),
    ),
  )
  const result = required(
    buildChatSearchSnapshot(source).results.find((entry) => entry.message.id === 'm'),
  )
  expect(requestChatSearchJump(result)).toBe(true)
  const first = required(chatSearchJumpStore.get())
  expect(activeTabStore.get()).toBe('chat')
  expect(activeWatchedTabStore.get()).toBe('tab-a')
  expect(first.target.paneId).toBe('tab-a:0')
  expect(first.messageKey).toBe('twitch:room:m')
  expect(requestChatSearchJump(result)).toBe(true)
  finishChatSearchJump(first.requestId, true)
  expect(chatSearchJumpStore.get()?.requestId).not.toBe(first.requestId)
  finishChatSearchJump(required(chatSearchJumpStore.get()).requestId, false)
  expect(chatSearchJumpStore.get()).toBeNull()
  expect(noticeStore.get()?.text).toContain('refresh search')
  watchedMessagesStore.set(new Map())
  expect(requestChatSearchJump(result)).toBe(false)
  expect(noticeStore.get()?.text).toContain('no longer')
})

test('loads inactive open layouts with bounded concurrency and reports failures without guessing tab IDs', async () => {
  const ids = Array.from({ length: 7 }, (_, i) => `tab-${i}`)
  tabChannelIdsStore.set(ids)
  watchedChannelsStore.set([channel('assigned')])
  watchedMessagesStore.set(
    new Map([
      ['assigned', [message('assigned-message', 'assigned')]],
      ['tab-0', [message('wrong-buffer')]],
    ]),
  )
  let active = 0,
    maximum = 0
  const snapshot = await captureOpenChatSnapshot({
    getWatchedChannelsLayout: async ({ tabId }) => {
      active++
      maximum = Math.max(maximum, active)
      await Bun.sleep(2)
      active--
      if (tabId === 'tab-6') throw new Error('Unavailable')
      return layout(['assigned'])
    },
  })
  expect(maximum).toBeLessThanOrEqual(4)
  expect(maximum).toBeGreaterThan(1)
  expect(snapshot.results.map((result) => result.message.id)).toEqual(['assigned-message'])
  expect(required(snapshot.results[0]).locations).toHaveLength(6)
  expect(snapshot.unavailableTabs).toEqual(['tab-6'])
})
