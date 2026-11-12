import { afterEach, expect, test } from 'bun:test'

import type { BackendToDesktopMessage, Platform } from '@twirchat/shared'

import { sevenTVCache } from '../src/seventv/cache'
import { SevenTVEventClient, sevenTVEventClient } from '../src/seventv/event-client'
import { sevenTVEventSchema } from '../src/seventv/event-schemas'
import { SevenTVSubscriptionManager } from '../src/seventv/subscription-manager'

const originalWebSocket = globalThis.WebSocket
const originalHandler = sevenTVEventClient.onEvent
const setId = 'event-dispatch-set'
const emote = {
  id: 'event-dispatch-emote',
  name: 'RAGEY',
  flags: 0,
  actor_id: 'editor',
  timestamp: 1661593407000,
  origin_id: null,
  data: {
    id: 'event-dispatch-emote',
    name: 'RAGEY',
    animated: true,
    host: {
      url: '//cdn.7tv.app/emote/event-dispatch-emote',
      files: [
        {
          name: '4x.webp',
          static_name: '4x_static.webp',
          width: 180,
          height: 128,
          frame_count: 119,
          size: 312040,
          format: 'WEBP',
        },
        {
          name: '4x.gif',
          static_name: '4x_static.gif',
          width: 180,
          height: 128,
          frame_count: 119,
          size: 944126,
          format: 'GIF',
        },
      ],
    },
  },
}
const actor = { id: 'editor', display_name: ' Editor ', username: 'editor' }
const pushed = { key: 'emotes', index: 694, type: 'object', value: emote }

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  sevenTVEventClient.onEvent = originalHandler
  sevenTVCache.invalidate('kick', 'dispatch-kick')
  sevenTVCache.invalidate('twitch', 'dispatch-twitch')
})

test('7TV object change fields validate emote contents for insert, remove and update', () => {
  const valid = [
    { pushed: [pushed] },
    { actor: null, pushed: [pushed] },
    { actor: 'unavailable', pushed: [pushed] },
    { pulled: [{ key: 'emotes', index: 694, type: 'object', old_value: emote }] },
    {
      updated: [
        {
          key: 'emotes',
          index: 694,
          type: 'object',
          old_value: emote,
          value: { ...emote, name: 'Ragey' },
        },
      ],
    },
    { pushed: [{ ...pushed, type: 'emote' }] },
    { updated: [{ key: 'name', type: 'string', old_value: 'Old', value: 'New' }] },
  ]
  for (const change of valid)
    expect(
      sevenTVEventSchema.safeParse({ type: 'emote_set.update', body: { id: setId, ...change } })
        .success,
    ).toBe(true)
  const malformed = [
    { pushed: [{ ...pushed, type: 'number' }] },
    { pushed: [{ ...pushed, value: null }] },
    { pushed: [{ ...pushed, value: { ...emote, data: { ...emote.data, animated: 'yes' } } }] },
    { pulled: [{ key: 'emotes', index: 694, type: 'object', old_value: null }] },
    { updated: [{ key: 'emotes', type: 'object', old_value: emote, value: null }] },
    { updated: [{ key: 'emotes', type: 'object', old_value: null, value: emote }] },
  ]
  for (const change of malformed)
    expect(
      sevenTVEventSchema.safeParse({ type: 'emote_set.update', body: { id: setId, ...change } })
        .success,
    ).toBe(false)
})

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000
  while (!check()) {
    if (performance.now() >= deadline)
      throw new Error('Timed out waiting for 7TV desktop dispatch.')
    await Bun.sleep(5)
  }
}

test('real object dispatches update both platform caches and attribute chat notices', async () => {
  const opened = Promise.withResolvers<Bun.ServerWebSocket>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      return listener.upgrade(request)
        ? undefined
        : new Response('WebSocket upgrade required', { status: 400 })
    },
    websocket: { open: opened.resolve, message() {} },
  })
  globalThis.WebSocket = class extends originalWebSocket {
    constructor() {
      super(`ws://127.0.0.1:${server.port}`)
    }
  }
  const manager = new SevenTVSubscriptionManager()
  const client = new SevenTVEventClient()
  client.onEvent = sevenTVEventClient.onEvent
  const received: Array<{ client: string; message: BackendToDesktopMessage }> = []
  manager.sendToClient = (clientId, message) => received.push({ client: clientId, message })
  const channels: Array<{ platform: Platform; channelId: string; client: string }> = [
    { platform: 'kick', channelId: 'dispatch-kick', client: 'kick-client' },
    { platform: 'twitch', channelId: 'dispatch-twitch', client: 'twitch-client' },
  ]
  try {
    for (const channel of channels) {
      sevenTVCache.set(channel.platform, channel.channelId, {
        id: setId,
        name: 'Fixture set',
        channelId: channel.channelId,
        platform: channel.platform,
        emotes: new Map(),
        fetchedAt: Date.now(),
        ttl: 60000,
      })
      expect(
        await manager.subscribeClient(channel.client, channel.platform, channel.channelId),
      ).toBe(true)
    }
    received.length = 0
    await client.connect()
    const socket = await opened.promise
    socket.send(
      JSON.stringify({
        op: 0,
        t: 1793676122823,
        s: 6,
        d: {
          type: 'emote_set.update',
          body: { id: setId, kind: 3, actor, pushed: [pushed] },
        },
      }),
    )
    await until(() => received.length === 4)
    for (const channel of channels) {
      expect(
        sevenTVCache.get(channel.platform, channel.channelId)?.emotes.get('RAGEY'),
      ).toMatchObject({
        id: emote.id,
        alias: 'RAGEY',
        animated: true,
        imageUrl: 'https://cdn.7tv.app/emote/event-dispatch-emote/4x.gif',
      })
      expect(
        received.filter((entry) => entry.client === channel.client).map((entry) => entry.message),
      ).toEqual([
        expect.objectContaining({
          type: 'seventv_emote_added',
          platform: channel.platform,
          channelId: channel.channelId,
        }),
        expect.objectContaining({
          type: 'seventv_system_message',
          action: 'added',
          actorName: 'Editor',
          platform: channel.platform,
          channelId: channel.channelId,
          emote: expect.objectContaining({ alias: 'RAGEY' }),
        }),
      ])
    }
    socket.send(
      JSON.stringify({
        op: 0,
        d: {
          type: 'emote_set.update',
          body: {
            id: setId,
            actor: { id: 'remover', display_name: ' ', username: ' removing_editor ' },
            pulled: [{ key: 'emotes', index: 694, type: 'object', old_value: emote }],
          },
        },
      }),
    )
    await until(() => received.length === 8)
    for (const channel of channels) {
      expect(sevenTVCache.get(channel.platform, channel.channelId)?.emotes.has('RAGEY')).toBe(false)
      expect(received.findLast((entry) => entry.client === channel.client)?.message).toMatchObject({
        type: 'seventv_system_message',
        action: 'removed',
        actorName: 'removing_editor',
        emote: { alias: 'RAGEY' },
      })
    }
  } finally {
    client.disconnect()
    for (const channel of channels)
      manager.unsubscribeClient(channel.client, channel.platform, channel.channelId)
    await server.stop(true)
  }
})
