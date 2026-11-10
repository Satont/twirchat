import { afterEach, expect, test } from 'bun:test'

import type { WatchedChannel, WatchedChannelsLayout } from '@twirchat/shared/types'

import type { DesktopApi } from '../src/gpuix/backend/api'
import { watchedChannelsStore } from '../src/gpuix/state/app'
import { chatTabsStore } from '../src/gpuix/state/chat-tabs'
import { chatWindowsStore } from '../src/gpuix/state/chat-windows'
import {
  homePluginChannelsStore,
  homePluginFeedStore,
  observeHomePluginFeed,
  setHomePluginChannel,
} from '../src/gpuix/state/home-plugin-channels'
import { layoutStore } from '../src/gpuix/state/layout'
import {
  createWatchedSubscriptionController,
  liveLayoutTabIds,
  referencedPaneAccounts,
  referencedWatchedChannels,
  wireActiveWatchedChannels,
  type WatchedReferenceSnapshot,
} from '../src/gpuix/state/watched-subscriptions'
import type { PluginWatchedChannel } from '../src/watched-channels/plugin-channel-types'
import type { PluginChannelMessage } from '../src/watched-channels/plugin-channels'

const originalTabs = chatTabsStore.get()
const originalWindows = chatWindowsStore.get()
const originalLayouts = layoutStore.get()
const originalChannels = watchedChannelsStore.get()
const originalHomeSources = homePluginChannelsStore.get()
const originalHomeFeed = homePluginFeedStore.get()
type Observer = Parameters<DesktopApi['observePluginChannel']>[1]
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop()
  chatTabsStore.set(originalTabs)
  chatWindowsStore.set(originalWindows)
  layoutStore.set(originalLayouts)
  watchedChannelsStore.set(originalChannels)
  homePluginChannelsStore.set(originalHomeSources)
  homePluginFeedStore.set(originalHomeFeed)
})

function channel(id: string): WatchedChannel {
  return { id, channelSlug: id, displayName: id, platform: 'twitch', createdAt: 0 }
}
function pluginChannel(id = crypto.randomUUID()): PluginWatchedChannel {
  return {
    ...channel(id),
    kind: 'plugin',
    platform: 'plugin:streamx:chat',
    transportName: 'StreamX',
  }
}
function layout(...ids: string[]): WatchedChannelsLayout {
  const first = ids[0]
  if (ids.length < 2)
    return {
      version: 2,
      root: {
        type: 'panel',
        id: 'panel',
        flex: 100,
        content: first ? { type: 'watched', channelId: first } : { type: 'empty' },
      },
    }
  return {
    version: 2,
    root: {
      type: 'split',
      id: 'root',
      flex: 100,
      direction: 'vertical',
      children: ids.map((id, index) => ({
        type: 'panel',
        id: `${index}`,
        flex: 100 / ids.length,
        content: { type: 'watched', channelId: id },
      })),
    },
  }
}
async function settle(): Promise<void> {
  await Bun.sleep(15)
}

test('counts all open layouts once and ignores closed history, orphan layouts and unknown channels', () => {
  const snapshot: WatchedReferenceSnapshot = {
    ready: true,
    tabIds: ['open-a', 'open-b', 'popup'],
    channels: ['shared', 'second', 'popup', 'orphan'].map(channel),
    layouts: new Map([
      ['open-a', layout('shared', 'shared')],
      ['open-b', layout('shared', 'second', 'not-saved')],
      ['popup', layout('popup')],
      ['closed-tab', layout('orphan')],
    ]),
  }
  expect(referencedWatchedChannels(snapshot)).toEqual(['popup', 'second', 'shared'])
  snapshot.tabIds = ['open-b', 'popup']
  expect(referencedWatchedChannels(snapshot)).toEqual(['popup', 'second', 'shared'])
  snapshot.tabIds = ['popup']
  expect(referencedWatchedChannels(snapshot)).toEqual(['popup'])
})

function withAccount(channelId: string, accountId: string): WatchedChannelsLayout {
  return {
    version: 2,
    root: {
      type: 'panel',
      id: `${channelId}-${accountId}`,
      flex: 100,
      content: { type: 'watched', channelId, accountId },
    },
  }
}

test('pane accounts count only live layouts, including detached windows', () => {
  const snapshot: WatchedReferenceSnapshot = {
    ready: true,
    tabIds: ['open', 'window:popup'],
    channels: ['shared', 'other'].map(channel),
    layouts: new Map([
      ['open', withAccount('shared', 'twitch:alt')],
      ['window:popup', withAccount('shared', 'twitch:bot')],
      ['closed', withAccount('shared', 'twitch:old')],
      ['unknown', withAccount('gone', 'twitch:alt')],
    ]),
  }
  expect(referencedPaneAccounts(snapshot)).toEqual({ shared: ['twitch:alt', 'twitch:bot'] })
  snapshot.tabIds = ['open']
  expect(referencedPaneAccounts(snapshot)).toEqual({ shared: ['twitch:alt'] })

  const tabs = { ...chatTabsStore.get(), value: { ...chatTabsStore.get().value, openIds: ['a'] } }
  expect(liveLayoutTabIds(tabs, new Map([['main', { activate() {} }]]))).toEqual(['home', 'a'])
  expect(
    liveLayoutTabIds(
      tabs,
      new Map([
        ['main', { activate() {} }],
        ['popup', { tabId: 'window:popup', activate() {} }],
      ]),
    ),
  ).toEqual(['home', 'a', 'window:popup'])
})

test('a feed joins every available channel and preserves per-source sender accounts', () => {
  const snapshot: WatchedReferenceSnapshot = {
    ready: true,
    tabIds: ['feed'],
    channels: [channel('twitch'), { ...channel('kick'), platform: 'kick' }],
    layouts: new Map<string, WatchedChannelsLayout>([
      [
        'feed',
        {
          version: 2,
          root: {
            type: 'panel',
            id: 'combined',
            flex: 100,
            content: {
              type: 'feed',
              sources: [
                { channelId: 'twitch', accountId: 'twitch:bot' },
                { channelId: 'kick', accountId: 'kick:bot' },
                { channelId: 'gone', accountId: 'twitch:old' },
              ],
            },
          },
        },
      ],
    ]),
  }
  expect(referencedWatchedChannels(snapshot)).toEqual(['kick', 'twitch'])
  expect(referencedPaneAccounts(snapshot)).toEqual({ kick: ['kick:bot'], twitch: ['twitch:bot'] })
})

test('a closed tab cannot reconnect after its slow initial layout load completes', async () => {
  const gate = Promise.withResolvers<void>()
  const published: string[][] = []
  const failures: unknown[] = []
  const snapshot: WatchedReferenceSnapshot = {
    ready: true,
    tabIds: ['closing'],
    channels: [channel('old')],
    layouts: new Map(),
  }
  const controller = createWatchedSubscriptionController({
    read: () => snapshot,
    load: async () => {
      await gate.promise
    },
    publish: async (ids) => {
      published.push(ids)
    },
    failed: (error) => {
      failures.push(error)
    },
  })
  const first = controller.refresh()
  snapshot.tabIds = []
  await controller.refresh()
  snapshot.layouts = new Map([['closing', layout('old')]])
  gate.resolve()
  await first
  expect(published).toEqual([[]])
  expect(failures).toEqual([])
  controller.stop()
})

test('UI wiring keeps a channel in another tab or native window and disconnects its last reference', async () => {
  const published: string[][] = []
  const saved = new Map([
    ['home', layout('shared', 'shared')],
    ['tab', layout('shared')],
    ['popup', layout('shared')],
    ['orphan', layout('orphan')],
  ])
  watchedChannelsStore.set([channel('shared'), channel('orphan')])
  layoutStore.set(new Map())
  chatTabsStore.set({
    value: { version: 1, openIds: ['tab'], metadata: {}, closed: [] },
    loaded: false,
    saving: false,
    error: null,
  })
  chatWindowsStore.set(
    new Map([
      ['main', { activate() {} }],
      ['popup', { tabId: 'popup', activate() {} }],
    ]),
  )
  const stop = wireActiveWatchedChannels({
    api: {
      getWatchedChannelsLayout: async ({ tabId }) => saved.get(tabId) ?? null,
      setWatchedChannelsLayout: async ({ tabId, layout: value }) => {
        saved.set(tabId, value)
      },
      setActiveWatchedChannels: async ({ ids }) => {
        published.push(ids)
      },
      observePluginChannel: () => () => {},
    },
  })
  cleanups.push(stop)
  await settle()
  expect(published).toEqual([])
  chatTabsStore.update({ loaded: true })
  await settle()
  expect(published.at(-1)).toEqual(['shared'])
  expect(layoutStore.get().has('orphan')).toBe(false)
  chatTabsStore.modify((state) => ({ ...state, value: { ...state.value, openIds: [] } }))
  layoutStore.modify((states) =>
    new Map(states).set('home', { layout: layout(), isLoading: false, error: null }),
  )
  await settle()
  expect(published.at(-1)).toEqual(['shared'])
  chatWindowsStore.set(new Map([['main', { activate() {} }]]))
  await settle()
  expect(published.at(-1)).toEqual([])
  chatTabsStore.modify((state) => ({ ...state, value: { ...state.value, openIds: ['tab'] } }))
  await settle()
  expect(published.at(-1)).toEqual(['shared'])
})

test('selected plugin sources share layout references and require an open combined pane', () => {
  const source = pluginChannel()
  const normal = channel('normal')
  const snapshot: WatchedReferenceSnapshot = {
    ready: true,
    tabIds: ['home', 'split'],
    channels: [source, normal],
    layouts: new Map([
      [
        'home',
        { version: 2, root: { type: 'panel', id: 'main', flex: 100, content: { type: 'main' } } },
      ],
      ['split', layout(source.id, normal.id)],
    ]),
    homePluginChannelIds: [source.id, normal.id, 'unknown'],
  }
  expect(referencedWatchedChannels(snapshot)).toEqual([source.id, normal.id].toSorted())
  snapshot.tabIds = ['home']
  expect(referencedWatchedChannels(snapshot)).toEqual([source.id])
  snapshot.tabIds = []
  expect(referencedWatchedChannels(snapshot)).toEqual([])
})

test('a failed source selection write restores the previous selection', async () => {
  const id = crypto.randomUUID()
  const api = {
    getUiState: async () => null,
    setUiState: async () => {
      throw new Error('write failed')
    },
  }
  await expect(setHomePluginChannel(api, id, true)).rejects.toThrow('write failed')
  expect(homePluginChannelsStore.get().value).toEqual([])
})

function pluginMessage(id: string, timestamp: number): PluginChannelMessage {
  return {
    id,
    author: { id: 'viewer', name: 'Viewer' },
    text: id,
    timestamp,
    kind: 'message',
  }
}

test('the combined plugin snapshot reuses rows and drops evicted and unselected messages', async () => {
  const first = pluginChannel()
  const second = pluginChannel()
  const observers = new Map<string, Observer>()
  const feed = observeHomePluginFeed((id, listener) => {
    observers.set(id, listener)
    return () => {
      observers.delete(id)
    }
  })
  cleanups.push(() => feed.stop())
  const oldest = pluginMessage('oldest', 1)
  const kept = pluginMessage('kept', 3)
  function emit(id: string, messages: PluginChannelMessage[]) {
    observers.get(id)?.({ messages, status: { status: 'connected' }, canSend: false })
  }

  feed.sync([first, second])
  emit(first.id, [oldest, kept])
  emit(second.id, [pluginMessage('second', 2)])
  await settle()
  const before = homePluginFeedStore.get()
  expect(before.rows.map((row) => row.message.id)).toEqual(['oldest', 'second', 'kept'])
  feed.sync([{ ...first }, { ...second }])
  await settle()
  expect(homePluginFeedStore.get()).toBe(before)
  emit(first.id, [kept, pluginMessage('late', 0)])
  await settle()
  const next = homePluginFeedStore.get()
  expect(next.rows.map((row) => row.message.id)).toEqual(['late', 'second', 'kept'])
  expect(next.rows.at(-1)).toBe(before.rows.at(-1))
  expect(next.total - before.total).toBe(1)
  feed.sync([first])
  await settle()
  expect(observers.has(second.id)).toBe(false)
  expect(homePluginFeedStore.get().rows.map((row) => row.message.id)).toEqual(['late', 'kept'])
})
