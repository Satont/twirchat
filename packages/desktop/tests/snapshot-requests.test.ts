import { expect, test } from 'bun:test'

import { createSnapshotRequests } from '../src/services/snapshot-requests'
import { required } from './fixture-values'

test('coalesces same-channel snapshots, including subsets of an in-flight full snapshot', async () => {
  const broker = createSnapshotRequests()
  let calls = 0
  let finish: ((value: number) => void) | undefined
  const run = () => {
    calls++
    return new Promise<number>((resolve) => {
      finish = resolve
    })
  }
  const first = broker.request('channel', undefined, run)
  const second = broker.request('channel', ['polls'], run)
  await Promise.resolve()
  expect(calls).toBe(1)
  required(finish)(42)
  expect(await Promise.all([first, second])).toEqual([42, 42])
})

test('stopping rejects queued and larger requests without waiting for an active snapshot', async () => {
  const broker = createSnapshotRequests<string>(1)
  const held = Promise.withResolvers<string>()
  let starts = 0
  const run = async () => {
    starts++
    return 'unexpected snapshot'
  }
  const first = broker.request('one', ['polls'], () => held.promise)
  const subset = broker.request('one', ['polls'], run)
  await Promise.resolve()
  const queued = broker.request('two', undefined, run)
  const larger = broker.request('one', undefined, run)
  const cancelled = Promise.allSettled([queued, larger])
  broker.stop()
  broker.stop()
  try {
    expect(await cancelled).toEqual([
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'rejected', reason: expect.any(Error) },
    ])
    await expect(broker.request('late', undefined, run)).rejects.toThrow('stopped')
  } finally {
    held.resolve('finished')
  }
  expect(await Promise.all([first, subset])).toEqual(['finished', 'finished'])
  expect(starts).toBe(0)
}, 1000)

test('stopping in the admission turn prevents a scheduled snapshot from starting', async () => {
  const broker = createSnapshotRequests<string>(1)
  const pending = broker.request('channel', undefined, async () => 'unexpected snapshot')
  broker.stop()
  await expect(pending).rejects.toThrow('stopped')
})

test('bounds total requests and serializes a larger request behind a partial channel snapshot', async () => {
  const broker = createSnapshotRequests(2)
  let active = 0
  let peak = 0
  const order: string[] = []
  const run = (name: string) => async () => {
    active++
    peak = Math.max(peak, active)
    order.push(name)
    await Bun.sleep(5)
    active--
    return name
  }
  const results = await Promise.all([
    broker.request('one', ['pinnedMessage'], run('one pin')),
    broker.request('one', undefined, run('one full')),
    broker.request('two', undefined, run('two')),
    broker.request('three', undefined, run('three')),
  ])
  expect(results).toEqual(['one pin', 'one full', 'two', 'three'])
  expect(peak).toBe(2)
  expect(order.indexOf('one full')).toBeGreaterThan(order.indexOf('one pin'))
})
