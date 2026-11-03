import { describe, expect, test } from 'bun:test'

import {
  discoverKickRealtime,
  requestKickRealtimeToken,
  KickRealtimeSession,
  type KickRealtimeDependencies,
  type KickRealtimeEvent,
  type KickSocket,
  type KickSocketEvents,
} from '../src/platforms/kick/realtime'
import { kickRetryClock, type KickRetryClock } from '../src/platforms/kick/retry'

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

class Clock implements KickRetryClock {
  time = 0
  next = 0
  tasks = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.next
    this.tasks.set(id, { at: this.time + delay, callback })
    return () => {
      this.tasks.delete(id)
    }
  }
  async advance(delay: number): Promise<void> {
    const end = this.time + delay
    while (true) {
      const next = [...this.tasks].toSorted((a, b) => a[1].at - b[1].at).at(0)
      if (!next || next[1].at > end) break
      this.time = next[1].at
      this.tasks.delete(next[0])
      next[1].callback()
      await flush()
    }
    this.time = end
  }
}

class Socket implements KickSocket {
  sent: unknown[] = []
  closed = false
  listeners: { [K in keyof KickSocketEvents]: Set<(event: KickSocketEvents[K]) => void> } = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }
  addEventListener<K extends keyof KickSocketEvents>(
    event: K,
    listener: (event: KickSocketEvents[K]) => void,
  ): void {
    this.listeners[event].add(listener)
  }
  emit<K extends keyof KickSocketEvents>(event: K, value: KickSocketEvents[K]): void {
    for (const listener of this.listeners[event]) listener(value)
  }
  receive(...values: object[]): void {
    this.emit('message', { data: values.map((value) => JSON.stringify(value)).join('\n') })
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.closed = true
    this.emit('close', { code: 1000 })
  }
}

function fixture() {
  const clock = new Clock()
  const socket = new Socket()
  const controller = new AbortController()
  const events: KickRealtimeEvent[] = []
  const failures: string[] = []
  const tokens: { clientId: string; signal: AbortSignal }[] = []
  const discoveries: { clientId: string; signal: AbortSignal }[] = []
  let token: KickRealtimeDependencies['token'] = async () => `guest-${tokens.length}`
  const dependencies: KickRealtimeDependencies = {
    clock,
    discover: async (clientId, signal) => {
      discoveries.push({ clientId, signal })
      return 'wss://realtime.fixture.invalid/connection/websocket'
    },
    token: (clientId, signal) => {
      tokens.push({ clientId, signal })
      return token(clientId, signal)
    },
    socket: () => socket,
  }
  const session = new KickRealtimeSession({
    chatroomId: 456,
    signal: controller.signal,
    dependencies,
    event: (event) => events.push(event),
    disconnected: (error) => failures.push(error.message),
  })
  return {
    clock,
    socket,
    controller,
    events,
    failures,
    tokens,
    discoveries,
    session,
    setToken(next: typeof token) {
      token = next
    },
  }
}

describe('Kick realtime discovery', () => {
  test('uses general discovery, a shared guest client ID and supported provider without OAuth credentials', async () => {
    const requests: Request[] = []
    const fetchFn: typeof fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(new Request(input, init))
        return requests.length === 1
          ? Response.json({
              data: {
                mode: 'websocket',
                connections: [
                  {
                    provider: 'centrifugo',
                    credentials: {
                      url: 'wss://realtime.us-west-2.platform.kick.com/connection/websocket',
                    },
                  },
                ],
              },
            })
          : Response.json({ data: { token: 'guest' } })
      },
      { preconnect: fetch.preconnect },
    )
    const signal = new AbortController().signal
    expect(await discoverKickRealtime('guest-id', signal, fetchFn)).toContain('us-west-2')
    expect(await requestKickRealtimeToken('guest-id', signal, fetchFn)).toBe('guest')
    const discovery = requests[0],
      auth = requests[1]
    if (!discovery || !auth) throw new Error('Expected discovery and auth requests.')
    expect(discovery.url).toEndWith('/realtime/connection')
    expect(await discovery.json()).toEqual({
      client: { id: 'guest-id', type: 'web' },
      capabilities: { accepted_providers: [{ provider: 'centrifugo' }] },
    })
    expect(auth.url).toEndWith('/auth/connection')
    expect(await auth.json()).toEqual({ client_id: 'guest-id' })
    for (const request of requests) {
      expect(request.headers.get('Origin')).toBe('https://kick.com')
      expect(request.headers.has('Authorization')).toBe(false)
    }
  })

  test('rejects unavailable providers, untrusted socket URLs and malformed guest auth', async () => {
    for (const url of ['ws://realtime.us-east-1.platform.kick.com', 'wss://other.invalid']) {
      const fetchFn = Object.assign(
        async () =>
          Response.json({
            data: {
              mode: 'websocket',
              connections: [{ provider: 'centrifugo', credentials: { url } }],
            },
          }),
        { preconnect: fetch.preconnect },
      )
      await expect(
        discoverKickRealtime('id', new AbortController().signal, fetchFn),
      ).rejects.toThrow()
    }
    const missing = Object.assign(
      async () => Response.json({ data: { mode: 'websocket', connections: [] } }),
      { preconnect: fetch.preconnect },
    )
    await expect(discoverKickRealtime('id', new AbortController().signal, missing)).rejects.toThrow(
      'supported realtime',
    )
    await expect(
      requestKickRealtimeToken('id', new AbortController().signal, missing),
    ).rejects.toThrow()
    const denied = Object.assign(async () => new Response('private body', { status: 403 }), {
      preconnect: fetch.preconnect,
    })
    await expect(
      requestKickRealtimeToken('id', new AbortController().signal, denied),
    ).rejects.toThrow('HTTP 403')
  })
})

describe('Kick Centrifugo lifecycle', () => {
  test('connects, waits for matching subscription ack, consumes newline publications and answers pings', async () => {
    const f = fixture()
    await flush()
    expect(f.tokens[0]?.clientId).toBe(f.discoveries[0]?.clientId)
    f.socket.emit('open', {})
    expect(f.socket.sent[0]).toEqual({ id: 1, connect: { name: 'js', token: 'guest-1' } })
    let connected = false
    const ready = f.session.ready.then(() => {
      connected = true
    })
    f.socket.receive({ id: 1, connect: {} })
    expect(f.socket.sent[1]).toEqual({ id: 2, subscribe: { channel: 'chatrooms.456.v2' } })
    f.socket.receive({ id: 99, subscribe: {} })
    await flush()
    expect(connected).toBe(false)
    f.socket.receive(
      { id: 2, subscribe: {} },
      {},
      {
        push: {
          channel: 'chatrooms.456.v2',
          pub: { data: { event: 'chat', data: { id: 'message' } } },
        },
      },
    )
    await ready
    expect(f.events).toEqual([{ event: 'chat', data: { id: 'message' } }])
    expect(f.socket.sent.at(-1)).toEqual({})
    f.socket.receive({
      push: { channel: 'chatrooms.other.v2', pub: { data: { event: 'chat', data: {} } } },
    })
    expect(f.events).toHaveLength(1)
    f.session.close()
    expect(f.failures).toHaveLength(0)
    expect(f.tokens[0]?.signal.aborted).toBe(true)
  })

  test('renews guest tokens using server ttl and cleans all refresh and heartbeat work on close', async () => {
    const f = fixture()
    await flush()
    f.socket.emit('open', {})
    f.socket.receive(
      { id: 1, connect: { expires: true, ttl: 10, ping: 25 } },
      { id: 2, subscribe: {} },
    )
    await f.session.ready
    expect(f.clock.tasks.size).toBe(2)
    await f.clock.advance(8000)
    expect(f.tokens).toHaveLength(2)
    expect(f.tokens[1]?.clientId).toBe(f.tokens[0]?.clientId)
    expect(f.socket.sent.at(-1)).toEqual({ id: 3, refresh: { token: 'guest-2' } })
    f.socket.receive({ id: 3, refresh: { expires: true, ttl: 20 } })
    expect(f.clock.tasks.size).toBe(2)
    await f.clock.advance(16000)
    expect(f.tokens).toHaveLength(3)
    f.session.close()
    expect(f.clock.tasks.size).toBe(0)
    await f.clock.advance(100000)
    expect(f.tokens).toHaveLength(3)
    expect(f.failures).toHaveLength(0)
  })

  test('detects stale heartbeat and failed subscriptions without claiming a connection', async () => {
    const failed = fixture()
    const rejection = failed.session.ready.then(
      () => undefined,
      (error: unknown) => error,
    )
    await flush()
    failed.socket.emit('open', {})
    failed.socket.receive(
      { id: 1, connect: {} },
      { id: 2, error: { code: 103, message: 'permission denied' } },
    )
    const rejected = await rejection
    expect(rejected).toBeInstanceOf(Error)
    if (!(rejected instanceof Error)) throw new Error('Expected subscription error.')
    expect(rejected.message).toContain('code 103')
    expect(failed.socket.closed).toBe(true)
    expect(failed.failures).toHaveLength(0)
    const live = fixture()
    await flush()
    live.socket.receive({ id: 1, connect: { ping: 5 } }, { id: 2, subscribe: {} })
    await live.session.ready
    await live.clock.advance(14999)
    expect(live.socket.closed).toBe(false)
    await live.clock.advance(1)
    expect(live.failures).toEqual(['Kick realtime heartbeat timed out.'])
    expect(live.clock.tasks.size).toBe(0)
  })

  test('an aborted pending guest refresh cannot write to a replaced socket', async () => {
    const f = fixture()
    await flush()
    f.socket.receive({ id: 1, connect: { expires: true, ttl: 10 } }, { id: 2, subscribe: {} })
    await f.session.ready
    const refresh = Promise.withResolvers<string>()
    f.setToken(() => refresh.promise)
    await f.clock.advance(8000)
    const sent = f.socket.sent.length
    f.controller.abort()
    expect(f.tokens[1]?.signal.aborted).toBe(true)
    refresh.resolve('late guest token')
    await flush()
    expect(f.socket.sent).toHaveLength(sent)
    expect(f.clock.tasks.size).toBe(0)
    expect(f.failures).toHaveLength(1)
  })
})

test('real Bun WebSocket receives Kick-style subscription and publication frames', async () => {
  const received: KickRealtimeEvent[] = []
  const published = Promise.withResolvers<void>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      message(socket, data) {
        const command: unknown = JSON.parse(String(data))
        if (typeof command !== 'object' || command === null || !('id' in command)) return
        if (command.id === 1) socket.send(JSON.stringify({ id: 1, connect: {} }))
        if (command.id === 2)
          socket.send(
            [
              JSON.stringify({ id: 2, subscribe: {} }),
              JSON.stringify({
                push: {
                  channel: 'chatrooms.456.v2',
                  pub: {
                    data: {
                      event: String.raw`App\Events\ChatMessageEvent`,
                      data: { id: 'real-socket' },
                    },
                  },
                },
              }),
            ].join('\n'),
          )
      },
    },
  })
  const session = new KickRealtimeSession({
    chatroomId: 456,
    signal: new AbortController().signal,
    dependencies: {
      clock: kickRetryClock,
      discover: async () => `ws://127.0.0.1:${server.port}`,
      token: async () => 'guest',
      socket: (url) => new WebSocket(url),
    },
    event(event) {
      received.push(event)
      published.resolve()
    },
    disconnected(error) {
      published.reject(error)
    },
  })
  try {
    await session.ready
    await published.promise
    expect(received).toEqual([
      { event: String.raw`App\Events\ChatMessageEvent`, data: { id: 'real-socket' } },
    ])
  } finally {
    session.close()
    await server.stop(true)
  }
})
