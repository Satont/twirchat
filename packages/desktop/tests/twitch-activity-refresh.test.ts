import { afterEach, describe, expect, test } from 'bun:test'

import type {
  TwitchActivitiesSnapshot,
  TwitchActivityCapability,
  TwitchActivitySnapshotUpdate,
} from '@twirchat/shared/twitch-activities'

import { TwitchActivityRefreshClient } from '../src/services/twitch-activity-refresh'
import { required } from './fixture-values'

const clients: TwitchActivityRefreshClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.stop()
})
function snapshot(channelSlug: string): TwitchActivitiesSnapshot {
  return {
    channelSlug,
    channelId: `${channelSlug}-id`,
    polls: [],
    predictions: [],
    rewards: [],
    pinnedMessage: null,
    errors: {},
  }
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Refresh did not settle')
    await Bun.sleep(2)
  }
}

describe('active Twitch snapshot refresh', () => {
  test('slows offline-channel refresh and resumes immediately when the stream comes online', async () => {
    let calls = 0
    const client = new TwitchActivityRefreshClient({
      intervalMs: 15,
      plan: async () => ({ mode: 'snapshot', snapshotSections: ['pinnedMessage'], intervalMs: 15 }),
      snapshot: async (channel) => {
        calls++
        return snapshot(channel)
      },
      publish: () => {},
      capability: () => {},
    })
    clients.push(client)
    await client.watch('creator', true)
    client.observeSnapshot(snapshot('creator'))
    client.setChannelOnline('creator-id', false)
    await Bun.sleep(25)
    expect(calls).toBe(0)
    await until(() => calls === 1)
    client.setChannelOnline('creator-id', true)
    await until(() => calls >= 2)
  })
  test('coalesces duplicate channel watches and stops traffic when the final subscriber leaves', async () => {
    let calls = 0
    const updates: TwitchActivitySnapshotUpdate[] = []
    const capabilities: TwitchActivityCapability[] = []
    const client = new TwitchActivityRefreshClient({
      intervalMs: 10,
      plan: async () => ({ mode: 'snapshot', snapshotSections: ['pinnedMessage'], intervalMs: 10 }),
      snapshot: async (channel) => {
        calls++
        return snapshot(channel)
      },
      publish: (value) => updates.push(value),
      capability: (value) => capabilities.push(value),
    })
    clients.push(client)
    await client.watch('Creator', true)
    await client.watch('creator', true)
    await until(() => calls === 1)
    expect(updates).toHaveLength(1)
    expect(required(updates[0]).sections).toEqual(['pinnedMessage'])
    expect(required(capabilities[0]).mode).toBe('snapshot')
    await client.watch('creator', false)
    await until(() => calls >= 2)
    await client.watch('creator', false)
    const after = calls
    await Bun.sleep(30)
    expect(calls).toBe(after)
  })

  test('bounds requests across many unique active channels', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const client = new TwitchActivityRefreshClient({
      maxConcurrency: 2,
      intervalMs: 5,
      plan: async () => ({ mode: 'snapshot', snapshotSections: ['pinnedMessage'], intervalMs: 5 }),
      snapshot: async (channel) => {
        active++
        calls++
        peak = Math.max(peak, active)
        await Bun.sleep(10)
        active--
        return snapshot(channel)
      },
      publish: () => {},
      capability: () => {},
    })
    clients.push(client)
    await Promise.all(
      ['one', 'two', 'three', 'four', 'five'].map((channel) => client.watch(channel, true)),
    )
    await until(() => calls >= 5)
    client.stop()
    expect(peak).toBe(2)
    await Bun.sleep(15)
    const after = calls
    await Bun.sleep(15)
    expect(calls).toBe(after)
  })

  test('backs off after a rate limit and retains an actionable capability error', async () => {
    let calls = 0
    const capabilities: TwitchActivityCapability[] = []
    const client = new TwitchActivityRefreshClient({
      intervalMs: 25,
      plan: async () => ({ mode: 'snapshot', snapshotSections: ['polls'], intervalMs: 25 }),
      snapshot: async (channel) => {
        calls++
        return { ...snapshot(channel), errors: { polls: 'Too many requests (HTTP 429)' } }
      },
      publish: () => {},
      capability: (value) => capabilities.push(value),
    })
    clients.push(client)
    await client.watch('creator', true)
    await until(() => calls === 1)
    await Bun.sleep(30)
    expect(calls).toBe(1)
    expect(capabilities.at(-1)?.error).toContain('429')
    await until(() => calls === 2)
  })

  test('does not poll unavailable accounts or publish a response after unsubscription', async () => {
    let calls = 0
    let published = 0
    const unavailable = new TwitchActivityRefreshClient({
      intervalMs: 5,
      plan: async () => ({
        mode: 'unavailable',
        snapshotSections: [],
        intervalMs: 5,
        error: 'Connect Twitch',
      }),
      snapshot: async (channel) => {
        calls++
        return snapshot(channel)
      },
      publish: () => {},
      capability: () => {},
    })
    clients.push(unavailable)
    await unavailable.watch('creator', true)
    await Bun.sleep(15)
    expect(calls).toBe(0)
    let finish: ((value: TwitchActivitiesSnapshot) => void) | undefined
    const client = new TwitchActivityRefreshClient({
      intervalMs: 5,
      plan: async () => ({ mode: 'snapshot', snapshotSections: ['pinnedMessage'], intervalMs: 5 }),
      snapshot: async () => {
        calls++
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      publish: () => {
        published++
      },
      capability: () => {},
    })
    clients.push(client)
    await client.watch('creator', true)
    await until(() => calls === 1)
    await client.watch('creator', false)
    required(finish)(snapshot('creator'))
    await Bun.sleep(10)
    expect(published).toBe(0)
    expect(calls).toBe(1)
  })
})
