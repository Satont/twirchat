import { afterEach, expect, test } from 'bun:test'

import type { WatchedChannel, WatchedChannelsLayout } from '@twirchat/shared/types'

import { watchedChannelsStore } from '../src/gpuix/state/app'
import { chatTabsStore } from '../src/gpuix/state/chat-tabs'
import { chatWindowsStore } from '../src/gpuix/state/chat-windows'
import { layoutStore } from '../src/gpuix/state/layout'
import {
  createWatchedSubscriptionController,
  referencedWatchedChannels,
  wireActiveWatchedChannels,
  type WatchedReferenceSnapshot,
} from '../src/gpuix/state/watched-subscriptions'

const originalTabs = chatTabsStore.get()
const originalWindows = chatWindowsStore.get()
const originalLayouts = layoutStore.get()
const originalChannels = watchedChannelsStore.get()
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop()
  chatTabsStore.set(originalTabs)
  chatWindowsStore.set(originalWindows)
  layoutStore.set(originalLayouts)
  watchedChannelsStore.set(originalChannels)
})

function channel(id: string): WatchedChannel {
  return { id, channelSlug: id, displayName: id, platform: 'twitch', createdAt: 0 }
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
