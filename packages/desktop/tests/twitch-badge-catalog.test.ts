import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createTwitchBadgeCatalog,
  type StoredTwitchBadgeCatalog,
  type TwitchBadgeCatalog,
} from '../src/platforms/twitch/badge-catalog'
import { openDatabase } from '../src/store/db'
import { createTwitchBadgeCatalogStore } from '../src/store/twitch-badge-catalog-store'

interface Timer {
  at: number
  run(): void
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const globalPayload = { badges: { 'moderator/1': 'https://example.com/moderator.png' } }
const channelPayload = (channel: string) => ({
  badges: { 'subscriber/12': `https://example.com/${channel}-subscriber.png` },
})

function fakeClock() {
  let time = 1_000_000
  const timers = new Set<Timer>()
  return {
    now: () => time,
    schedule(run: () => void, delayMs: number) {
      const timer = { at: time + delayMs, run }
      timers.add(timer)
      return () => {
        timers.delete(timer)
      }
    },
    async advance(ms: number) {
      const target = time + ms
      for (;;) {
        await flush()
        const due = [...timers].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)
        const next = due[0]
        if (!next) break
        timers.delete(next)
        time = next.at
        next.run()
      }
      time = target
      await flush()
    },
  }
}

async function flush() {
  for (let index = 0; index < 5; index++) await Bun.sleep(0)
}

function memoryStorage(initial: Record<string, StoredTwitchBadgeCatalog> = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    read: (scope: string) => rows.get(scope),
    write(scope: string, payload: unknown, fetchedAt: number) {
      rows.set(scope, { payload, fetchedAt })
    },
  }
}

const catalogs: TwitchBadgeCatalog[] = []
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.dispose()
})

function setup(respond: (path: string) => Response | Promise<Response>, storage = memoryStorage()) {
  const clock = fakeClock()
  const requests: string[] = []
  const catalog = createTwitchBadgeCatalog({
    fetch: async (path) => {
      requests.push(path)
      return respond(path)
    },
    storage,
    now: clock.now,
    random: () => 0,
    schedule: clock.schedule,
  })
  catalogs.push(catalog)
  return { catalog, clock, requests, storage }
}

const healthy = (path: string) => {
  const channel = /broadcasterLogin=([^&]+)/u.exec(path)?.[1]
  return Response.json(channel ? channelPayload(channel) : globalPayload)
}

test('stored catalogs resolve immediately and revalidate in the background', async () => {
  const storage = memoryStorage({
    global: { payload: globalPayload, fetchedAt: 1_000_000 },
    'channel:satont': { payload: channelPayload('stored'), fetchedAt: 1_000_000 },
  })
  const { catalog, clock, requests } = setup(healthy, storage)
  const badges = catalog.resolver('Satont')
  expect(badges.get('moderator/1')?.imageUrl).toBe('https://example.com/moderator.png')
  expect(badges.get('subscriber/12')?.imageUrl).toBe('https://example.com/stored-subscriber.png')

  catalog.acquire('satont')
  await clock.advance(35 * MINUTE)
  expect(requests).toEqual([])

  // With jitter pinned to its low end, channels revalidate at 0.8 × 45 min, global at 0.8 × 2 h.
  await clock.advance(MINUTE)
  expect(requests).toEqual(['/api/twitch/badges?broadcasterLogin=satont&scope=channel'])
  expect(badges.get('subscriber/12')?.imageUrl).toBe('https://example.com/satont-subscriber.png')
  await clock.advance(60 * MINUTE)
  expect(requests.filter((path) => path === '/api/twitch/badges')).toHaveLength(1)
  expect(storage.rows.get('channel:satont')?.payload).toEqual(channelPayload('satont'))
})

test('global badges are fetched once and channel badges stay per channel', async () => {
  const { catalog, clock, requests } = setup(healthy)
  catalog.acquire('first')
  catalog.acquire('second')
  await clock.advance(0)
  expect(requests.filter((path) => path === '/api/twitch/badges')).toHaveLength(1)
  expect(catalog.resolver('first').get('subscriber/12')?.imageUrl).toBe(
    'https://example.com/first-subscriber.png',
  )
  expect(catalog.resolver('second').get('moderator/1')?.imageUrl).toBe(
    'https://example.com/moderator.png',
  )
  expect(catalog.resolver('third').get('subscriber/12')).toBeUndefined()
})

test('default subscriber and bits artwork waits for the channel catalog', async () => {
  const channel = Promise.withResolvers<Response>()
  const { catalog, clock } = setup((path) =>
    path.includes('scope=channel')
      ? channel.promise
      : Response.json({
          badges: {
            'moderator/1': 'https://example.com/moderator.png',
            'subscriber/0': 'https://example.com/default-sub-0.png',
            'subscriber/12': 'https://example.com/default-sub-12.png',
            'bits/100': 'https://example.com/default-bits.png',
          },
        }),
  )
  const badges = catalog.resolver('a')
  catalog.acquire('a')
  await clock.advance(0)
  expect(badges.get('moderator/1')).toBeDefined()
  expect(badges.get('subscriber/12')).toBeUndefined()
  expect(badges.get('bits/100')).toBeUndefined()

  // A channel without custom artwork for a version uses Twitch's default, as Twitch does.
  channel.resolve(Response.json(channelPayload('a')))
  await clock.advance(0)
  expect(badges.get('subscriber/12')?.imageUrl).toBe('https://example.com/a-subscriber.png')
  expect(badges.get('subscriber/0')?.imageUrl).toBe('https://example.com/default-sub-0.png')
  expect(badges.get('bits/100')?.imageUrl).toBe('https://example.com/default-bits.png')
})

test('an outage is probed by one request at a time with growing pauses', async () => {
  let up = false
  const { catalog, clock, requests } = setup((path) =>
    up ? healthy(path) : new Response('bad gateway', { status: 502 }),
  )
  for (const channel of ['a', 'b', 'c', 'd', 'e', 'f']) catalog.acquire(channel)
  await clock.advance(0)
  // Three concurrent requests fail together and count as one failure.
  expect(requests).toHaveLength(3)

  await clock.advance(2499)
  expect(requests).toHaveLength(3)
  await clock.advance(1)
  expect(requests).toHaveLength(4)

  await clock.advance(4999)
  expect(requests).toHaveLength(4)
  await clock.advance(1)
  expect(requests).toHaveLength(5)

  up = true
  await clock.advance(10_000)
  expect(new Set(requests.slice(5)).size).toBe(7)
  for (const channel of ['a', 'b', 'c', 'd', 'e', 'f']) {
    expect(catalog.resolver(channel).get('subscriber/12')).toBeDefined()
  }
})

test('Retry-After stretches the shared pause', async () => {
  const { catalog, clock, requests } = setup(
    () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
  )
  catalog.acquire('a')
  await clock.advance(0)
  const first = requests.length
  await clock.advance(59_000)
  expect(requests).toHaveLength(first)
  await clock.advance(1000)
  expect(requests).toHaveLength(first + 1)
})

test('Retry-After from a concurrent failure still stretches the pause', async () => {
  const { catalog, clock, requests } = setup((path) =>
    path.includes('scope=channel')
      ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
      : new Response('boom', { status: 500 }),
  )
  catalog.acquire('a')
  catalog.acquire('b')
  await clock.advance(0)
  expect(requests).toHaveLength(3)
  await clock.advance(59_000)
  expect(requests).toHaveLength(3)
  await clock.advance(1000)
  expect(requests).toHaveLength(4)
})

test('re-acquiring a scope while its request runs reuses that request', async () => {
  const pending: PromiseWithResolvers<Response>[] = []
  const { catalog, clock, requests } = setup(() => {
    const response = Promise.withResolvers<Response>()
    pending.push(response)
    return response.promise
  })
  const release = catalog.acquire('a')
  await clock.advance(0)
  release()
  catalog.acquire('a')
  await clock.advance(0)
  expect(requests).toHaveLength(2)

  for (const [index, response] of pending.entries()) {
    response.resolve(healthy(requests[index] ?? ''))
  }
  await clock.advance(0)
  expect(requests).toHaveLength(2)
  expect(catalog.resolver('a').get('subscriber/12')?.imageUrl).toBe(
    'https://example.com/a-subscriber.png',
  )
})

test('a failed refresh keeps serving the last catalog', async () => {
  const storage = memoryStorage({
    global: { payload: globalPayload, fetchedAt: 1_000_000 },
  })
  const { catalog, clock, requests } = setup(
    () => new Response('bad gateway', { status: 502 }),
    storage,
  )
  catalog.acquire('a')
  await clock.advance(3 * HOUR)
  expect(requests.length).toBeGreaterThan(1)
  expect(catalog.resolver('a').get('moderator/1')?.imageUrl).toBe(
    'https://example.com/moderator.png',
  )
})

test('a rejected channel does not pause the other channels', async () => {
  const { catalog, clock, requests } = setup((path) =>
    path.includes('broadcasterLogin=missing')
      ? Response.json({ error: 'bad login' }, { status: 400 })
      : healthy(path),
  )
  catalog.acquire('missing')
  await clock.advance(0)
  catalog.acquire('present')
  await clock.advance(0)
  expect(catalog.resolver('present').get('subscriber/12')).toBeDefined()

  const missing = () => requests.filter((path) => path.includes('missing')).length
  expect(missing()).toBe(1)
  await clock.advance(29 * 60 * 1000)
  expect(missing()).toBe(1)
  await clock.advance(60 * 1000)
  expect(missing()).toBe(2)
})

test('invalid payloads are rejected without replacing the stored catalog', async () => {
  const storage = memoryStorage({
    'channel:a': { payload: channelPayload('stored'), fetchedAt: 0 },
  })
  const { catalog, clock } = setup(() => Response.json({ badges: 'nope' }), storage)
  catalog.acquire('a')
  await clock.advance(0)
  expect(catalog.resolver('a').get('subscriber/12')?.imageUrl).toBe(
    'https://example.com/stored-subscriber.png',
  )
  expect(storage.rows.get('channel:a')?.payload).toEqual(channelPayload('stored'))
})

test('ready waits for the first answer, falls back on timeout and never rejects', async () => {
  const pending = Promise.withResolvers<Response>()
  const { catalog, clock } = setup(() => pending.promise)
  let settled = false
  const ready = catalog.ready('a', 2000).then(() => {
    settled = true
  })
  await clock.advance(1999)
  expect(settled).toBe(false)
  await clock.advance(1)
  await ready
  expect(settled).toBe(true)

  const { catalog: healthyCatalog, clock: healthyClock } = setup(healthy)
  const answered = healthyCatalog.ready('a', 60_000)
  await healthyClock.advance(0)
  await answered
  expect(healthyCatalog.resolver('a').get('subscriber/12')).toBeDefined()
})

test('released channels stop revalidating', async () => {
  const { catalog, clock, requests } = setup(healthy)
  const release = catalog.acquire('a')
  await clock.advance(0)
  release()
  release()
  const count = requests.length
  await clock.advance(10 * HOUR)
  expect(requests).toHaveLength(count)
})

test('SQLite storage keeps the global catalog and the newest channels', () => {
  const directory = mkdtempSync(join(tmpdir(), 'twirchat-badges-'))
  const db = openDatabase(join(directory, 'db.sqlite'))
  try {
    const store = createTwitchBadgeCatalogStore(db)
    store.write('global', globalPayload, 1)
    for (let index = 0; index < 130; index++) {
      store.write(`channel:c${index}`, channelPayload(`c${index}`), 10 + index)
    }
    expect(store.read('global')).toEqual({ payload: globalPayload, fetchedAt: 1 })
    expect(store.read('channel:c0')).toBeUndefined()
    expect(store.read('channel:c1')).toBeUndefined()
    expect(store.read('channel:c2')?.payload).toEqual(channelPayload('c2'))
    expect(store.read('channel:c129')?.fetchedAt).toBe(139)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
