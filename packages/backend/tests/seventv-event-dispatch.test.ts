import { afterEach, expect, spyOn, test } from 'bun:test'

import type { BackendToDesktopMessage, Platform } from '@twirchat/shared'
import { z } from 'zod'

import { sevenTVCache } from '../src/seventv/cache'
import { SevenTVEventClient, sevenTVEventClient } from '../src/seventv/event-client'
import { sevenTVEventMessageSchema, sevenTVEventSchema } from '../src/seventv/event-schemas'
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

const dispatch = () =>
  sevenTVEventClient.onEvent?.(
    sevenTVEventSchema.parse({
      type: 'emote_set.update',
      body: { id: setId, pushed: [pushed] },
    }),
  )
const set = (id: string) => ({ id, name: id, emotes: { items: [] } })

const connectionSnapshot = (id: string | null, aliases: string[] = []) =>
  Response.json({
    data: {
      users: {
        userByConnection: {
          id: 'fixture-user',
          style: {
            activeEmoteSet:
              id === null
                ? null
                : {
                    ...set(id),
                    emotes: {
                      items: aliases.map((alias) => ({
                        id: alias,
                        alias,
                        flags: { zeroWidth: false },
                        emote: {
                          id: alias,
                          defaultName: alias,
                          aspectRatio: 1,
                          flags: { animated: false },
                          images: [],
                        },
                      })),
                    },
                  },
          },
        },
      },
    },
  })
const result = (id: string) => Response.json({ data: { emoteSets: { emoteSet: set(id) } } })
const switchTo = (id: string, events = sevenTVEventClient) =>
  events.onEvent?.(
    sevenTVEventSchema.parse({
      type: 'user.update',
      body: {
        id: 'fixture-user',
        updated: [{ key: 'connections', value: [{ key: 'emote_set_id', value: id }] }],
      },
    }),
  )

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
  const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
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
      await manager.subscribeClient(channel.client, [channel], () => true)
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
    connect.mockRestore()
    await server.stop(true)
  }
})

test('a shared set keeps routing to each channel until its last viewer leaves', async () => {
  const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
  const unsubscribe = spyOn(sevenTVEventClient, 'unsubscribe')
  const manager = new SevenTVSubscriptionManager()
  const first = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
    platform: Platform
    channelId: string
  }
  const second = { platform: 'twitch', channelId: 'dispatch-twitch' } satisfies {
    platform: Platform
    channelId: string
  }
  const received: string[] = []
  manager.sendToClient = (client, message) => {
    if (message.type === 'seventv_emote_added') received.push(`${client}:${message.channelId}`)
  }
  try {
    for (const { platform, channelId } of [first, second]) {
      sevenTVCache.set(platform, channelId, {
        id: setId,
        name: 'Shared',
        platform,
        channelId,
        emotes: new Map(),
        fetchedAt: Date.now(),
        ttl: 60000,
      })
    }
    await manager.subscribeClient('both', [first, second], () => true)
    await manager.subscribeClient('remaining', [first], () => true)
    manager.unsubscribeClient('both', first.platform, first.channelId)
    dispatch()
    expect(received.toSorted()).toEqual(['both:dispatch-twitch', 'remaining:dispatch-kick'])
    expect(unsubscribe).not.toHaveBeenCalled()
    manager.cleanupClient('remaining')
    expect(unsubscribe).not.toHaveBeenCalled()
    received.length = 0
    dispatch()
    expect(received).toEqual(['both:dispatch-twitch'])
    manager.cleanupClient('both')
    expect(unsubscribe.mock.calls).toEqual([
      ['emote_set.update', { object_id: setId }],
      ['emote_set.delete', { object_id: setId }],
    ])
  } finally {
    manager.cleanupClient('both')
    manager.cleanupClient('remaining')
    unsubscribe.mockRestore()
    connect.mockRestore()
  }
})

test('set switches retain existing updates until the latest lookup commits', async () => {
  const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
  const unsubscribe = spyOn(sevenTVEventClient, 'unsubscribe')
  const manager = new SevenTVSubscriptionManager()
  const originalFetch = globalThis.fetch
  const stale = Promise.withResolvers<Response>()
  const latest = Promise.withResolvers<Response>()
  const started: string[] = []
  const received: Array<{ client: string; message: BackendToDesktopMessage }> = []
  const channel = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
    platform: Platform
    channelId: string
  }
  const lookup = z.object({ variables: z.object({ id: z.string().optional() }) })
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a 7TV lookup')
      const { id } = lookup.parse(JSON.parse(init.body)).variables
      if (!id)
        return Response.json({
          data: {
            users: {
              userByConnection: {
                id: 'fixture-user',
                style: { activeEmoteSet: set('initial') },
              },
            },
          },
        })
      started.push(id)
      if (id === 'stale') return stale.promise
      if (id === 'latest') return latest.promise
      return new Response(null, { status: 503 })
    },
    { preconnect: originalFetch.preconnect },
  )
  manager.sendToClient = (client, message) => received.push({ client, message })
  try {
    await manager.subscribeClient('first', [channel], () => true)
    manager.cleanupClient('first')
    await manager.subscribeClient('returning', [channel], () => true)
    received.length = 0
    unsubscribe.mockClear()
    switchTo('failed')
    switchTo('stale')
    switchTo('latest')
    expect(started).toEqual(['failed', 'stale', 'latest'])
    await manager.subscribeClient('joiner', [channel], () => true)
    manager.cleanupClient('returning')
    expect(unsubscribe).not.toHaveBeenCalled()
    received.length = 0
    sevenTVEventClient.onEvent?.(
      sevenTVEventSchema.parse({
        type: 'emote_set.update',
        body: { id: 'initial', pushed: [pushed] },
      }),
    )
    expect(
      received
        .filter(({ message }) => message.type === 'seventv_emote_added')
        .map(({ client }) => client),
    ).toEqual(['joiner'])
    latest.resolve(result('latest'))
    await until(() =>
      received.some(
        ({ message }) =>
          message.type === 'seventv_system_message' && message.action === 'set_changed',
      ),
    )
    stale.resolve(result('stale'))
    await Bun.sleep(0)
    expect(sevenTVCache.get('kick', channel.channelId)?.id).toBe('latest')
    expect(
      received.filter(
        ({ message }) =>
          message.type === 'seventv_system_message' && message.action === 'set_changed',
      ),
    ).toEqual([
      {
        client: 'joiner',
        message: {
          type: 'seventv_system_message',
          action: 'set_changed',
          platform: 'kick',
          channelId: channel.channelId,
          setName: 'latest',
        },
      },
    ])
    expect(manager.getStats()).toMatchObject({ connectedClients: 1, emoteSetSubscriptions: 1 })
  } finally {
    stale.resolve(result('stale'))
    latest.resolve(result('latest'))
    for (const client of ['first', 'returning', 'joiner']) manager.cleanupClient(client)
    globalThis.fetch = originalFetch
    unsubscribe.mockRestore()
    connect.mockRestore()
  }
})

test('duplicate active-set switches keep the lookup that already owns the target', async () => {
  const events = new SevenTVEventClient()
  const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
  const manager = new SevenTVSubscriptionManager(events)
  const pending = Promise.withResolvers<Response>()
  const lookup = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(connectionSnapshot('initial'))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(new Response(null, { status: 503 }))
  const messages: BackendToDesktopMessage[] = []
  manager.sendToClient = (_viewer, message) => messages.push(message)
  const channel = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
    platform: Platform
    channelId: string
  }
  try {
    await manager.subscribeClient('viewer', [channel], () => true)
    messages.length = 0
    switchTo('next', events)
    switchTo('next', events)
    pending.resolve(result('next'))
    await Bun.sleep(0)
    expect(sevenTVCache.get('kick', channel.channelId)?.id).toBe('next')
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(messages).toEqual([
      { type: 'seventv_emote_set', ...channel, emotes: [] },
      { type: 'seventv_system_message', ...channel, action: 'set_changed', setName: 'next' },
    ])
  } finally {
    pending.resolve(result('next'))
    manager.cleanupClient('viewer')
    lookup.mockRestore()
    connect.mockRestore()
  }
})

test('returning to the active set retires the pending lookup for the same future target', async () => {
  const events = new SevenTVEventClient()
  const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
  const manager = new SevenTVSubscriptionManager(events)
  const retired = Promise.withResolvers<Response>()
  const current = Promise.withResolvers<Response>()
  const lookup = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(connectionSnapshot('initial'))
    .mockReturnValueOnce(retired.promise)
    .mockReturnValueOnce(current.promise)
  const messages: BackendToDesktopMessage[] = []
  manager.sendToClient = (_viewer, message) => messages.push(message)
  try {
    await manager.subscribeClient(
      'viewer',
      [{ platform: 'kick', channelId: 'dispatch-kick' }],
      () => true,
    )
    messages.length = 0
    switchTo('next', events)
    switchTo('initial', events)
    switchTo('next', events)
    expect(lookup).toHaveBeenCalledTimes(3)
    retired.resolve(result('next'))
    await Bun.sleep(0)
    expect(messages).toEqual([])
    expect(sevenTVCache.get('kick', 'dispatch-kick')?.id).toBe('initial')
    current.resolve(result('next'))
    await until(() => messages.length >= 2)
    expect(messages.map(({ type }) => type)).toEqual([
      'seventv_emote_set',
      'seventv_system_message',
    ])
    expect(sevenTVCache.get('kick', 'dispatch-kick')?.id).toBe('next')
  } finally {
    retired.resolve(result('next'))
    current.resolve(result('next'))
    manager.cleanupClient('viewer')
    lookup.mockRestore()
    connect.mockRestore()
  }
})

const hello = (socket: Bun.ServerWebSocket, id: string) =>
  socket.send(
    JSON.stringify({
      op: 1,
      d: { heartbeat_interval: 45000, session_id: id, subscription_limit: 500 },
    }),
  )

test('reconnect refreshes retained viewers quietly and does not overwrite a newer dispatch', async () => {
  const opened = Array.from({ length: 3 }, () => Promise.withResolvers<Bun.ServerWebSocket>())
  let connections = 0
  const commands: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      return listener.upgrade(request, { data: undefined })
        ? undefined
        : new Response('WebSocket upgrade required', { status: 400 })
    },
    websocket: {
      open: (socket) => opened[connections++]?.resolve(socket),
      message(_socket, raw) {
        commands.push(raw.toString())
      },
    },
  })
  const events = new SevenTVEventClient(`ws://127.0.0.1:${server.port}`)
  const manager = new SevenTVSubscriptionManager(events)
  const channel = {
    platform: 'twitch',
    channelId: 'dispatch-twitch',
    platformUserId: '42',
  } satisfies {
    platform: Platform
    channelId: string
    platformUserId: string
  }
  const messages: BackendToDesktopMessage[] = []
  manager.sendToClient = (_viewer, message) => messages.push(message)
  const stale = Promise.withResolvers<Response>()
  let lookups = 0
  const lookup = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        expect(input).toBe('https://7tv.io/v4/gql')
        if (typeof init?.body !== 'string') throw new Error('Expected a 7TV lookup')
        const query = z.object({ variables: z.object({ platformId: z.literal('42') }) })
        query.parse(JSON.parse(init.body))
        lookups++
        if (lookups === 1) return connectionSnapshot('before-outage')
        if (lookups === 2) return connectionSnapshot(setId)
        if (lookups === 3) return stale.promise
        return connectionSnapshot(setId, ['missed-during-outage', emote.name])
      },
      { preconnect: fetch.preconnect },
    ),
  )
  try {
    await manager.subscribeClient('viewer', [channel], () => true)
    const [first, second, third] = opened
    if (!first || !second || !third) throw new Error('Missing local EventAPI sessions')
    const firstSocket = await first.promise
    hello(firstSocket, 'first')
    await until(() => commands.length === 3)
    expect(lookup).toHaveBeenCalledTimes(1)
    messages.length = 0
    firstSocket.close(1012)
    const secondSocket = await second.promise
    hello(secondSocket, 'second')
    await until(() => commands.length >= 10 && messages.length > 0)
    expect(messages.map(({ type }) => type)).toEqual(['seventv_emote_set'])
    expect(sevenTVCache.get('twitch', channel.channelId)?.id).toBe(setId)
    expect(
      commands.slice(-4).map((raw) => sevenTVEventMessageSchema.parse(JSON.parse(raw))),
    ).toEqual([
      { op: 36, d: { type: 'emote_set.update', condition: { object_id: 'before-outage' } } },
      { op: 36, d: { type: 'emote_set.delete', condition: { object_id: 'before-outage' } } },
      { op: 35, d: { type: 'emote_set.update', condition: { object_id: setId } } },
      { op: 35, d: { type: 'emote_set.delete', condition: { object_id: setId } } },
    ])
    secondSocket.close(1012)
    hello(await third.promise, 'third')
    await until(() => lookup.mock.calls.length === 3)
    events.onEvent?.(
      sevenTVEventSchema.parse({ type: 'emote_set.update', body: { id: setId, pushed: [pushed] } }),
    )
    messages.length = 0
    stale.resolve(connectionSnapshot('stale'))
    await until(() => messages.length > 0)
    expect(lookup).toHaveBeenCalledTimes(4)
    expect(messages.map(({ type }) => type)).toEqual(['seventv_emote_set'])
    expect(sevenTVCache.get('twitch', channel.channelId)?.id).toBe(setId)
    expect([...(sevenTVCache.get('twitch', channel.channelId)?.emotes.keys() ?? [])]).toEqual([
      'missed-during-outage',
      emote.name,
    ])
  } finally {
    events.disconnect()
    stale.resolve(connectionSnapshot('aborted'))
    manager.cleanupClient('viewer')
    lookup.mockRestore()
    await server.stop(true)
  }
})

test('a cold channel without an active set does not acquire upstream interests', async () => {
  const events = new SevenTVEventClient()
  const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
  const manager = new SevenTVSubscriptionManager(events)
  const lookup = spyOn(globalThis, 'fetch').mockResolvedValueOnce(connectionSnapshot(null))
  try {
    await manager.subscribeClient(
      'viewer',
      [{ platform: 'kick', channelId: 'dispatch-kick' }],
      () => true,
    )
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
    expect(events.subscriptionCount).toBe(0)
    expect(manager.getStats().connectedClients).toBe(0)
    expect(sevenTVCache.get('kick', 'dispatch-kick')).toBeUndefined()
  } finally {
    manager.cleanupClient('viewer')
    connect.mockRestore()
    lookup.mockRestore()
  }
})

test('a confirmed missing active set clears the catalog and keeps the user subscription', async () => {
  const events = new SevenTVEventClient()
  const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
  const unsubscribe = spyOn(events, 'unsubscribe')
  const manager = new SevenTVSubscriptionManager(events)
  const channel = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
    platform: Platform
    channelId: string
  }
  const received: Array<{ viewer: string; message: BackendToDesktopMessage }> = []
  manager.sendToClient = (viewer, message) => received.push({ viewer, message })
  const lookup = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    connectionSnapshot(setId, [emote.name]),
  )
  try {
    await manager.subscribeClient('viewer', [channel], () => true)
    received.length = 0
    const missing = Response.json({
      data: { users: { userByConnection: { id: 'fixture-user', style: {} } } },
    })
    lookup.mockResolvedValueOnce(missing)
    events.onConnected?.(true)
    await until(() => missing.bodyUsed)
    await Bun.sleep(0)
    expect(received).toEqual([])
    expect(events.subscriptionCount).toBe(3)
    lookup.mockResolvedValueOnce(connectionSnapshot(null))
    events.onConnected?.(true)
    await until(() => received.length > 0)
    expect(received.splice(0)).toEqual([
      { viewer: 'viewer', message: { type: 'seventv_emote_set', ...channel, emotes: [] } },
    ])
    expect(unsubscribe.mock.calls).toEqual([
      ['emote_set.update', { object_id: setId }],
      ['emote_set.delete', { object_id: setId }],
    ])
    expect(events.subscriptionCount).toBe(1)
    await manager.subscribeClient('late-viewer', [channel], () => true)
    expect(received.splice(0)).toEqual([
      { viewer: 'late-viewer', message: { type: 'seventv_emote_set', ...channel, emotes: [] } },
    ])
    events.onEvent?.(
      sevenTVEventSchema.parse({ type: 'emote_set.update', body: { id: setId, pushed: [pushed] } }),
    )
    expect(received).toEqual([])
    lookup.mockResolvedValueOnce(result('restored'))
    events.onEvent?.(
      sevenTVEventSchema.parse({
        type: 'user.update',
        body: {
          id: 'fixture-user',
          updated: [{ key: 'connections', value: [{ key: 'emote_set_id', value: 'restored' }] }],
        },
      }),
    )
    await until(() => events.subscriptionCount === 3)
    expect(sevenTVCache.get(channel.platform, channel.channelId)?.id).toBe('restored')
    expect(
      received
        .filter(({ message }) => message.type === 'seventv_emote_set')
        .map(({ viewer }) => viewer),
    ).toEqual(['viewer', 'late-viewer'])
  } finally {
    events.disconnect()
    for (const viewer of ['viewer', 'late-viewer']) manager.cleanupClient(viewer)
    unsubscribe.mockRestore()
    connect.mockRestore()
    lookup.mockRestore()
  }
})

test.each(['stale response', 'failed read'])(
  'a delayed join keeps the newer detached channel after a %s',
  async (outcome) => {
    const events = new SevenTVEventClient()
    const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
    const manager = new SevenTVSubscriptionManager(events)
    const channel = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
      platform: Platform
      channelId: string
    }
    const stale = Promise.withResolvers<Response>()
    const lookup = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(connectionSnapshot('initial'))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(connectionSnapshot('replacement', ['NewAlias']))
    const delivered: BackendToDesktopMessage[] = []
    manager.sendToClient = (viewer, message) => {
      if (viewer === 'delayed') delivered.push(message)
    }
    const join = (viewer: string) => manager.subscribeClient(viewer, [channel], () => true)
    const expire = () => {
      const snapshot = sevenTVCache.get(channel.platform, channel.channelId)
      if (!snapshot) throw new Error('Expected a cached snapshot')
      sevenTVCache.set(channel.platform, channel.channelId, snapshot, -1)
      sevenTVCache.cleanup()
    }
    try {
      await join('initial')
      expire()
      const delayed = join('delayed')
      manager.cleanupClient('initial')
      await join('replacement')
      expect(sevenTVCache.get(channel.platform, channel.channelId)?.id).toBe('replacement')
      manager.cleanupClient('replacement')
      if (outcome === 'stale response') {
        expire()
        stale.resolve(connectionSnapshot('stale'))
      } else {
        stale.resolve(new Response(null, { status: 503 }))
      }
      await delayed
      expect(delivered).toEqual([
        {
          type: 'seventv_emote_set',
          ...channel,
          emotes: [expect.objectContaining({ alias: 'NewAlias' })],
        },
      ])
      expect(sevenTVCache.get(channel.platform, channel.channelId)?.id).toBe(
        outcome === 'stale response' ? undefined : 'replacement',
      )
      expect(manager.getStats()).toMatchObject({ connectedClients: 1, emoteSetSubscriptions: 1 })
    } finally {
      stale.resolve(connectionSnapshot('stale'))
      for (const viewer of ['initial', 'replacement', 'delayed']) manager.cleanupClient(viewer)
      connect.mockRestore()
      lookup.mockRestore()
    }
  },
)

test('reattaching the same snapshot does not invalidate a newer join lookup', async () => {
  const events = new SevenTVEventClient()
  const connect = spyOn(events, 'connect').mockResolvedValue(undefined)
  const manager = new SevenTVSubscriptionManager(events)
  const first = Promise.withResolvers<Response>()
  const second = Promise.withResolvers<Response>()
  const lookup = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(connectionSnapshot(setId))
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const join = (viewer: string) =>
    manager.subscribeClient(viewer, [{ platform: 'kick', channelId: 'dispatch-kick' }], () => true)
  try {
    await join('initial')
    sevenTVCache.invalidate('kick', 'dispatch-kick')
    const reattach = join('reattach')
    events.onEvent?.(
      sevenTVEventSchema.parse({ type: 'emote_set.update', body: { id: setId, pushed: [pushed] } }),
    )
    manager.cleanupClient('initial')
    const refresh = join('refresh')
    first.resolve(connectionSnapshot('stale'))
    await reattach
    manager.cleanupClient('reattach')
    second.resolve(connectionSnapshot('fresh'))
    await refresh
    expect(sevenTVCache.get('kick', 'dispatch-kick')?.id).toBe('fresh')
  } finally {
    first.resolve(connectionSnapshot('stale'))
    second.resolve(connectionSnapshot('fresh'))
    for (const viewer of ['initial', 'reattach', 'refresh']) manager.cleanupClient(viewer)
    lookup.mockRestore()
    connect.mockRestore()
  }
})

test('an expired active set refreshes for all viewers when another joins', async () => {
  const connect = spyOn(sevenTVEventClient, 'connect').mockResolvedValue(undefined)
  const manager = new SevenTVSubscriptionManager()
  const channel = { platform: 'kick', channelId: 'dispatch-kick' } satisfies {
    platform: Platform
    channelId: string
  }
  const received: string[] = []
  const lookup = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      data: {
        users: {
          userByConnection: {
            id: 'fixture-user',
            style: {
              activeEmoteSet: { id: 'refreshed', name: 'Refreshed', emotes: { items: [] } },
            },
          },
        },
      },
    }),
  )
  manager.sendToClient = (client, message) => {
    if (message.type === 'seventv_emote_set') received.push(client)
  }
  try {
    const snapshot = {
      id: setId,
      name: 'Expired',
      platform: channel.platform,
      channelId: channel.channelId,
      emotes: new Map(),
      fetchedAt: Date.now(),
      ttl: 60000,
    }
    sevenTVCache.set(channel.platform, channel.channelId, snapshot)
    await manager.subscribeClient('viewer', [channel], () => true)
    sevenTVCache.set(channel.platform, channel.channelId, snapshot, -1)
    received.length = 0
    await manager.subscribeClient('joiner', [channel], () => true)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(received).toEqual(['viewer', 'joiner'])
    expect(sevenTVCache.get(channel.platform, channel.channelId)?.id).toBe('refreshed')
    expect(manager.getStats()).toMatchObject({ connectedClients: 2, emoteSetSubscriptions: 1 })
  } finally {
    for (const client of ['viewer', 'joiner']) manager.cleanupClient(client)
    lookup.mockRestore()
    connect.mockRestore()
  }
})
