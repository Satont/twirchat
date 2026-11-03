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
