import { afterAll, expect, test } from 'bun:test'

import {
  SEVENTV_COSMETICS_INVENTORY_QUERY,
  SEVENTV_COSMETICS_QUERY,
} from '@twirchat/shared/emote-proxy'

import { createProviderRelay } from '../src/api/provider-relay'
import { createProviderProxyRoutes } from '../src/routes/provider-proxy'
import { handleSevenTVImageProxy } from '../src/seventv/image-proxy'

const calls: Array<{ path: string; headers: Headers; method: string; body: string }> = []
const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    calls.push({
      path,
      headers: request.headers,
      method: request.method,
      body: await request.text(),
    })
    if (path.endsWith('/slow')) {
      await Bun.sleep(80)
      return new Response('slow', { headers: { 'Content-Type': 'image/png' } })
    }
    if (path.endsWith('/large'))
      return new Response(new Uint8Array(50), { headers: { 'Content-Type': 'image/png' } })
    if (path.endsWith('/chunked'))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(20))
            controller.enqueue(new Uint8Array(20))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'image/png' } },
      )
    if (path.endsWith('/redirect')) return Response.redirect('http://127.0.0.1:1/private', 302)
    if (path.endsWith('/badtype')) return new Response('<html/>')
    if (path.endsWith('/missing')) return new Response('missing', { status: 404 })
    if (path.endsWith('/presences')) return new Response(null, { status: 204 })
    if (path.endsWith('.gif'))
      return new Response(new Uint8Array([71, 73, 70, 56, 57, 97]), {
        headers: { 'Content-Type': 'image/gif' },
      })
    if (/\/(?:emote|animated|static|badge|emoticon)\//.test(path))
      return new Response('image-bytes', { headers: { 'Content-Type': 'image/webp' } })
    return Response.json({ endpoint: path, ok: true })
  },
})
const fetchUpstream = (source: string, init?: RequestInit) =>
  fetch(upstream.url.origin + new URL(source).pathname, init)

afterAll(async () => {
  await upstream.stop(true)
})

test('image relay preserves exact GIF/FFZ paths, bytes and content type; cache/coalescing avoid repeated fetch', async () => {
  const relay = createProviderRelay({ fetch: fetchUpstream })
  const source = 'https://cdn.7tv.app/emote/01GBFAYKGR000FWWN7MDZZ8XQN/4x.gif'
  const before = calls.length
  const [first, second] = await Promise.all([relay.image(source), relay.image(source)])
  expect(first.headers.get('content-type')).toBe('image/gif')
  expect(first.headers.get('access-control-allow-origin')).toBe('*')
  expect(await first.bytes()).toEqual(new Uint8Array([71, 73, 70, 56, 57, 97]))
  expect(await second.text()).toBe('GIF89a')
  expect(calls.length - before).toBe(1)
  expect(await (await relay.image(source)).text()).toBe('GIF89a')
  expect(calls.length - before).toBe(1)
  await relay.image('https://cdn.frankerfacez.com/animated/123/4')
  expect(calls.at(-1)?.path).toBe('/animated/123/4')
  expect(calls.at(-1)?.headers.get('x-client-secret')).toBeNull()
  expect(calls.at(-1)?.headers.get('authorization')).toBeNull()
})

test('relay rejects arbitrary hosts, credentials, ports, schemes, unsupported API paths and redirect escapes', async () => {
  const relay = createProviderRelay({ fetch: fetchUpstream })
  const before = calls.length
  for (const url of [
    'http://127.0.0.1/private',
    'https://cdn.7tv.app.evil.invalid/emote/1/2x.webp',
    'https://user:password@cdn.7tv.app/emote/1/2x.webp',
    'https://cdn.7tv.app:8443/emote/1/2x.webp',
    'https://cdn.7tv.app/admin',
    'file:///etc/passwd',
  ])
    await expect(relay.image(url)).rejects.toThrow('Unsupported provider image URL.')
  await expect(relay.metadata('https://7tv.io/v3/auth')).rejects.toThrow(
    'Unsupported provider metadata URL.',
  )
  expect(calls.length).toBe(before)
  await expect(relay.image('https://cdn.7tv.app/emote/1/redirect')).rejects.toThrow()
  expect(calls.at(-1)?.path).toBe('/emote/1/redirect')
})

test('relay bounds streamed responses, rejects non-images and expires negative cache', async () => {
  let now = 0
  const relay = createProviderRelay({ fetch: fetchUpstream, imageBytes: 32, now: () => now })
  await expect(relay.image('https://cdn.7tv.app/emote/1/large')).rejects.toThrow('too large')
  await expect(relay.image('https://cdn.7tv.app/emote/1/chunked')).rejects.toThrow('too large')
  await expect(relay.image('https://cdn.7tv.app/emote/1/badtype')).rejects.toThrow(
    'unsupported image',
  )
  const missing = 'https://cdn.7tv.app/emote/1/missing'
  const before = calls.length
  expect((await relay.image(missing)).status).toBe(404)
  await relay.image(missing)
  expect(calls.length - before).toBe(1)
  now = 30_001
  await relay.image(missing)
  expect(calls.length - before).toBe(2)
})

test('cache byte budget evicts oldest data and pending capacity remains bounded', async () => {
  const relay = createProviderRelay({ fetch: fetchUpstream, maxBytes: 20, maxEntries: 2 })
  const before = calls.length
  await relay.image('https://cdn.7tv.app/emote/1/a')
  await relay.image('https://cdn.7tv.app/emote/1/b')
  await relay.image('https://cdn.7tv.app/emote/1/a')
  expect(calls.length - before).toBe(3)
  const limited = createProviderRelay({ fetch: fetchUpstream, maxPending: 1, timeoutMs: 15 })
  const slow = limited.image('https://cdn.7tv.app/emote/1/slow')
  await expect(limited.image('https://cdn.7tv.app/emote/2/slow')).rejects.toThrow('busy')
  await expect(slow).rejects.toThrow('timed out')
})

test('catalog, fixed cosmetics and opted-in presence are relayed without upstream credentials', async () => {
  const relay = createProviderRelay({ fetch: fetchUpstream })
  for (const url of [
    'https://api.betterttv.net/3/cached/emotes/global',
    'https://api.betterttv.net/3/cached/users/twitch/123',
    'https://api.betterttv.net/3/cached/badges',
    'https://api.frankerfacez.com/v1/set/global',
    'https://api.frankerfacez.com/v1/room/id/123',
    'https://api.frankerfacez.com/v1/room/satont',
    'https://api.frankerfacez.com/v1/badges',
    'https://7tv.io/v3/emote-sets/global',
    'https://7tv.io/v3/users/twitch/123',
    'https://api.ffzap.com/v1/supporters',
    'https://flxrs.com/api/badges',
    'https://raw.githubusercontent.com/chatsen/resources/master/assets/data.json',
    'https://chatterinohomies.com/api/badges/list',
    'https://twir.app/api/v1/public/badges',
  ]) {
    const result = await relay.metadata(url)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ ok: true })
  }
  const cosmetics = await relay.metadata('https://7tv.io/v4/gql', {
    query: SEVENTV_COSMETICS_QUERY,
    variables: { platform: 'TWITCH', platformId: '123' },
  })
  expect(cosmetics.status).toBe(200)
  expect(calls.at(-1)?.method).toBe('POST')
  expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toMatchObject({ variables: { platformId: '123' } })
  const inventory = await relay.metadata('https://7tv.io/v4/gql', {
    query: SEVENTV_COSMETICS_INVENTORY_QUERY,
    variables: { platform: 'TWITCH', platformId: '123' },
  })
  expect(inventory.status).toBe(200)
  await expect(
    relay.metadata('https://7tv.io/v4/gql', { query: 'arbitrary mutation' }),
  ).rejects.toThrow('Invalid provider request')
  const presence = await relay.metadata('https://7tv.io/v3/users/abc/presences', {
    kind: 1,
    data: { id: '123', platform: 'KICK' },
  })
  expect(presence.status).toBe(204)
  expect(await presence.text()).toBe('')
})

test('HTTP routes preserve auth boundary and do not forward client headers', async () => {
  const routes = createProviderProxyRoutes(
    createProviderRelay({ fetch: fetchUpstream }),
    async (request) =>
      request.headers.get('x-client-secret')
        ? { clientSecret: 'test' }
        : new Response('unauthorized', { status: 401 }),
  )
  const endpoint =
    'http://localhost/api/provider-metadata?url=' +
    encodeURIComponent('https://api.betterttv.net/3/cached/emotes/global')
  expect((await routes['/api/provider-metadata'].GET(new Request(endpoint))).status).toBe(401)
  expect(
    (
      await routes['/api/provider-metadata'].GET(
        new Request(endpoint, {
          headers: {
            'x-client-secret': 'secret',
            authorization: 'do-not-forward',
            cookie: 'do-not-forward',
          },
        }),
      )
    ).status,
  ).toBe(200)
  expect(calls.at(-1)?.headers.get('authorization')).toBeNull()
  expect(calls.at(-1)?.headers.get('cookie')).toBeNull()
  expect(calls.at(-1)?.headers.get('x-client-secret')).toBeNull()
  expect(
    (
      await routes['/proxy/provider-image'].GET(
        new Request('http://localhost/proxy/provider-image?url=http://127.0.0.1/private'),
      )
    ).status,
  ).toBe(400)
})

test('legacy 7TV image request validates size, format and IDs before touching network', async () => {
  for (const path of [
    '/proxy/7tv/abc?size=../../etc',
    '/proxy/7tv/abc?format=html',
    '/proxy/7tv/abc/extra',
    '/proxy/7tv/',
  ])
    expect((await handleSevenTVImageProxy(new Request('http://localhost' + path))).status).toBe(400)
})

test('relay bounds active upstream work and recovers slots after queued timeouts', async () => {
  let active = 0,
    peak = 0
  const relay = createProviderRelay({
    maxConcurrent: 2,
    timeoutMs: 1000,
    async fetch(source, init) {
      active++
      peak = Math.max(peak, active)
      try {
        return await fetchUpstream(source, init)
      } finally {
        active--
      }
    },
  })
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      relay.image('https://cdn.7tv.app/emote/' + index + '/slow'),
    ),
  )
  expect(peak).toBe(2)
  const short = createProviderRelay({ fetch: fetchUpstream, maxConcurrent: 1, timeoutMs: 15 })
  const results = await Promise.allSettled([
    short.image('https://cdn.7tv.app/emote/1/slow'),
    short.image('https://cdn.7tv.app/emote/2/slow'),
  ])
  expect(results.every((result) => result.status === 'rejected')).toBe(true)
  expect((await short.image('https://cdn.7tv.app/emote/3/fast')).status).toBe(200)
})
