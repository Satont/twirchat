import { afterEach, expect, test } from 'bun:test'

import type { NormalizedChatMessage, WatchedChannel } from '@twirchat/shared/types'

import { createDesktopEvents } from '../src/gpuix/backend/events'
import {
  watchedChannelsStore,
  watchedMessagesStore,
  wireBackendToStores,
  type AppStoreBackend,
} from '../src/gpuix/state/app'

const channel: WatchedChannel = {
  id: 'paced',
  platform: 'twitch',
  channelSlug: 'paced',
  displayName: 'Paced',
  createdAt: 0,
}
function message(id: number): NormalizedChatMessage {
  return {
    id: `paced-${id}`,
    platform: 'twitch',
    channelId: channel.channelSlug,
    type: 'message',
    timestamp: new Date(),
    text: 'hello',
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    emotes: [],
  }
}
function retained(): number {
  return watchedMessagesStore.get().get(channel.id)?.length ?? 0
}
let stop = () => {}
afterEach(() => {
  stop()
  watchedMessagesStore.set(new Map())
  watchedChannelsStore.set([])
})

test('a flood shares publications while quiet chat appears within a frame', async () => {
  const events = createDesktopEvents()
  const api: AppStoreBackend['api'] = {
    getAccounts: () => Promise.resolve([]),
    getWatchedChannelMessages: () => Promise.resolve([]),
    getWatchedChannelStatuses: () => Promise.resolve([]),
  }
  stop = wireBackendToStores({ events, api })
  watchedChannelsStore.set([channel])
  const send = (id: number) =>
    events.emit('watched_channel_message', { channelId: channel.id, message: message(id) })

  await Bun.sleep(100)
  send(0)
  await Bun.sleep(50)
  expect(retained()).toBe(1)

  await Bun.sleep(100)
  let publications = 0
  const unsubscribe = watchedMessagesStore.subscribe(() => {
    publications += 1
  })
  for (let id = 1; id <= 30; id++) {
    send(id)
    // Messages must arrive spread over time to cross publication intervals.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(5)
  }
  await Bun.sleep(120)
  unsubscribe()
  expect(retained()).toBe(31)
  // 30 messages arrive over at least 150 ms; per-message or 16 ms flushing would exceed this.
  expect(publications).toBeLessThanOrEqual(6)
})
