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
