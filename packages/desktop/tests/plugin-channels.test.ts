import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import type {
  PluginPlatform,
  PluginTransportCallbacks,
  PluginTransportConnection,
  PluginTransportInfo,
} from '../src/plugins/api'
import { initDb } from '../src/store/db'
import { WatchedChannelsLayoutStore } from '../src/store/watched-channels-layout-store'
import { WatchedChannelStore } from '../src/store/watched-channels-store'
import {
  createPluginChannels,
  type PluginChannelSnapshot,
} from '../src/watched-channels/plugin-channels'
import { required } from './fixture-values'

const platform: PluginPlatform = 'plugin:example:test'
const transport: PluginTransportInfo = { platform, name: 'Example', canSend: true }
let db: Database

beforeEach(() => {
  db = initDb(':memory:')
})

afterEach(() => db.close())

function createHarness() {
  let transports: readonly PluginTransportInfo[] = [transport]
  const opens: {
    key: string
    callbacks: PluginTransportCallbacks
    ready: ReturnType<typeof Promise.withResolvers<PluginTransportConnection>>
  }[] = []
  const closed: string[] = []
  const sent: string[] = []
  const channels = createPluginChannels({
    manager: {
      transports: () => transports,
      openTransport: (_, key, callbacks) => {
        const ready = Promise.withResolvers<PluginTransportConnection>()
        opens.push({ key, callbacks, ready })
        return ready.promise
      },
    },
  })
  return {
    channels,
    opens,
    closed,
    sent,
    register(next: readonly PluginTransportInfo[]) {
      transports = next
      channels.transportChanged()
    },
    resolve(index: number) {
      const request = required(opens[index])
      request.ready.resolve({
        sendMessage: async (text) => {
          sent.push(text)
        },
        close: async () => {
          closed.push(request.key)
        },
      })
      return request.callbacks
    },
  }
}

test('persists case-sensitive plugin channels without changing the builtin catalog', async () => {
  const { channels } = createHarness()
  try {
    WatchedChannelStore.upsert('twitch', 'test', 'test')
    const room = channels.add(platform, 'ExampleRoom')
    expect(channels.add(platform, 'ExampleRoom').id).toBe(room.id)
    expect(channels.add(platform, 'exampleroom').id).not.toBe(room.id)
    expect(channels.list().map((channel) => channel.channelSlug)).toEqual([
      'ExampleRoom',
      'exampleroom',
    ])
    expect(WatchedChannelStore.findAll().map((channel) => channel.platform)).toEqual(['twitch'])
    expect(WatchedChannelsLayoutStore.get(room.id).root).toMatchObject({
      content: { type: 'watched', channelId: room.id },
    })
    WatchedChannelsLayoutStore.set('copied-tab', WatchedChannelsLayoutStore.get(room.id))
    expect(channels.remove(room.id)).toBe(true)
    expect(WatchedChannelsLayoutStore.get('copied-tab').root).toMatchObject({
      content: { type: 'empty' },
    })
  } finally {
    await channels.dispose()
  }
})

test('shares a bounded, coalesced transcript and rejects stale transport generations', async () => {
  const harness = createHarness()
  const { channels } = harness
  const room = channels.add(platform, 'ExampleRoom')
  const seen: PluginChannelSnapshot[] = []
  const second: PluginChannelSnapshot[] = []
  const off = channels.observe(room.id, (snapshot) => seen.push(snapshot))
  const offSecond = channels.observe(room.id, (snapshot) => second.push(snapshot))
  try {
    channels.setActive(new Set([room.id]))
    channels.setActive(new Set([room.id]))
    expect(harness.opens).toHaveLength(1)
    const stale = harness.resolve(0)
    stale.status({ status: 'connected' })
    await Promise.resolve()
    await channels.sendMessage(room.id, 'hello')
    expect(harness.sent).toEqual(['hello'])

    for (let index = 0; index < 300; index++)
      stale.message({ id: String(index), author: { id: 'user', name: 'User' }, text: 'line' })
    stale.message({ id: '299', author: { id: 'user', name: 'User' }, text: 'duplicate' })
    await Bun.sleep(55)
    expect(seen).toHaveLength(2)
    expect(seen.at(-1)).toBe(second.at(-1))
    expect(seen.at(-1)?.messages).toHaveLength(200)
    expect(seen.at(-1)?.messages[0]?.id).toBe('100')
    expect(seen.at(-1)?.messages.at(-1)?.text).toBe('line')

    harness.register([])
    await expect(channels.sendMessage(room.id, 'offline')).rejects.toThrow('not connected')
    harness.register([transport])
    expect(harness.opens).toHaveLength(2)
    const live = harness.resolve(1)
    live.status({ status: 'connected' })
    stale.message({ id: 'stale', author: { id: 'user', name: 'User' }, text: 'old' })
    stale.status({ status: 'error', error: 'old transport' })
    live.message({ id: 'live', author: { id: 'user', name: 'User' }, text: 'new' })
    channels.addSystemMessage(room.id, 'Local notice')
    await Bun.sleep(55)
    expect(seen.at(-1)?.status).toEqual({ status: 'connected' })
    expect(seen.at(-1)?.messages.some((message) => message.id === 'stale')).toBe(false)
    expect(seen.at(-1)?.messages.at(-1)).toMatchObject({ kind: 'system', text: 'Local notice' })
    expect(harness.closed).toEqual(['ExampleRoom'])
  } finally {
    off()
    offSecond()
    await channels.dispose()
  }
  expect(harness.closed).toEqual(['ExampleRoom', 'ExampleRoom'])
})

test('closes an opening transport after the last reference is removed', async () => {
  const harness = createHarness()
  const room = harness.channels.add(platform, 'ExampleRoom')
  harness.channels.setActive(new Set([room.id]))
  harness.channels.setActive(new Set())
  harness.resolve(0)
  await harness.channels.dispose()
  expect(harness.closed).toEqual(['ExampleRoom'])
})

test('limits connection admission and retires queued channels before opening them', async () => {
  const harness = createHarness()
  const rooms = Array.from({ length: 6 }, (_, index) =>
    harness.channels.add(platform, `room-${index}`),
  )
  harness.channels.setActive(new Set(rooms.map((room) => room.id)))
  expect(harness.opens).toHaveLength(4)
  harness.channels.setActive(new Set(rooms.slice(0, 5).map((room) => room.id)))
  harness.resolve(0)
  await Bun.sleep(0)
  expect(harness.opens.map((request) => request.key)).toEqual([
    'room-0',
    'room-1',
    'room-2',
    'room-3',
    'room-4',
  ])
  for (let index = 1; index < 5; index++) harness.resolve(index)
  await harness.channels.dispose()
  expect(harness.closed.toSorted()).toEqual(['room-0', 'room-1', 'room-2', 'room-3', 'room-4'])
})
