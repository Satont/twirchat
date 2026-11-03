import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage, PlatformStatusInfo } from '@twirchat/shared/types'

import {
  createKickTokenRefresher,
  requestKickRefresh,
  KickRefreshRequestError,
  type KickRefreshCredentials,
  type KickRefreshEntry,
  type KickRefreshReply,
} from '../src/auth/kick-refresh'
import {
  KickAdapter,
  type KickAdapterDependencies,
  type KickSendBody,
  type KickSocket,
  type KickSocketEvents,
} from '../src/platforms/kick/adapter'
import type { KickRetryClock } from '../src/platforms/kick/retry'

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

class Clock implements KickRetryClock {
  time = 1000000
  sequence = 0
  tasks = new Map<number, { at: number; callback: () => void }>()
  now = () => this.time
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.sequence
    this.tasks.set(id, { at: this.time + delay, callback })
    return () => {
      this.tasks.delete(id)
    }
  }
  nextDelay(): number | undefined {
    const next = [...this.tasks.values()].toSorted((a, b) => a.at - b.at).at(0)
    return next === undefined ? undefined : next.at - this.time
  }
  async advance(ms: number): Promise<void> {
    const end = this.time + ms
    while (true) {
      const next = [...this.tasks].toSorted((a, b) => a[1].at - b[1].at).at(0)
      if (!next || next[1].at > end) break
      this.time = next[1].at
      this.tasks.delete(next[0])
      next[1].callback()
      await flush()
    }
    this.time = end
    await flush()
  }
}

class Socket implements KickSocket {
  private listeners: { [K in keyof KickSocketEvents]: Set<(event: KickSocketEvents[K]) => void> } =
    {
      open: new Set(),
      message: new Set(),
      close: new Set(),
      error: new Set(),
    }
  sent: string[] = []
  closed = false
  addEventListener<K extends keyof KickSocketEvents>(
    event: K,
    listener: (value: KickSocketEvents[K]) => void,
  ): void {
    this.listeners[event].add(listener)
  }
  emit<K extends keyof KickSocketEvents>(event: K, value: KickSocketEvents[K]): void {
    for (const listener of this.listeners[event]) listener(value)
  }
  message(event: string, data: object = {}): void {
    this.emit('message', {
      data: JSON.stringify({
        push: { channel: 'chatrooms.7.v2', pub: { data: { event, data: JSON.stringify(data) } } },
      }),
    })
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close', { code: 1000 })
  }
  connected(): void {
    this.emit('open', {})
    this.emit('message', { data: JSON.stringify({ id: 1, connect: {} }) })
    this.emit('message', { data: JSON.stringify({ id: 2, subscribe: {} }) })
  }
}

interface Sent {
  body: KickSendBody
  token: string
  signal: AbortSignal
}
interface Failure {
  accountId: string
  message: string
  retryAt: number | null
}

function sentResponse(): Response {
  return Response.json({ data: { is_sent: true, message_id: 'sent' } })
}

function fixture() {
  const clock = new Clock()
  let active: string | null = 'kick:1'
  const tokens = new Map<string, KickRefreshCredentials>([
    ['kick:1', { accessToken: 'expired-secret', refreshToken: 'refresh-secret', expiresAt: 999 }],
  ])
  const state = new Map<string, KickRefreshEntry>()
  const failures: Failure[] = []
  let requests = 0,
    persisted = 0
  let request: (credentials: KickRefreshCredentials) => Promise<KickRefreshReply> = async () => ({
    accessToken: 'fresh-secret',
    refreshToken: 'rotated-secret',
    expiresAt: Math.floor(clock.now() / 1000) + 3600,
  })
  const makeRefresher = () =>
    createKickTokenRefresher({
      state,
      now: clock.now,
      read(id) {
        const value = tokens.get(id)
        return active === id && value?.refreshToken ? value : null
      },
      request(credentials) {
        requests++
        return request(credentials)
      },
      persist(id, credentials) {
        persisted++
        tokens.set(id, credentials)
      },
      failed(accountId, error, retryAt) {
        failures.push({ accountId, message: error.message, retryAt })
      },
    })
  const refresh = makeRefresher()
  const sockets: Socket[] = []
  const lookups: { channel: string; signal: AbortSignal }[] = []
  const sent: Sent[] = []
  let lookup: KickAdapterDependencies['chatroom'] = async (channel) => ({
    chatroomId: channel === 'first' ? 7 : 8,
    broadcasterUserId: channel === 'first' ? 17 : 18,
  })
  let send: KickAdapterDependencies['send'] = async () => sentResponse()
  const dependencies: KickAdapterDependencies = {
    discover: async () => 'wss://realtime.fixture.invalid/connection/websocket',
    token: async () => 'guest-token',
    account: () => (active ? { id: active } : null),
    tokens: (id) => tokens.get(id) ?? null,
    refreshToken: refresh,
    chatroom(channel, signal) {
      lookups.push({ channel, signal })
      return lookup(channel, signal)
    },
    socket() {
      const socket = new Socket()
      sockets.push(socket)
      return socket
    },
    send(body, token, signal) {
      sent.push({ body, token, signal })
      return send(body, token, signal)
    },
    clock,
  }
  const createAdapter = () => {
    const adapter = new KickAdapter(dependencies)
    const statuses: PlatformStatusInfo[] = []
    adapter.on('status', (status) => statuses.push(status))
    return { adapter, statuses }
  }
  return {
    clock,
    tokens,
    state,
    failures,
    refresh,
    makeRefresher,
    sockets,
    lookups,
    sent,
    createAdapter,
    setActive(id: string | null) {
      active = id
    },
    setRequest(next: typeof request) {
      request = next
    },
    setLookup(next: typeof lookup) {
      lookup = next
    },
    setSend(next: typeof send) {
      send = next
    },
    requestCount: () => requests,
    persistCount: () => persisted,
  }
}

function latestSocket(f: ReturnType<typeof fixture>): Socket {
  const socket = f.sockets.at(-1)
  if (!socket) throw new Error('Expected a realtime socket.')
  return socket
}
async function connect(
  f: ReturnType<typeof fixture>,
  adapter: KickAdapter,
  channel = 'first',
): Promise<Socket> {
  const ready = adapter.connect(channel)
  await flush()
  const socket = latestSocket(f)
  socket.connected()
  await ready
  await flush()
  return socket
}

async function rejects(task: Promise<unknown>, message?: string): Promise<void> {
  if (message) await expect(task).rejects.toThrow(message)
  else await expect(task).rejects.toThrow()
}

describe('Kick refresh coordination', () => {
  test('two adapters share one refresh, retain anonymous public chat on failure, and never send expired credentials', async () => {
    const f = fixture()
    const gate = Promise.withResolvers<KickRefreshReply>()
    f.setRequest(() => gate.promise)
    const a = f.createAdapter(),
      b = f.createAdapter()
    const first = await connect(f, a.adapter, 'first')
    await connect(f, b.adapter, 'second')
    expect(f.requestCount()).toBe(1)
    expect(a.statuses.at(-1)?.mode).toBe('anonymous')
    gate.reject(new KickRefreshRequestError('Backend unavailable.'))
    await flush()
    expect(f.failures).toHaveLength(1)
    expect(a.statuses.at(-1)?.status).toBe('connected')
    expect(b.statuses.at(-1)?.mode).toBe('anonymous')
    const messages: string[] = []
    a.adapter.on('message', (message) => messages.push(message.text))
    first.message(String.raw`App\Events\ChatMessageEvent`, {
      id: 'public',
      chatroom_id: 7,
      content: 'still readable',
      type: 'message',
      created_at: '2026-11-02T00:00:00Z',
      sender: {
        id: 99,
        username: 'viewer',
        slug: 'viewer',
        profile_picture: 'https://files.kick.com/fixture.png',
        identity: { color: '#fff', badges: [] },
      },
    })
    await flush()
    expect(messages).toEqual(['still readable'])
    await rejects(a.adapter.sendMessage('17', 'draft must survive'), 'Backend unavailable')
    expect(f.sent).toHaveLength(0)
    expect(f.requestCount()).toBe(1)
    await Promise.all([a.adapter.disconnect(), b.adapter.disconnect()])
  })

  test('cooldown survives a fresh refresher factory, is exponential, and recovers after a bounded manual retry', async () => {
    const f = fixture()
    f.setRequest(async () => {
      throw new KickRefreshRequestError('backend unavailable')
    })
    await rejects(f.refresh('kick:1'))
    for (let index = 0; index < 5; index++)
      await rejects(f.makeRefresher()('kick:1', { manual: true }))
    expect(f.requestCount()).toBe(1)
    expect(f.failures.at(-1)?.retryAt).toBe(f.clock.now() + 15000)
    await f.clock.advance(15000)
    await rejects(f.refresh('kick:1'))
    expect(f.failures.at(-1)?.retryAt).toBe(f.clock.now() + 30000)
    await f.clock.advance(30000)
    await rejects(f.refresh('kick:1'))
    expect(f.failures.at(-1)?.retryAt).toBe(f.clock.now() + 60000)
    await f.clock.advance(4999)
    await rejects(f.refresh('kick:1', { manual: true }))
    expect(f.requestCount()).toBe(3)
    await f.clock.advance(1)
    f.setRequest(async () => ({ accessToken: 'recovered', expiresAt: 9000 }))
    expect(await f.refresh('kick:1', { manual: true })).toBe('recovered')
    expect(f.tokens.get('kick:1')?.refreshToken).toBe('refresh-secret')
    expect(f.state.get('kick:1')?.failures).toBe(0)
  })

  test('permanent OAuth rejection waits for changed credentials rather than retrying every reconnect', async () => {
    const f = fixture()
    f.setRequest(async () => {
      throw new KickRefreshRequestError('Sign in again.', 'reauthorize')
    })
    await rejects(f.refresh('kick:1'), 'Sign in again')
    await f.clock.advance(3600000)
    await rejects(f.makeRefresher()('kick:1', { manual: true }), 'Sign in again')
    expect(f.requestCount()).toBe(1)
    f.tokens.set('kick:1', { accessToken: 'new-login', refreshToken: 'new-refresh' })
    f.setRequest(async () => ({ accessToken: 'recovered' }))
    expect(await f.refresh('kick:1')).toBe('recovered')
    expect(f.tokens.get('kick:1')?.refreshToken).toBe('new-refresh')
  })

  test('late results cannot overwrite replacement OAuth credentials, an account switch, or a forgotten account', async () => {
    for (const change of ['replace', 'switch', 'forget']) {
      const f = fixture()
      const gate = Promise.withResolvers<KickRefreshReply>()
      f.setRequest(() => gate.promise)
      const pending = f.refresh('kick:1')
      const rejected = pending.then(
        () => undefined,
        (error: unknown) => error,
      )
      await flush()
      if (change === 'replace')
        f.tokens.set('kick:1', { accessToken: 'new-login', refreshToken: 'new-refresh' })
      if (change === 'switch') f.setActive('kick:2')
      if (change === 'forget') f.tokens.delete('kick:1')
      gate.resolve({ accessToken: 'late-secret', refreshToken: 'late-refresh' })
      const stale = await rejected
      expect(stale).toBeInstanceOf(Error)
      if (!(stale instanceof Error)) throw new Error('Expected a stale refresh error.')
      expect(stale.message).toContain('account changed')
      expect(f.persistCount()).toBe(0)
      expect(f.tokens.get('kick:1')?.accessToken).not.toBe('late-secret')
      expect(f.failures).toHaveLength(0)
    }
  })

  test('HTTP refresh uses a timeout, validates tokens, and classifies wrapped OAuth failures without exposing bodies', async () => {
    const credentials: KickRefreshCredentials = {
      accessToken: 'old-secret',
      refreshToken: 'refresh-secret',
    }
    const reply = await requestKickRefresh(
      credentials,
      async (path, init) => {
        expect(path).toBe('/api/auth/kick/refresh')
        expect(init.signal).toBeInstanceOf(AbortSignal)
        expect(init.method).toBe('POST')
        return Response.json({ accessToken: 'new', expiresIn: 100 })
      },
      () => 1000000,
    )
    expect(reply.expiresAt).toBe(1100)
    const permanent = requestKickRefresh(
      credentials,
      async () =>
        Response.json(
          {
            error:
              'Error: Kick token refresh failed: 400 {"error":"invalid_grant","secret":"refresh-secret"}',
          },
          { status: 500 },
        ),
      Date.now,
    )
    await rejects(permanent, 'Sign in to Kick again')
    await rejects(
      requestKickRefresh(
        credentials,
        async () => {
          throw Object.assign(new Error('refresh-secret'), { code: 'ECONNREFUSED' })
        },
        Date.now,
      ),
      'connection refused',
    )
    await rejects(
      requestKickRefresh(
        credentials,
        async () => Response.json({ accessToken: '', refreshToken: 'refresh-secret' }),
        Date.now,
      ),
      'invalid token response',
    )
    await rejects(
      requestKickRefresh(
        credentials,
        async () => Response.json({ error: 'Missing X-Client-Secret' }, { status: 401 }),
        Date.now,
      ),
      'HTTP 401',
    )
  })
})

describe('Kick reconnect and delivery lifecycle', () => {
  test('one automatic attempt/timer follows bounded exponential delays and resets only after subscription', async () => {
    const f = fixture()
    f.setActive(null)
    f.setLookup(async () => {
      throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })
    })
    const { adapter } = f.createAdapter()
    await adapter.connect('first')
    for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
      expect(f.clock.tasks.size).toBe(1)
      expect(f.clock.nextDelay()).toBe(delay)
      await f.clock.advance(delay)
    }
    f.setLookup(async () => ({ chatroomId: 7, broadcasterUserId: 17 }))
    await f.clock.advance(60000)
    const merelyOpen = latestSocket(f)
    merelyOpen.emit('close', { code: 1006 })
    await flush()
    expect(f.clock.nextDelay()).toBe(60000)
    await f.clock.advance(60000)
    const socket = latestSocket(f)
    socket.connected()
    await flush()
    expect(f.clock.tasks.size).toBe(0)
    socket.emit('close', { code: 1006 })
    await flush()
    expect(f.clock.nextDelay()).toBe(5000)
    const count = f.lookups.length
    await adapter.disconnect()
    await f.clock.advance(60000)
    expect(f.lookups).toHaveLength(count)
    expect(f.clock.tasks.size).toBe(0)
  })

  test('duplicate connects share one attempt and a switched identity discards late lookups and socket events', async () => {
    const f = fixture()
    const gate = Promise.withResolvers<{
      chatroomId: number
      broadcasterUserId: number
    }>()
    f.setLookup((channel) =>
      channel === 'first'
        ? gate.promise
        : Promise.resolve({ chatroomId: 8, broadcasterUserId: 18 }),
    )
    const { adapter, statuses } = f.createAdapter()
    const old = adapter.connect('first')
    expect(adapter.connect('first')).toBe(old)
    await flush()
    expect(f.lookups).toHaveLength(1)
    f.tokens.set('kick:2', {
      accessToken: 'second-account',
      refreshToken: 'second-refresh',
      expiresAt: 10000,
    })
    f.setActive('kick:2')
    const current = adapter.connect('second')
    expect(f.lookups[0]?.signal.aborted).toBe(true)
    await flush()
    const socket = latestSocket(f)
    socket.connected()
    await current
    const before = statuses.length
    gate.resolve({ chatroomId: 7, broadcasterUserId: 17 })
    await old
    expect(f.sockets).toHaveLength(1)
    expect(adapter.getBroadcasterUserId()).toBe(18)
    expect(statuses.length).toBe(before)
    await adapter.disconnect()
    socket.emit('close', { code: 1006 })
    expect(f.clock.tasks.size).toBe(0)
  })

  test('disconnect cancels an in-flight connection and ignores late successful refresh status', async () => {
    const f = fixture()
    const gate = Promise.withResolvers<KickRefreshReply>()
    f.setRequest(() => gate.promise)
    const { adapter, statuses } = f.createAdapter()
    const connection = adapter.connect('first')
    await flush()
    await adapter.disconnect()
    await connection
    const count = statuses.length
    gate.resolve({ accessToken: 'fresh', expiresAt: 9000 })
    await flush()
    expect(statuses.length).toBe(count)
    expect(statuses.at(-1)?.status).toBe('disconnected')
    expect(latestSocket(f).closed).toBe(true)
    expect(f.clock.tasks.size).toBe(0)
  })

  test('a 401 forces exactly one refresh even for a future-expiry token and retries with the new identity', async () => {
    const f = fixture()
    f.tokens.set('kick:1', {
      accessToken: 'current',
      refreshToken: 'refresh-secret',
      expiresAt: 10000,
    })
    let posts = 0
    f.setSend(async () => (++posts === 1 ? new Response(null, { status: 401 }) : sentResponse()))
    const { adapter } = f.createAdapter()
    await connect(f, adapter)
    expect(f.requestCount()).toBe(0)
    await adapter.sendMessage('17', 'draft', 'parent')
    expect(f.requestCount()).toBe(1)
    expect(f.sent.map((request) => request.token)).toEqual(['current', 'fresh-secret'])
    expect(f.sent[0]?.signal).not.toBe(f.sent[1]?.signal)
    expect(f.sent[1]?.body).toEqual({
      broadcaster_user_id: 17,
      content: 'draft',
      type: 'user',
      reply_to_message_id: 'parent',
    })
    await adapter.disconnect()
  })

  test('an in-flight send rejects after an account switch rather than clearing an unconfirmed draft', async () => {
    const f = fixture()
    f.tokens.set('kick:1', {
      accessToken: 'current',
      refreshToken: 'refresh-secret',
      expiresAt: 10000,
    })
    const gate = Promise.withResolvers<Response>()
    f.setSend(() => gate.promise)
    const { adapter } = f.createAdapter()
    await connect(f, adapter)
    const sending = adapter.sendMessage('17', 'keep this draft')
    const failure = sending.then(
      () => undefined,
      (error: unknown) => error,
    )
    await flush()
    f.setActive('kick:2')
    await adapter.disconnect()
    expect(f.sent[0]?.signal.aborted).toBe(true)
    gate.resolve(sentResponse())
    const error = await failure
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('Expected an unconfirmed delivery error.')
    expect(error.message).toContain('Delivery could not be confirmed')
  })
})

test('completed refreshes have a short minimum interval but changed OAuth credentials can bypass it', async () => {
  const f = fixture()
  await f.refresh('kick:1')
  await rejects(f.makeRefresher()('kick:1', { manual: true }), 'refreshed recently')
  expect(f.requestCount()).toBe(1)
  f.tokens.set('kick:1', { accessToken: 'new-oauth', refreshToken: 'new-oauth-refresh' })
  await f.refresh('kick:1')
  expect(f.requestCount()).toBe(2)
})

test('an old in-flight refresh cannot delete or overwrite a newer credential refresh', async () => {
  const f = fixture()
  const old = Promise.withResolvers<KickRefreshReply>()
  const current = Promise.withResolvers<KickRefreshReply>()
  f.setRequest(() => old.promise)
  const oldResult = f.refresh('kick:1').then(
    () => undefined,
    (error: unknown) => error,
  )
  await flush()
  f.tokens.set('kick:1', { accessToken: 'new-oauth', refreshToken: 'new-oauth-refresh' })
  f.setRequest(() => current.promise)
  const currentResult = f.makeRefresher()('kick:1')
  await flush()
  old.resolve({ accessToken: 'stale' })
  const stale = await oldResult
  expect(stale).toBeInstanceOf(Error)
  expect(f.persistCount()).toBe(0)
  current.resolve({ accessToken: 'latest', refreshToken: 'latest-refresh' })
  expect(await currentResult).toBe('latest')
  expect(f.tokens.get('kick:1')?.refreshToken).toBe('latest-refresh')
  expect(f.persistCount()).toBe(1)
})

test('chatroom and realtime handshake deadlines each leave exactly one bounded retry', async () => {
  for (const phase of ['lookup', 'subscription']) {
    const f = fixture()
    f.setActive(null)
    if (phase === 'lookup')
      f.setLookup(
        (_channel, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      )
    const { adapter, statuses } = f.createAdapter()
    const pending = adapter.connect('first')
    await flush()
    expect(f.clock.nextDelay()).toBe(15000)
    await f.clock.advance(15000)
    await pending
    expect(statuses.at(-1)?.status).toBe('error')
    expect(statuses.at(-1)?.error).toContain('timed out')
    expect(statuses.filter((status) => status.status === 'error')).toHaveLength(1)
    expect(f.clock.tasks.size).toBe(1)
    expect(f.clock.nextDelay()).toBe(5000)
    await adapter.disconnect()
  }
})

test('401 failures never reuse rejected future-expiry credentials and manual reconnect recovers after five seconds', async () => {
  const f = fixture()
  f.tokens.set('kick:1', {
    accessToken: 'current',
    refreshToken: 'refresh-secret',
    expiresAt: 10000,
  })
  f.setRequest(async () => {
    throw new KickRefreshRequestError('Backend unavailable.')
  })
  f.setSend(async () => new Response(null, { status: 401 }))
  const { adapter, statuses } = f.createAdapter()
  await connect(f, adapter)
  await rejects(adapter.sendMessage('17', 'draft'), 'Backend unavailable')
  expect(statuses.at(-1)?.mode).toBe('anonymous')
  for (let index = 0; index < 3; index++) await rejects(adapter.sendMessage('17', 'draft'))
  expect(f.sent).toHaveLength(1)
  expect(f.requestCount()).toBe(1)
  await f.clock.advance(5000)
  f.setRequest(async () => ({ accessToken: 'recovered', expiresAt: 10000 }))
  await connect(f, adapter)
  expect(f.requestCount()).toBe(2)
  expect(statuses.at(-1)?.mode).toBe('authenticated')
  await adapter.disconnect()
})

test('HTTP-200 refresh followed by another 401 cannot hammer refresh on every draft retry', async () => {
  const f = fixture()
  f.tokens.set('kick:1', {
    accessToken: 'current',
    refreshToken: 'refresh-secret',
    expiresAt: 10000,
  })
  f.setSend(async () => new Response(null, { status: 401 }))
  const { adapter, statuses } = f.createAdapter()
  await connect(f, adapter)
  await rejects(adapter.sendMessage('17', 'draft'), 'HTTP 401')
  expect(statuses.at(-1)?.mode).toBe('anonymous')
  for (let index = 0; index < 3; index++)
    await rejects(adapter.sendMessage('17', 'draft'), 'refreshed recently')
  expect(f.requestCount()).toBe(1)
  expect(f.sent).toHaveLength(2)
  await adapter.disconnect()
})

test('network errors after POST are unconfirmed delivery and never trigger an automatic resend', async () => {
  const f = fixture()
  f.tokens.set('kick:1', {
    accessToken: 'current',
    refreshToken: 'refresh-secret',
    expiresAt: 10000,
  })
  f.setSend(async () => {
    throw new Error('secret-token and private draft')
  })
  const { adapter } = f.createAdapter()
  await connect(f, adapter)
  await rejects(adapter.sendMessage('17', 'private draft'), 'delivery could not be confirmed')
  expect(f.sent).toHaveLength(1)
  expect(f.requestCount()).toBe(0)
  f.setSend(async () => Response.json({ error: 'secret-token' }, { status: 503 }))
  await rejects(adapter.sendMessage('17', 'private draft'), 'rejected (HTTP 503)')
  expect(f.sent).toHaveLength(2)
  await adapter.disconnect()
})

test('queued old-channel messages and aborting POST callbacks cannot publish after disconnect', async () => {
  const f = fixture()
  f.tokens.set('kick:1', {
    accessToken: 'current',
    refreshToken: 'refresh-secret',
    expiresAt: 10000,
  })
  f.setSend(
    (_body, _token, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      }),
  )
  const { adapter } = f.createAdapter()
  const socket = await connect(f, adapter)
  const messages: string[] = []
  adapter.on('message', (message) => messages.push(message.id))
  const pending = adapter.sendMessage('17', 'private draft').then(
    () => undefined,
    (error: unknown) => error,
  )
  await flush()
  socket.message(String.raw`App\Events\ChatMessageEvent`, {
    id: 'old',
    chatroom_id: 7,
    content: 'old',
    type: 'message',
    created_at: '2026-11-02T00:00:00Z',
    sender: {
      id: 99,
      username: 'viewer',
      slug: 'viewer',
      profile_picture: 'https://files.kick.com/fixture.png',
      identity: { color: '#fff', badges: [] },
    },
  })
  await Promise.resolve()
  await adapter.disconnect()
  await flush()
  expect(messages).toHaveLength(0)
  const error = await pending
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected an unconfirmed delivery error.')
  expect(error.message).toContain('Delivery could not be confirmed')
  expect(f.sent).toHaveLength(1)
})

test('refresh errors from an old HMR constructor retain validated classification without retaining its prototype', async () => {
  const f = fixture()
  const old = Object.assign(new Error('Sign in again.'), {
    name: 'KickRefreshRequestError',
    kind: 'reauthorize',
  })
  expect(old).not.toBeInstanceOf(KickRefreshRequestError)
  f.setRequest(async () => {
    throw old
  })
  await rejects(f.refresh('kick:1'), 'Sign in again')
  expect(f.failures.at(-1)?.retryAt).toBeNull()
  const block = f.state.get('kick:1')?.block
  expect(block?.error).toEqual({ message: 'Sign in again.', kind: 'reauthorize' })
  expect(block?.error).not.toBeInstanceOf(Error)
  await f.clock.advance(60000)
  await rejects(f.makeRefresher()('kick:1', { manual: true }), 'Sign in again')
  expect(f.requestCount()).toBe(1)
  f.tokens.set('kick:1', { accessToken: 'other', refreshToken: 'other' })
  f.setRequest(async () => {
    throw Object.assign(new Error('secret'), { name: 'KickRefreshRequestError', kind: 'unknown' })
  })
  await rejects(f.refresh('kick:1'), 'backend request failed')
  expect(f.failures.at(-1)?.message).not.toContain('secret')
})

test('Kick delivery acknowledgement distinguishes explicit rejection, missing confirmation and confirmed acceptance', async () => {
  const f = fixture()
  f.tokens.set('kick:1', {
    accessToken: 'current',
    refreshToken: 'refresh-secret',
    expiresAt: 10000,
  })
  const { adapter } = f.createAdapter()
  await connect(f, adapter)
  f.setSend(async () => Response.json({ data: { is_sent: false, message_id: 'reserved' } }))
  await rejects(adapter.sendMessage('17', 'draft'), 'did not send')
  for (const body of [null, {}, { data: {} }, { data: { is_sent: 'yes' } }]) {
    f.setSend(async () => Response.json(body))
    await rejects(adapter.sendMessage('17', 'draft'), 'delivery could not be confirmed')
  }
  f.setSend(async () => new Response('invalid-json'))
  await rejects(adapter.sendMessage('17', 'draft'), 'delivery could not be confirmed')
  expect(f.sent).toHaveLength(6)
  expect(f.requestCount()).toBe(0)
  f.setSend(async () => Response.json({ data: { is_sent: true } }))
  expect(await adapter.sendMessage('17', 'confirmed without an ID')).toEqual({
    channelId: '17',
    messageId: undefined,
  })
  f.setSend(async () => Response.json({ data: { message_id: 'created' } }))
  expect(await adapter.sendMessage('17', 'confirmed by created message ID')).toEqual({
    channelId: '17',
    messageId: 'created',
  })
  expect(f.sent).toHaveLength(8)
  await adapter.disconnect()
})

test('a cancelled queued timer cannot erase the timer of the latest identity', async () => {
  const f = fixture()
  f.setActive(null)
  f.setLookup(async () => {
    throw new Error('offline')
  })
  const { adapter, statuses } = f.createAdapter()
  await adapter.connect('first')
  const stale = [...f.clock.tasks.values()].at(0)?.callback
  if (!stale) throw new Error('Expected an old retry timer.')
  f.setLookup(async () => ({ chatroomId: 8, broadcasterUserId: 18 }))
  const next = adapter.connect('second')
  await flush()
  stale()
  const socket = latestSocket(f)
  socket.connected()
  await next
  expect(f.clock.tasks.size).toBe(0)
  await f.clock.advance(60000)
  expect(socket.closed).toBe(false)
  expect(statuses.at(-1)?.channelLogin).toBe('second')
  expect(statuses.at(-1)?.status).toBe('connected')
  await adapter.disconnect()
})

test('Kick channel casing shares an in-flight connection and malformed publications do not kill chat', async () => {
  const f = fixture()
  f.setActive(null)
  const { adapter, statuses } = f.createAdapter()
  const pending = adapter.connect(' #FIRST ')
  expect(adapter.connect('First')).toBe(pending)
  await flush()
  const socket = latestSocket(f)
  socket.connected()
  await pending
  expect(f.lookups.map((lookup) => lookup.channel)).toEqual(['first'])
  const messages: string[] = []
  adapter.on('message', (message) => messages.push(message.id))
  socket.message(String.raw`App\Events\ChatMessageEvent`, { malformed: true })
  socket.message(String.raw`App\Events\ChatMessageEvent`, {
    id: 'after-malformed',
    metadata: { message_ref: 'official-ref' },
    chatroom_id: 7,
    content: 'valid',
    type: 'message',
    created_at: '2026-11-03T00:00:00Z',
    sender: {
      id: 99,
      username: 'viewer',
      slug: 'viewer',
      profile_picture: 'https://files.kick.com/fixture.png',
      identity: { color: '#fff', badges: [] },
    },
  })
  await flush()
  expect(socket.closed).toBe(false)
  expect(statuses.at(-1)?.status).toBe('connected')
  expect(messages).toEqual(['after-malformed'])
  await adapter.disconnect()
})

test('Kick reply events accept numeric parent authors and object or JSON metadata at the boundary', async () => {
  const f = fixture()
  f.setActive(null)
  const { adapter, statuses } = f.createAdapter()
  const socket = await connect(f, adapter)
  const messages: NormalizedChatMessage[] = []
  adapter.on('message', (message) => messages.push(message))
  const message = {
    chatroom_id: 7,
    content: 'reply body',
    type: 'reply',
    created_at: '2026-11-03T00:00:00Z',
    sender: {
      id: 99,
      username: 'viewer',
      slug: 'viewer',
      profile_picture: 'https://files.kick.com/fixture.png',
      identity: { color: '#fff', badges: [] },
    },
  }
  let sequence = 0
  for (const id of [3195252, '3195252']) {
    const metadata = {
      message_ref: 'reply-ref',
      original_sender: { id, username: 'ParentAuthor' },
      original_message: { id: 'parent-uuid', content: 'parent body' },
    }
    for (const payload of [metadata, JSON.stringify(metadata)]) {
      socket.message(String.raw`App\Events\ChatMessageEvent`, {
        ...message,
        id: `reply-${sequence++}`,
        metadata: payload,
      })
      await flush()
    }
  }
  for (const metadata of [{ message_ref: 'ordinary-ref' }, '{"message_ref":"ordinary-ref"}']) {
    socket.message(String.raw`App\Events\ChatMessageEvent`, {
      ...message,
      id: `ordinary-${sequence++}`,
      type: 'message',
      metadata,
    })
    await flush()
  }
  expect(messages).toHaveLength(6)
  for (const reply of messages.slice(0, 4))
    expect(reply.reply).toEqual({
      parentAuthor: { id: '3195252', username: 'ParentAuthor', displayName: 'ParentAuthor' },
      parentMessageId: 'parent-uuid',
      parentMessageText: 'parent body',
    })
  expect(messages.slice(4).every((message) => message.reply === undefined)).toBe(true)
  expect(socket.closed).toBe(false)
  expect(statuses.at(-1)?.status).toBe('connected')
  await adapter.disconnect()
})

test('invalid Kick reply IDs and malformed JSON metadata skip only their own event', async () => {
  const f = fixture()
  f.setActive(null)
  const { adapter, statuses } = f.createAdapter()
  const socket = await connect(f, adapter)
  const messages: NormalizedChatMessage[] = []
  adapter.on('message', (message) => messages.push(message))
  const message = {
    id: 'invalid',
    chatroom_id: 7,
    content: 'body',
    type: 'reply',
    created_at: '2026-11-03T00:00:00Z',
    sender: {
      id: 99,
      username: 'viewer',
      slug: 'viewer',
      profile_picture: 'https://files.kick.com/fixture.png',
      identity: { color: '#fff', badges: [] },
    },
  }
  for (const id of [-1, 1.25, Number.MAX_SAFE_INTEGER + 1, null, {}, ''])
    socket.message(String.raw`App\Events\ChatMessageEvent`, {
      ...message,
      metadata: {
        original_sender: { id, username: 'ParentAuthor' },
        original_message: { id: 'parent-uuid', content: 'parent body' },
      },
    })
  for (const metadata of ['{', 'null', '[]', '42'])
    socket.message(String.raw`App\Events\ChatMessageEvent`, { ...message, metadata })
  socket.message(String.raw`App\Events\ChatMessageEvent`, {
    ...message,
    id: 'valid-after-malformed',
    metadata: JSON.stringify({
      original_sender: { id: 0, username: 'ParentAuthor' },
      original_message: { id: 'parent-uuid', content: 'parent body' },
    }),
  })
  await flush()
  expect(messages.map((message) => message.id)).toEqual(['valid-after-malformed'])
  expect(messages[0]?.reply?.parentAuthor.id).toBe('0')
  expect(socket.closed).toBe(false)
  expect(statuses.at(-1)?.status).toBe('connected')
  await adapter.disconnect()
})
