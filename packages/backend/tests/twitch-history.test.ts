import { afterEach, expect, test } from 'bun:test'

import type { TwitchHistoryRequest } from '@twirchat/shared/twitch-history'

import {
  createTwitchHistoryService,
  defaultTwitchHistoryProviders,
  parseTwitchHistoryProviders,
  TwitchHistoryError,
  twitchHistoryRequestSchema,
  type TwitchHistoryProvider,
} from '../src/api/twitch-history'
import { createTwitchHistoryRoutes } from '../src/routes/twitch-history'

const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

function line(id: string, time = 1000, content = 'same text', channel = 'satont', extra = '') {
  return `@id=${id};tmi-sent-ts=${time};rm-received-ts=${time};user-id=42${extra} :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #${channel} :${content}`
}

const query: TwitchHistoryRequest = { channel: 'satont', limit: 100 }

function start(fetch: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

function providers(base: string): TwitchHistoryProvider[] {
  return [
    { id: 'one', kind: 'recent', url: `${base}/one/{channel}` },
    { id: 'two', kind: 'recent', url: `${base}/two/{channel}` },
  ]
}

test('history queries normalize channel/user names and reject invalid bounds or unbounded input', () => {
  expect(
    twitchHistoryRequestSchema.parse({ channel: ' #SaToNt ', username: 'VIEWER', limit: 100 }),
  ).toEqual({ channel: 'satont', username: 'viewer', limit: 100 })
  for (const value of [
    { ...query, channel: '../foo' },
    { ...query, channel: 'foo/bar' },
    { ...query, channel: 'foo', before: 1000, after: 1000 },
    { ...query, channel: 'foo', limit: 1001 },
    { ...query, channel: 'foo', userId: 'not-numeric' },
    { ...query, channel: 'foo', before: Infinity },
    { ...query, beforeId: 'a' },
    { ...query, beforeIdInclusive: true },
    { ...query, channel: 'foo', url: 'https://attacker.invalid' },
  ])
    expect(twitchHistoryRequestSchema.safeParse(value).success).toBe(false)
})

test('server provider configuration defaults to all requested services and accepts an explicit empty list', () => {
  expect(
    defaultTwitchHistoryProviders
      .filter((provider) => provider.kind === 'recent')
      .map((provider) => provider.id),
  ).toEqual(['lilb', 'robotty', 'zneix', 'zonian', 'iore'])
  expect(parseTwitchHistoryProviders(undefined)).toEqual(defaultTwitchHistoryProviders)
  expect(parseTwitchHistoryProviders('[]')).toEqual([])
  for (const value of [
    'invalid-json',
    '[{"id":"one","kind":"recent","url":"http://localhost/{channel}"}]',
    '[{"id":"one","kind":"recent","url":"https://example.test/rm"}]',
    '[{"id":"one","kind":"archive","url":"https://example.test/{channel}"}]',
    '[{"id":"one","kind":"recent","url":"https://secret@example.test/{channel}"}]',
    JSON.stringify([defaultTwitchHistoryProviders[0], defaultTwitchHistoryProviders[0]]),
  ])
    expect(() => parseTwitchHistoryProviders(value)).toThrow()
})

test('composite desktop cursors can include the same Twitch ID in an earlier channel', async () => {
  const base = start(() => Response.json({ messages: [line('a'), line('b'), line('c')] }))
  const history = createTwitchHistoryService({ providers: providers(base) })
  const exclusive = await history.getHistory({ ...query, before: 1001, beforeId: 'b' })
  const inclusive = await history.getHistory({
    ...query,
    before: 1001,
    beforeId: 'b',
    beforeIdInclusive: true,
  })
  expect(exclusive.messages).toEqual([line('a')])
  expect(inclusive.messages).toEqual([line('a'), line('b')])
})

test('overlapping services merge canonical IDs chronologically without collapsing identical text', async () => {
  const base = start((req) =>
    Response.json({
      messages: new URL(req.url).pathname.startsWith('/one/')
        ? [
            line('c', 3000),
            line('a', 1000),
            line('a', 1000),
            line('foreign', 9000, 'wrong channel', 'other'),
          ]
        : [line('b', 2000), line('a', 1000), line('d', 4000)],
    }),
  )
  const result = await createTwitchHistoryService({ providers: providers(base) }).getHistory({
    ...query,
    channel: '#SATONT',
    limit: 3,
  })
  expect(result.messages).toEqual([line('b', 2000), line('c', 3000), line('d', 4000)])
  expect(result.partial).toBe(false)
  expect(result.truncated).toBe(true)
  expect(result.sources.map((source) => source.status)).toEqual(['ok', 'ok'])
})

test('a deletion flag from any provider prevents another provider resurrecting its message', async () => {
  const base = start((req) =>
    Response.json({
      messages: new URL(req.url).pathname.startsWith('/one/')
        ? [line('deleted', 1000), line('keep', 2000)]
        : [line('deleted', 1000, 'same text', 'satont', ';rm-deleted=1')],
    }),
  )
  const result = await createTwitchHistoryService({ providers: providers(base) }).getHistory(query)
  expect(result.messages).toEqual([line('keep', 2000)])
})

test('recent requests filter send-time bounds locally and never confuse them with receipt-time cursors', async () => {
  const calls: Array<{ url: URL; headers: Headers }> = []
  const base = start((req) => {
    calls.push({ url: new URL(req.url), headers: new Headers(req.headers) })
    return Response.json({
      messages: [
        line('lower', 1000),
        line('inside', 1500).replace('rm-received-ts=1500', 'rm-received-ts=9000'),
        line('upper', 2000),
        line('other-user', 1600).replace('user-id=42', 'user-id=99'),
      ],
    })
  })
  const result = await createTwitchHistoryService({
    providers: providers(base).slice(0, 1),
  }).getHistory({
    ...query,
    channel: '#Satont',
    before: 2000,
    after: 1000,
    userId: '42',
    username: 'VIEWER',
  })
  expect(result.messages).toEqual([
    line('inside', 1500).replace('rm-received-ts=1500', 'rm-received-ts=9000'),
  ])
  const request = calls[0]
  expect(request).toBeDefined()
  if (!request) throw new Error('Expected provider request.')
  const url = request.url
  expect(url.pathname).toBe('/one/satont')
  expect(url.searchParams.get('before')).toBeNull()
  expect(url.searchParams.get('after')).toBeNull()
  expect(url.searchParams.get('limit')).toBe('5000')
  expect(url.searchParams.get('hide_moderation_messages')).toBe('true')
  expect(url.searchParams.get('hide_moderated_messages')).toBe('true')
  expect([...request.headers.keys()]).not.toContain('x-client-secret')
  expect(request.headers.get('authorization')).toBeNull()
})

test('Rustlog-compatible user archives preserve raw Twitch metadata and date/offset queries', async () => {
  const calls: URL[] = []
  const base = start((req) => {
    calls.push(new URL(req.url))
    return Response.json({
      messages: [
        { raw: line('archived', 1500), id: 'archived', timestamp: '1970-01-01T00:00:01.500Z' },
      ],
    })
  })
  const service = createTwitchHistoryService({
    providers: [{ id: 'archive', kind: 'archive', url: base }],
  })
  expect((await service.getHistory(query)).sources).toEqual([])
  expect(
    (await service.getHistory({ ...query, username: 'viewer', archive: false })).sources,
  ).toEqual([])
  const result = await service.getHistory({
    ...query,
    username: 'Viewer',
    before: 2000,
    after: 1000,
    offset: 20,
  })
  expect(result.messages).toEqual([line('archived', 1500)])
  const url = calls[0]
  if (!url) throw new Error('Expected archive request.')
  expect(url.pathname).toBe('/channel/satont/user/viewer')
  expect(url.searchParams.get('json')).toBe('true')
  expect(url.searchParams.get('reverse')).toBe('true')
  expect(url.searchParams.get('offset')).toBe('20')
  expect(url.searchParams.get('from')).toBe('1970-01-01T00:00:01.000Z')
  expect(url.searchParams.get('to')).toBe('1970-01-01T00:00:02.000Z')
  expect(result.sources[0]?.capabilities).toEqual(['user', 'time'])
})

test('initial archive queries search across older months and use stable numeric user identities', async () => {
  const now = Date.parse('2026-11-03T07:00:00Z')
  const oldTimestamp = Date.parse('2020-01-01T01:00:00Z')
  const oldMessage = line('old-message', oldTimestamp).replaceAll('viewer', 'oldname')
  const requests: URL[] = []
  const base = start((req) => {
    const url = new URL(req.url)
    requests.push(url)
    if (!url.searchParams.has('from') || !url.searchParams.has('to'))
      return new Response('Would redirect to latest month', { status: 302 })
    return Response.json({
      messages: [
        { raw: oldMessage, id: 'old-message', timestamp: new Date(oldTimestamp).toISOString() },
      ],
    })
  })
  const service = createTwitchHistoryService(
    { providers: [{ id: 'archive', kind: 'archive', url: base }] },
    { fetch, now: () => now },
  )
  const result = await service.getHistory({ ...query, userId: '42', username: 'newname' })
  expect(result.messages).toEqual([oldMessage])
  const url = requests[0]
  if (!url) throw new Error('Expected archive request.')
  expect(url.pathname).toBe('/channel/satont/userid/42')
  expect(url.searchParams.get('from')).toBe('1970-01-01T00:00:00.000Z')
  expect(url.searchParams.get('to')).toBe('2026-11-03T07:00:00.000Z')
})

test('malformed/idless/control/foreign-channel IRC cannot enter history', async () => {
  const base = start(() =>
    Response.json({
      messages: [
        line('valid'),
        'invalid',
        line('idless').replace('id=idless;', ''),
        line('bad-time').replace('tmi-sent-ts=1000', 'tmi-sent-ts=abc'),
        line('foreign', 1000, 'text', 'elsewhere'),
        '@id=notice;tmi-sent-ts=1000 :tmi.twitch.tv NOTICE #satont :Hello',
      ],
    }),
  )
  const result = await createTwitchHistoryService({
    providers: providers(base).slice(0, 1),
  }).getHistory(query)
  expect(result.messages).toEqual([line('valid')])
})

test('partial outage preserves successful history and reports unavailable providers', async () => {
  const base = start((req) =>
    new URL(req.url).pathname.startsWith('/one/')
      ? Response.json({ messages: [line('a')] })
      : new Response('Not logged', { status: 404 }),
  )
  const result = await createTwitchHistoryService({ providers: providers(base) }).getHistory(query)
  expect(result.messages).toEqual([line('a')])
  expect(result.partial).toBe(true)
  expect(result.sources[1]?.status).toBe('unavailable')
})

test('all unavailable/invalid providers fail explicitly with source diagnostics', async () => {
  const base = start((req) =>
    new URL(req.url).pathname.startsWith('/one/')
      ? Response.json({ error: 'Channel is not joined', error_code: 'channel_not_joined' })
      : Response.json({ messages: [42] }),
  )
  try {
    await createTwitchHistoryService({ providers: providers(base) }).getHistory(query)
    throw new Error('Expected history failure.')
  } catch (error) {
    expect(error).toBeInstanceOf(TwitchHistoryError)
    if (!(error instanceof TwitchHistoryError)) throw error
    expect(error.status).toBe(502)
    expect(error.sources.map((source) => source.status)).toEqual(['unavailable', 'error'])
  }
})

test('responses are size-bounded even when the upstream omits Content-Length', async () => {
  const base = start(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(1000)))
            controller.close()
          },
        }),
      ),
  )
  await expect(
    createTwitchHistoryService({ providers: providers(base), responseBytes: 100 }).getHistory(
      query,
    ),
  ).rejects.toThrow('No Twitch history provider')
})

test('upstream redirects cannot leave configured provider URLs', async () => {
  let reached = 0
  const base = start((req) => {
    if (new URL(req.url).pathname === '/escaped') {
      reached++
      return Response.json({ messages: [line('secret')] })
    }
    return Response.redirect(`${base}/escaped`)
  })
  await expect(
    createTwitchHistoryService({ providers: providers(base) }).getHistory(query),
  ).rejects.toThrow()
  expect(reached).toBe(0)
})

test('duplicate requests coalesce, successful requests cache, and TTL/entry limits evict', async () => {
  let calls = 0
  let now = 1000
  const base = start(async () => {
    calls++
    await Bun.sleep(10)
    return Response.json({ messages: [] })
  })
  const service = createTwitchHistoryService(
    { providers: providers(base).slice(0, 1), cacheEntries: 1 },
    { fetch, now: () => now },
  )
  await Promise.all([
    service.getHistory(query),
    service.getHistory({ ...query, channel: '#SATONT' }),
  ])
  expect(calls).toBe(1)
  await service.getHistory(query)
  expect(calls).toBe(1)
  now += 15001
  await service.getHistory(query)
  expect(calls).toBe(2)
  await service.getHistory({ channel: 'other', limit: 100 })
  await service.getHistory(query)
  expect(calls).toBe(4)
})

test('the byte budget prevents oversized responses entering cache', async () => {
  let calls = 0
  const base = start(() => {
    calls++
    return Response.json({ messages: [line('a')] })
  })
  const service = createTwitchHistoryService({
    providers: providers(base).slice(0, 1),
    cacheBytes: 10,
  })
  await service.getHistory(query)
  await service.getHistory(query)
  expect(calls).toBe(2)
})

test('different log windows and users share the provider recent-window cache and in-flight request', async () => {
  let calls = 0
  const base = start(async () => {
    calls++
    await Bun.sleep(10)
    return Response.json({ messages: [line('early', 1000), line('late', 2000)] })
  })
  const service = createTwitchHistoryService({ providers: providers(base).slice(0, 1) })
  const [earlier, later] = await Promise.all([
    service.getHistory({ ...query, before: 2000, username: 'viewer' }),
    service.getHistory({ ...query, after: 1000, limit: 1 }),
  ])
  expect(calls).toBe(1)
  expect(earlier.messages).toEqual([line('early', 1000)])
  expect(later.messages).toEqual([line('late', 2000)])
  expect((await service.getHistory(query)).messages).toEqual([
    line('early', 1000),
    line('late', 2000),
  ])
  expect(calls).toBe(1)
})

test('equal-timestamp canonical IDs remain distinct and configured provider priority is deterministic', async () => {
  const base = start(async (req) => {
    const first = new URL(req.url).pathname.startsWith('/one/')
    if (first) await Bun.sleep(10)
    return Response.json({
      messages: first
        ? [line('b'), line('a', 1000, 'authoritative')]
        : [line('a', 1000, 'other copy')],
    })
  })
  const result = await createTwitchHistoryService({ providers: providers(base) }).getHistory(query)
  expect(result.messages).toEqual([line('a', 1000, 'authoritative'), line('b')])
})

test('user IDs preserve historical username changes while send timestamps remain valid dates', async () => {
  const renamed = line('renamed').replaceAll('viewer', 'oldname')
  const base = start(() =>
    Response.json({
      messages: [
        renamed,
        line('empty-time').replace('tmi-sent-ts=1000', 'tmi-sent-ts='),
        line('invalid-date', 8640000000000001),
      ],
    }),
  )
  const result = await createTwitchHistoryService({
    providers: providers(base).slice(0, 1),
  }).getHistory({ ...query, userId: '42', username: 'newname' })
  expect(result.messages).toEqual([renamed])
})

test('provider network concurrency stays bounded across distinct channel queries', async () => {
  let active = 0
  let peak = 0
  const base = start(async () => {
    active++
    peak = Math.max(peak, active)
    await Bun.sleep(20)
    active--
    return Response.json({ messages: [] })
  })
  const service = createTwitchHistoryService({ providers: providers(base), concurrency: 2 })
  await Promise.all(
    ['one', 'two', 'three', 'four'].map((channel) => service.getHistory({ channel, limit: 100 })),
  )
  expect(peak).toBe(2)
})

test('provider deadlines abort slow responses and queued work without hanging the gateway', async () => {
  const base = start(async () => {
    await Bun.sleep(250)
    return Response.json({ messages: [] })
  })
  const service = createTwitchHistoryService({
    providers: providers(base),
    concurrency: 1,
    timeoutMs: 20,
  })
  const results = await Promise.allSettled([
    service.getHistory(query),
    service.getHistory({ channel: 'other', limit: 100 }),
  ])
  expect(results.every((result) => result.status === 'rejected')).toBe(true)
})

test('history route authenticates, validates request body and does not forward client secrets', async () => {
  let headers: Headers | undefined
  const base = start((req) => {
    headers = req.headers
    return Response.json({ messages: [] })
  })
  const service = createTwitchHistoryService({ providers: providers(base).slice(0, 1) })
  const routes = createTwitchHistoryRoutes(service, async (req) =>
    req.headers.get('X-Client-Secret') === 'client-secret'
      ? { clientSecret: 'client-secret' }
      : new Response('Unauthorized', { status: 401 }),
  )
  const post = (body: string, authenticated = true) =>
    routes['/api/twitch/history'].POST(
      new Request('http://local/api/twitch/history', {
        method: 'POST',
        headers: authenticated ? { 'X-Client-Secret': 'client-secret' } : {},
        body,
      }),
    )
  expect((await post(JSON.stringify(query), false)).status).toBe(401)
  expect((await post('invalid-json')).status).toBe(400)
  expect((await post(JSON.stringify({ ...query, channel: '../escape' }))).status).toBe(400)
  expect((await post('x'.repeat(2049))).status).toBe(413)
  expect((await post(JSON.stringify(query))).status).toBe(200)
  expect(headers?.get('X-Client-Secret')).toBeNull()
})

test('canonical ID cursors paginate over more than 1000 equal-timestamp recent messages', async () => {
  const messages = Array.from({ length: 1200 }, (_, index) =>
    line(`id-${String(index).padStart(4, '0')}`),
  )
  const base = start(() => Response.json({ messages }))
  const service = createTwitchHistoryService({ providers: providers(base).slice(0, 1) })
  const first = await service.getHistory({ ...query, limit: 1000 })
  const second = await service.getHistory({
    ...query,
    limit: 1000,
    before: 1001,
    beforeId: 'id-0200',
  })
  expect(first.messages).toHaveLength(1000)
  expect(first.messages[0]).toBe(line('id-0200'))
  expect(second.messages).toHaveLength(200)
  expect(second.messages.at(-1)).toBe(line('id-0199'))
  expect(new Set([...first.messages, ...second.messages]).size).toBe(1200)
})

test('archive ID ties are completed across upstream offset pages before choosing canonical rows', async () => {
  const messages = Array.from({ length: 1200 }, (_, index) => {
    const id = `id-${String(index).padStart(4, '0')}`
    return { raw: line(id), id, timestamp: '1970-01-01T00:00:01.000Z' }
  })
  const offsets: number[] = []
  const base = start((req) => {
    const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0)
    offsets.push(offset)
    return Response.json({ messages: messages.slice(offset, offset + 1000) })
  })
  const service = createTwitchHistoryService({
    providers: [{ id: 'archive', kind: 'archive', url: base }],
  })
  const first = await service.getHistory({ ...query, limit: 1000, archive: true })
  const second = await service.getHistory({
    ...query,
    limit: 1000,
    before: 1001,
    beforeId: 'id-0200',
    archive: true,
  })
  expect(first.messages[0]).toBe(line('id-0200'))
  expect(second.messages.at(-1)).toBe(line('id-0199'))
  expect(new Set([...first.messages, ...second.messages]).size).toBe(1200)
  expect(offsets).toEqual([0, 1000, 0, 1000])
})

test('literal body filtering excludes tags and CTCP markers before limiting the recent window', async () => {
  const base = start(() =>
    Response.json({
      messages: [
        line('metadata-only'),
        line('action-marker', 1000, '\u0001ACTION hello\u0001'),
        line('literal', 1000, 'Find literal [a-z]'),
        line('not-a-regex', 1000, 'Find abc'),
      ],
    }),
  )
  const service = createTwitchHistoryService({ providers: providers(base).slice(0, 1) })
  expect((await service.getHistory({ ...query, text: '[A-Z]', limit: 1 })).messages).toEqual([
    line('literal', 1000, 'Find literal [a-z]'),
  ])
  expect((await service.getHistory({ ...query, text: 'user-id' })).messages).toEqual([])
  expect((await service.getHistory({ ...query, text: 'ACTION' })).messages).toEqual([])
})

test('archive keyword searches continue past a full nonmatching page', async () => {
  const messages = Array.from({ length: 1001 }, (_, index) => {
    const id = `id-${String(index).padStart(4, '0')}`
    return {
      raw: line(id, 100000 - index, index === 1000 ? 'Needle' : 'irrelevant'),
      id,
      timestamp: new Date(100000 - index).toISOString(),
    }
  })
  let calls = 0
  const base = start((req) => {
    calls++
    const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0)
    return Response.json({ messages: messages.slice(offset, offset + 1000) })
  })
  const service = createTwitchHistoryService({
    providers: [{ id: 'archive', kind: 'archive', url: base }],
  })
  const result = await service.getHistory({ ...query, text: 'needle', archive: true })
  expect(result.messages).toEqual([line('id-1000', 99000, 'Needle')])
  expect(result.partial).toBe(false)
  expect(calls).toBe(2)
})

test('archive byte-budget stops return an explicit partial warning even when no keyword matched', async () => {
  const messages = Array.from({ length: 1000 }, (_, index) => {
    const id = `id-${String(index).padStart(4, '0')}`
    return { raw: line(id, 100000 - index), id, timestamp: new Date(100000 - index).toISOString() }
  })
  const body = JSON.stringify({ messages })
  const base = start(() => new Response(body, { headers: { 'Content-Type': 'application/json' } }))
  const service = createTwitchHistoryService({
    providers: [{ id: 'archive', kind: 'archive', url: base }],
    responseBytes: new TextEncoder().encode(body).byteLength + 1,
  })
  const result = await service.getHistory({ ...query, text: 'needle', archive: true })
  expect(result.messages).toEqual([])
  expect(result.partial).toBe(true)
  expect(result.truncated).toBe(true)
  expect(result.sources[0]?.error).toBeDefined()
})

test('archive deadlines retain prior pages as partial instead of claiming an empty complete result', async () => {
  const messages = Array.from({ length: 1000 }, (_, index) => {
    const id = `id-${String(index).padStart(4, '0')}`
    return { raw: line(id, 100000 - index), id, timestamp: new Date(100000 - index).toISOString() }
  })
  const base = start(async (req) => {
    if (new URL(req.url).searchParams.has('offset')) await Bun.sleep(100)
    return Response.json({ messages })
  })
  const service = createTwitchHistoryService({
    providers: [{ id: 'archive', kind: 'archive', url: base }],
    timeoutMs: 30,
  })
  const result = await service.getHistory({ ...query, text: 'needle', archive: true })
  expect(result.messages).toEqual([])
  expect(result.partial).toBe(true)
  expect(result.sources[0]?.error).toContain('Archive scan stopped')
})

test('partial query results expire quickly enough for provider recovery', async () => {
  let healthy = false
  let now = 1000
  const base = start((req) =>
    new URL(req.url).pathname.startsWith('/one/') || healthy
      ? Response.json({ messages: [] })
      : new Response('Unavailable', { status: 404 }),
  )
  const service = createTwitchHistoryService(
    { providers: providers(base) },
    { fetch, now: () => now },
  )
  expect((await service.getHistory({ ...query, username: 'viewer' })).partial).toBe(true)
  healthy = true
  now += 3001
  expect((await service.getHistory({ ...query, username: 'viewer' })).partial).toBe(false)
})
