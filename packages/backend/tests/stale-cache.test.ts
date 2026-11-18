import { expect, test } from 'bun:test'

import { createStaleCache } from '../src/api/stale-cache.ts'

function setup(load: (key: string) => Promise<string>, maxEntries = 8) {
  let time = 0
  const calls: string[] = []
  const cache = createStaleCache({
    name: 'test',
    ttlMs: 1000,
    retryMs: 100,
    maxEntries,
    now: () => time,
    load(key) {
      calls.push(key)
      return load(key)
    },
  })
  return {
    cache,
    calls,
    advance(ms: number) {
      time += ms
    },
  }
}

test('concurrent misses share one load and fresh hits skip it', async () => {
  const pending = Promise.withResolvers<string>()
  const { cache, calls } = setup(() => pending.promise)
  const first = cache.get('global')
  const second = cache.get('global')
  pending.resolve('badges')
  expect(await Promise.all([first, second])).toEqual(['badges', 'badges'])
  expect(await cache.get('global')).toBe('badges')
  expect(calls).toEqual(['global'])
})

test('a failed reload serves the stale value and retries after retryMs', async () => {
  let fail = false
  let version = 0
  const { cache, calls, advance } = setup(async () => {
    if (fail) throw new Error('helix down')
    return `v${++version}`
  })
  expect(await cache.get('channel')).toBe('v1')
  fail = true
  advance(1000)
  expect(await cache.get('channel')).toBe('v1')
  advance(99)
  expect(await cache.get('channel')).toBe('v1')
  expect(calls).toHaveLength(2)
  fail = false
  advance(1)
  expect(await cache.get('channel')).toBe('v2')
})

test('a failed first load rejects and is not cached', async () => {
  let fail = true
  const { cache } = setup(async () => {
    if (fail) throw new Error('helix down')
    return 'badges'
  })
  await expect(cache.get('channel')).rejects.toThrow('helix down')
  fail = false
  expect(await cache.get('channel')).toBe('badges')
})

test('the least recently used entry is evicted at the bound', async () => {
  const { cache, calls } = setup(async (key) => key, 2)
  await cache.get('a')
  await cache.get('b')
  await cache.get('a')
  await cache.get('c')
  await cache.get('a')
  await cache.get('b')
  expect(calls).toEqual(['a', 'b', 'c', 'b'])
})
