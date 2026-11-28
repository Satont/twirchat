import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BasePlatformAdapter } from '../src/platforms/base-adapter'
import { sevenTVService } from '../src/seventv'
import { getDb, initDb } from '../src/store/db'
import { WatchedChannelManager } from '../src/watched-channels/manager'
import { literal, required } from './fixture-values'

let directory = ''
const oldSend = sevenTVService.sendToBackend
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'twirchat-reconnect-'))
  initDb(join(directory, 'db.sqlite'))
  sevenTVService.sendToBackend = () => {}
})
afterEach(() => {
  sevenTVService.sendToBackend = oldSend
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})
class FixtureAdapter extends BasePlatformAdapter {
  readonly platform = literal('twitch')
  connects = 0
  disconnects = 0
  gate: Promise<void> | undefined
  async connect() {
    this.connects++
    await this.gate
  }
  async disconnect() {
    this.disconnects++
  }
  async sendMessage() {}
  receive(id: string) {
    this.emit('message', {
      id,
      platform: 'twitch',
      channelId: 'fixture',
      author: { id: 'u', displayName: 'User', badges: [] },
      text: id,
      timestamp: new Date(),
      emotes: [],
      type: 'message',
    })
  }
}
test('exact watched reconnect reuses the adapter and message buffer without changing saved channels', async () => {
  const adapters: FixtureAdapter[] = []
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new FixtureAdapter()
      adapters.push(adapter)
      return adapter
    },
  )
  const first = await manager.addChannel('twitch', 'first')
  const second = await manager.addChannel('twitch', 'second')
  await manager.setActiveChannels([first.id, second.id])
  required(adapters[0]).receive('before')
  const buffer = manager.getMessages(first.id)
  await manager.reconnect(first.id)
  expect(manager.getMessages(first.id)).toBe(buffer)
  expect(manager.getMessages(first.id).map((message) => message.id)).toEqual(['before'])
  expect(adapters.map((adapter) => adapter.connects)).toEqual([2, 1])
  expect(manager.getAll().map((channel) => channel.id)).toEqual([first.id, second.id])
  required(adapters[0]).receive('after')
  expect(manager.getMessages(first.id)).toHaveLength(2)
  await expect(manager.reconnect('missing')).rejects.toThrow('no longer connected')
})
test('concurrent watched reconnects serialize per identity and retain messages', async () => {
  const adapter = new FixtureAdapter()
  const manager = new WatchedChannelManager(
    (message) => message,
    () => adapter,
  )
  const channel = await manager.addChannel('twitch', 'fixture')
  await manager.setActiveChannels([channel.id])
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  adapter.gate = gate
  const first = manager.reconnect(channel.id)
  const second = manager.reconnect(channel.id)
  await Bun.sleep(1)
  expect(adapter.disconnects).toBe(1)
  expect(adapter.connects).toBe(2)
  release()
  await Promise.all([first, second])
  expect(adapter.disconnects).toBe(2)
  expect(adapter.connects).toBe(3)
})

test('platform reconnect bounds parallel adapters and reports failures after attempting every channel', async () => {
  let active = 0,
    peak = 0,
    reconnecting = false
  const visited: string[] = []
  class CountingAdapter extends FixtureAdapter {
    override async connect(channel = '') {
      if (!reconnecting) return super.connect()
      active++
      peak = Math.max(peak, active)
      visited.push(channel)
      try {
        await Bun.sleep(1)
        if (channel === 'channel3') throw new Error('fixture unavailable')
      } finally {
        active--
      }
    }
  }
  const manager = new WatchedChannelManager(
    (message) => message,
    () => new CountingAdapter(),
  )
  for (let index = 0; index < 9; index++) await manager.addChannel('twitch', `channel${index}`)
  await manager.setActiveChannels(manager.getAll().map((channel) => channel.id))
  reconnecting = true
  await expect(manager.reconnectByPlatform('twitch')).rejects.toThrow('channel3')
  expect(peak).toBe(4)
  expect(visited).toHaveLength(9)
})

test('a cancelled platform reconnect starts neither queued channels nor connects after disconnect', async () => {
  const adapters: FixtureAdapter[] = []
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let disconnects = 0
  class GatedAdapter extends FixtureAdapter {
    override async disconnect() {
      await super.disconnect()
      if (++disconnects === 4) entered.resolve()
      await release.promise
    }
  }
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new GatedAdapter()
      adapters.push(adapter)
      return adapter
    },
  )
  const channels = await Promise.all(
    Array.from({ length: 6 }, (_, index) => manager.addChannel('twitch', `cancel-${index}`)),
  )
  await manager.setActiveChannels(channels.map(({ id }) => id))
  const cancellation = new AbortController()
  const batch = Promise.allSettled([manager.reconnectByPlatform('twitch', cancellation.signal)])
  const reason = new Error('OAuth shutdown deadline')
  try {
    await Promise.race([entered.promise, batch])
    expect(disconnects).toBe(4)
    cancellation.abort(reason)
    release.resolve()
    expect(await batch).toEqual([{ status: 'rejected', reason }])
    expect(adapters.map((adapter) => adapter.disconnects)).toEqual([1, 1, 1, 1, 0, 0])
    expect(adapters.map((adapter) => adapter.connects)).toEqual([1, 1, 1, 1, 1, 1])
    const channel = required(channels[0])
    const adapter = required(adapters[0])
    adapter.receive('while-unbound')
    expect(manager.getMessages(channel.id)).toEqual([])
    await manager.reconnect(channel.id)
    expect(adapter.connects).toBe(2)
    adapter.receive('after-manual-reconnect')
    expect(manager.getMessages(channel.id).map(({ id }) => id)).toEqual(['after-manual-reconnect'])
  } finally {
    cancellation.abort(reason)
    release.resolve()
    await batch
    await manager.setActiveChannels([])
  }
})

test('a cancelled reconnect waiting behind an exact reconnect leaves the adapter alone', async () => {
  const adapter = new FixtureAdapter()
  const manager = new WatchedChannelManager(
    (message) => message,
    () => adapter,
  )
  const channel = await manager.addChannel('twitch', 'queued')
  await manager.setActiveChannels([channel.id])
  const gate = Promise.withResolvers<void>()
  adapter.gate = gate.promise
  const exact = manager.reconnect(channel.id)
  const cancellation = new AbortController()
  const batch = Promise.allSettled([manager.reconnectByPlatform('twitch', cancellation.signal)])
  const reason = new Error('OAuth shutdown deadline')
  cancellation.abort(reason)
  gate.resolve()
  try {
    await exact
    expect(await batch).toEqual([{ status: 'rejected', reason }])
    expect(adapter.disconnects).toBe(1)
    expect(adapter.connects).toBe(2)
  } finally {
    await batch
    await manager.setActiveChannels([])
  }
})

test('saving channels does not connect them, and activation ignores orphan catalog entries', async () => {
  const adapters: FixtureAdapter[] = []
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new FixtureAdapter()
      adapters.push(adapter)
      return adapter
    },
  )
  const first = await manager.addChannel('twitch', 'open')
  const orphan = await manager.addChannel('twitch', 'removed-from-tabs')
  expect(adapters).toHaveLength(0)
  await manager.setActiveChannels([first.id, first.id, 'unknown'])
  expect(adapters).toHaveLength(1)
  expect(manager.getStatus(orphan.id)).toBeNull()
  await manager.setActiveChannels([])
  expect(adapters[0]?.disconnects).toBe(1)
  await manager.reconnectByPlatform('twitch')
  expect(adapters[0]?.connects).toBe(1)
  expect(manager.getAll().map((channel) => channel.id)).toEqual([first.id, orphan.id])
  await manager.setActiveChannels([first.id])
  expect(adapters).toHaveLength(2)
  expect(adapters[1]?.connects).toBe(1)
  await manager.setActiveChannels([])
})

test('closing a connecting channel removes its listeners and prevents late 7TV ownership', async () => {
  const gate = Promise.withResolvers<void>()
  const adapter = new FixtureAdapter()
  adapter.gate = gate.promise
  const manager = new WatchedChannelManager(
    (message) => message,
    () => adapter,
  )
  const channel = await manager.addChannel('twitch', 'late-connect')
  const received: string[] = []
  manager.onMessage((_channel, message) => received.push(message.id))
  const connecting = manager.setActiveChannels([channel.id])
  expect(adapter.connects).toBe(1)
  await manager.setActiveChannels([])
  adapter.receive('after-close')
  gate.resolve()
  await connecting
  expect(received).toEqual([])
  expect(manager.getMessages(channel.id)).toEqual([])
  expect(adapter.disconnects).toBe(1)
  expect(
    sevenTVService.getSubscribedChannels().some((entry) => entry.channelId === 'late-connect'),
  ).toBe(false)
})

test('disposal retires pending activation and leaves the saved catalog intact', async () => {
  const gate = Promise.withResolvers<void>()
  const adapters: FixtureAdapter[] = []
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new FixtureAdapter()
      adapter.gate = gate.promise
      adapters.push(adapter)
      return adapter
    },
  )
  const channels = await Promise.all(
    Array.from({ length: 5 }, (_, index) => manager.addChannel('twitch', `dispose-${index}`)),
  )
  const ids = channels.map(({ id }) => id)
  const received: string[] = []
  manager.onMessage((_id, message) => received.push(message.id))
  const activation = manager.setActiveChannels(ids)
  try {
    expect(adapters).toHaveLength(4)
    const disposed = manager.dispose()
    expect(manager.dispose()).toBe(disposed)
    await disposed
    expect(adapters.map(({ disconnects }) => disconnects)).toEqual([1, 1, 1, 1])
    for (const adapter of adapters) adapter.receive('after-dispose')
    gate.resolve()
    await activation
    await manager.setActiveChannels(ids)
    expect(adapters).toHaveLength(4)
    expect(received).toEqual([])
    expect(manager.getActiveChannels()).toEqual([])
    expect(manager.getAll().map(({ id }) => id)).toEqual(ids)
    expect(
      sevenTVService
        .getSubscribedChannels()
        .some(({ channelId }) => channelId.startsWith('dispose-')),
    ).toBe(false)
  } finally {
    gate.resolve()
    await Promise.all([activation, manager.dispose()])
  }
})

for (const reconnect of [false, true]) {
  test(`disposal joins an ongoing ${reconnect ? 'reconnect' : 'layout close'} disconnect`, async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    class GatedAdapter extends FixtureAdapter {
      override async disconnect() {
        await super.disconnect()
        entered.resolve()
        await release.promise
      }
    }
    const adapter = new GatedAdapter()
    const manager = new WatchedChannelManager(
      (message) => message,
      () => adapter,
    )
    const channel = await manager.addChannel('twitch', 'closing')
    await manager.setActiveChannels([channel.id])
    expect(
      sevenTVService.getSubscribedChannels().some(({ channelId }) => channelId === 'closing'),
    ).toBe(true)
    const operation = reconnect ? manager.reconnect(channel.id) : manager.setActiveChannels([])
    const outcome = Promise.allSettled([operation])
    try {
      await Promise.race([entered.promise, outcome])
      const disposal = manager.dispose()
      const settled = await Promise.race([
        disposal.then(() => true),
        Bun.sleep(0).then(() => false),
      ])
      expect(settled).toBe(false)
      expect(adapter.disconnects).toBe(1)
      expect(
        sevenTVService.getSubscribedChannels().some(({ channelId }) => channelId === 'closing'),
      ).toBe(false)
      release.resolve()
      await disposal
      expect(await outcome).toEqual([{ status: 'fulfilled', value: undefined }])
      expect(adapter.connects).toBe(1)
      expect(adapter.disconnects).toBe(1)
    } finally {
      release.resolve()
      await Promise.all([outcome, manager.dispose()])
    }
  })
}

test('disposal from inside a reconnect disconnect does not disconnect twice', async () => {
  const requested = Promise.withResolvers<void>()
  class ReentrantAdapter extends FixtureAdapter {
    override disconnect() {
      requested.resolve(manager.dispose())
      return super.disconnect()
    }
  }
  const adapter = new ReentrantAdapter()
  const manager = new WatchedChannelManager(
    (message) => message,
    () => adapter,
  )
  const channel = await manager.addChannel('twitch', 'reentrant-close')
  await manager.setActiveChannels([channel.id])
  await Promise.all([manager.reconnect(channel.id), requested.promise])
  expect(adapter.disconnects).toBe(1)
  expect(adapter.connects).toBe(1)
})

test('disposal during adapter creation prevents the connection from starting', async () => {
  const adapter = new FixtureAdapter()
  const requested = Promise.withResolvers<void>()
  const manager: WatchedChannelManager = new WatchedChannelManager(
    (message) => message,
    () => {
      requested.resolve(manager.dispose())
      return adapter
    },
  )
  const channel = await manager.addChannel('twitch', 'dispose-at-creation')
  await manager.setActiveChannels([channel.id])
  await requested.promise
  expect(adapter.connects).toBe(0)
  expect(manager.getActiveChannels()).toEqual([])
})

test('7TV notices reach the watched chat subscribed with the event channel ID', async () => {
  const adapters: FixtureAdapter[] = []
  const manager = new WatchedChannelManager(
    (message) => message,
    () => {
      const adapter = new FixtureAdapter()
      adapters.push(adapter)
      return adapter
    },
  )
  const target = await manager.addChannel('twitch', 'Target')
  const other = await manager.addChannel('twitch', 'other')
  await manager.setActiveChannels([target.id, other.id])
  const received: Array<[string, string]> = []
  manager.onMessage((channelId, message) => received.push([channelId, message.channelId]))
  manager.injectSevenTvNotice('twitch', 'TARGET', {
    id: '7tv-notice',
    platform: 'twitch',
    channelId: 'TARGET',
    author: { id: '7tv-system', displayName: '7TV', badges: [] },
    text: 'RAGEY added',
    timestamp: new Date(),
    emotes: [],
    type: 'system',
  })
  manager.injectSevenTvNotice('kick', 'target', {
    id: 'kick-notice',
    platform: 'kick',
    channelId: 'target',
    author: { id: '7tv-system', displayName: '7TV', badges: [] },
    text: 'ignored',
    timestamp: new Date(),
    emotes: [],
    type: 'system',
  })
  expect(received).toEqual([[target.id, 'target']])
  expect(manager.getMessages(target.id).map((message) => message.id)).toEqual(['7tv-notice'])
  expect(manager.getMessages(other.id)).toEqual([])
  await manager.setActiveChannels([])
})
