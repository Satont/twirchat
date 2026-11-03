import { expect, test } from 'bun:test'

import { createResourceCache } from '../src/gpuix/state/resource-cache'

test('resource cache coalesces repeated authors and notifies only the resolved key', async () => {
  let requests = 0
  const cache = createResourceCache({
    key: (id: string) => id,
    load: async (id) => {
      requests++
      return id.toUpperCase()
    },
  })
  let changed = 0
  let otherChanged = 0
  const stop = cache.subscribe('alice', () => changed++)
  const stopOther = cache.subscribe('bob', () => otherChanged++)
  await Promise.all(Array.from({ length: 100 }, () => cache.ensure('alice')))
  await Bun.sleep(5)
  expect(requests).toBe(1)
  expect(changed).toBe(1)
  expect(otherChanged).toBe(0)
  expect(cache.snapshot('alice')).toEqual({ status: 'ready', value: 'ALICE' })
  stop()
  stopOther()
})

test('resource cache bounds concurrency and evicts inactive entries after settling', async () => {
  let active = 0
  let peak = 0
  const cache = createResourceCache({
    key: (id: number) => String(id),
    capacity: 4,
    concurrency: 2,
    load: async (id) => {
      active++
      peak = Math.max(peak, active)
      await Bun.sleep(2)
      active--
      return id
    },
  })
  const stop = cache.subscribe(0, () => {})
  await Promise.all(Array.from({ length: 6 }, (_, id) => cache.ensure(id)))
  await Bun.sleep(2)
  expect(peak).toBe(2)
  expect(cache.size()).toBeLessThanOrEqual(4)
  expect(cache.snapshot(0)).toEqual({ status: 'ready', value: 0 })
  stop()
})

test('resource cache keeps failures for a cooldown and refreshes expired values', async () => {
  let clock = 1
  let requests = 0
  const cache = createResourceCache({
    key: (id: string) => id,
    now: () => clock,
    retryMs: 10,
    ttlMs: 20,
    load: async () => {
      requests++
      if (requests === 1) throw new Error('offline')
      return requests
    },
  })
  await cache.ensure('alice')
  await cache.ensure('alice')
  expect(requests).toBe(1)
  expect(cache.snapshot('alice')).toEqual({ status: 'error', error: 'offline' })
  clock = 12
  await cache.ensure('alice')
  expect(cache.snapshot('alice')).toEqual({ status: 'ready', value: 2 })
  clock = 33
  await cache.ensure('alice')
  expect(cache.snapshot('alice')).toEqual({ status: 'ready', value: 3 })
})

test('every visible resource beyond idle capacity eventually resolves', async () => {
  const cache = createResourceCache({
    key: (id: number) => String(id),
    capacity: 2,
    concurrency: 1,
    load: async (id) => {
      await Bun.sleep(1)
      return id
    },
  })
  const stops = Array.from({ length: 12 }, (_, id) => cache.subscribe(id, () => {}))
  await Promise.all(Array.from({ length: 12 }, (_, id) => cache.ensure(id)))
  for (let id = 0; id < 12; id++) expect(cache.snapshot(id)).toEqual({ status: 'ready', value: id })
  stops.forEach((stop) => stop())
  expect(cache.size()).toBeLessThanOrEqual(2)
})

test('queued resources leaving the viewport cancel and retry on return', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const loaded: number[] = []
  const cache = createResourceCache({
    key: (id: number) => String(id),
    concurrency: 1,
    load: async (id) => {
      loaded.push(id)
      if (id === 0) await gate
      return id
    },
  })
  const stopFirst = cache.subscribe(0, () => {})
  const stopSecond = cache.subscribe(1, () => {})
  const first = cache.ensure(0)
  const second = cache.ensure(1)
  stopSecond()
  await second
  expect(loaded).toEqual([0])
  release()
  await first
  const stopAgain = cache.subscribe(1, () => {})
  await cache.ensure(1)
  expect(loaded).toEqual([0, 1])
  stopFirst()
  stopAgain()
})

test('shared refresh updates expired visible authors and skips inactive resources', async () => {
  let clock = 0
  let revision = 0
  const cache = createResourceCache({
    key: (id: string) => id,
    now: () => clock,
    ttlMs: 10,
    load: async () => ++revision,
  })
  const stop = cache.subscribe('visible', () => {})
  await cache.ensure('visible')
  await cache.ensure('inactive')
  clock = 11
  cache.refreshSubscribed()
  await cache.ensure('visible')
  expect(cache.snapshot('visible')).toEqual({ status: 'ready', value: 3 })
  expect(cache.snapshot('inactive')).toEqual({ status: 'ready', value: 2 })
  stop()
})
