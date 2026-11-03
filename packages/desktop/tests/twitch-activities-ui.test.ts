import { afterEach, describe, expect, test } from 'bun:test'

import type {
  TwitchFollowingPage,
  TwitchRedemption,
  TwitchRedemptionsPage,
} from '@twirchat/shared/twitch-activities'

import {
  activityCapabilityText,
  createFollowingController,
  createRewardQueueController,
  mergeRedemptions,
} from '../src/gpuix/components/twitch-activities/controllers'
import { joinFollowedChannel } from '../src/gpuix/components/twitch-activities/join-channel'
import {
  activeTabStore,
  activeWatchedTabStore,
  tabChannelIdsStore,
  watchedChannelsStore,
} from '../src/gpuix/state/app'
import { chatTabsStore } from '../src/gpuix/state/chat-tabs'
import { literal, required } from './fixture-values'

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>()
  return { promise, resolve }
}
function redemption(id: string, rewardId = 'reward'): TwitchRedemption {
  return {
    id,
    rewardId,
    userId: `user-${id}`,
    userName: id,
    input: 'message',
    status: 'UNFULFILLED',
    redeemedAt: '2026-11-02T10:00:00Z',
  }
}
function queueFixture(
  get: (params: {
    rewardId?: string
    cursor?: string
    order?: 'NEWEST' | 'OLDEST'
  }) => Promise<TwitchRedemptionsPage>,
  mutate: (ids: string[], rewardId: string) => Promise<void> = async () => {},
) {
  const mutations: { ids: string[]; rewardId: string }[] = []
  const queue = createRewardQueueController(
    {
      getTwitchRewardRedemptions: get,
      getTwitchRewardQueueSummary: async () => ({ rewards: [] }),
      async executeTwitchActivityAction(action) {
        if (action.action !== 'update_redemptions') throw new Error('Unexpected mutation')
        mutations.push({ ids: action.ids, rewardId: action.rewardId })
        await mutate(action.ids, action.rewardId)
        return {}
      },
    },
    'creator',
  )
  return { queue, mutations }
}
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('activity capability presentation', () => {
  test('labels snapshot mode honestly, including interval and affected fields', () => {
    expect(
      activityCapabilityText({
        channelSlug: 'creator',
        mode: 'snapshot',
        intervalMs: 15000,
        snapshotSections: ['polls', 'pinnedMessage', 'pointsBalance'],
      }),
    ).toBe('Snapshot refresh every 15s: polls, pins, points')
    expect(
      activityCapabilityText({
        channelSlug: 'creator',
        mode: 'eventsub',
        snapshotSections: ['pinnedMessage'],
        intervalMs: 5000,
      }),
    ).toContain('Live via EventSub · snapshot refresh every 5s: pins')
    expect(
      activityCapabilityText({
        channelSlug: 'creator',
        mode: 'unavailable',
        snapshotSections: [],
        error: 'Connect Twitch',
      }),
    ).toBe('Live updates unavailable')
    expect(activityCapabilityText()).toContain('Checking')
  })
})
describe('reward queue pagination, stale fetches and bulk mutations', () => {
  test('all rewards omit rewardId, propagate sort/cursor and deduplicate page boundaries', async () => {
    const queries: unknown[] = []
    const { queue } = queueFixture(async (params) => {
      queries.push(params)
      return params.cursor
        ? { redemptions: [redemption('1'), redemption('2', 'other')] }
        : { redemptions: [redemption('1')], cursor: 'next' }
    })
    await queue.load()
    await queue.load('all')
    expect(queries).toEqual([
      { channelSlug: 'creator', order: 'NEWEST' },
      { channelSlug: 'creator', order: 'NEWEST', cursor: 'next' },
    ])
    expect(queue.store.get().items.map((item) => item.id)).toEqual(['1', '2'])
    expect(queue.store.get().cursor).toBeUndefined()
    queue.setOrder('OLDEST')
    await settle()
    expect(queries.at(-1)).toEqual({ channelSlug: 'creator', order: 'OLDEST' })
    queue.dispose()
  })
  test('switching rewards invalidates the previous request even if it finishes later', async () => {
    const old = deferred<TwitchRedemptionsPage>()
    const { queue } = queueFixture(async (params) =>
      params.rewardId === 'new' ? { redemptions: [redemption('new', 'new')] } : old.promise,
    )
    const first = queue.load()
    queue.selectReward('new')
    await settle()
    old.resolve({ redemptions: [redemption('old')], cursor: 'stale' })
    await first
    expect(queue.store.get().items.map((item) => item.id)).toEqual(['new'])
    expect(queue.store.get().rewardId).toBe('new')
    expect(queue.store.get().cursor).toBeUndefined()
    expect(queue.store.get().loading).toBe(false)
    queue.dispose()
  })
  test('a failed later page preserves already loaded results and retry cursor', async () => {
    const { queue } = queueFixture(async (params) => {
      if (params.cursor) throw new Error('Rate limited')
      return { redemptions: [redemption('keep')], cursor: 'retry' }
    })
    await queue.load('all')
    expect(required(queue.store.get().items[0]).id).toBe('keep')
    expect(queue.store.get().cursor).toBe('retry')
    expect(queue.store.get().error).toBe('Rate limited')
    queue.dispose()
  })
  test('repeated provider cursors terminate load-all with an actionable error', async () => {
    let requests = 0
    const { queue } = queueFixture(async () => {
      requests++
      return { redemptions: [redemption('item')], cursor: 'same' }
    })
    await queue.load('all')
    expect(requests).toBe(2)
    expect(queue.store.get().error).toContain('repeated')
    expect(queue.store.get().cursor).toBeUndefined()
    queue.dispose()
  })
  test('load-all bounds endless empty pages as well as retained rows', async () => {
    let requests = 0
    const { queue } = queueFixture(async () => ({ redemptions: [], cursor: String(++requests) }))
    await queue.load('all')
    expect(requests).toBe(200)
    expect(queue.store.get().error).toContain('200 queue pages')
    queue.dispose()
  })
  test('bulk updates group by actual reward and remove only successful batches', async () => {
    const items = [
      ...Array.from({ length: 51 }, (_, index) => redemption(String(index), 'one')),
      redemption('other', 'two'),
    ]
    const { queue, mutations } = queueFixture(
      async () => ({ redemptions: items }),
      async (ids) => {
        if (ids[0] === '50') throw new Error('Twitch rejected this batch')
      },
    )
    await queue.load()
    queue.selectLoaded()
    await queue.update('FULFILLED')
    expect(mutations.map((batch) => [batch.rewardId, batch.ids.length])).toEqual([
      ['one', 50],
      ['one', 1],
      ['two', 1],
    ])
    expect(queue.store.get().items.map((item) => item.id)).toEqual(['50'])
    expect([...queue.store.get().selected]).toEqual(['50'])
    expect(queue.store.get().feedback).toContain('51 completed')
    expect(queue.store.get().error).toContain('Twitch rejected this batch')
    expect(queue.store.get().mutating).toBe(false)
    queue.dispose()
  })
  test('empty selection makes no writes and disposing stops remaining mutation batches', async () => {
    const response = deferred<void>()
    const items = Array.from({ length: 101 }, (_, index) => redemption(String(index)))
    const { queue, mutations } = queueFixture(
      async () => ({ redemptions: items }),
      () => response.promise,
    )
    await queue.load()
    await queue.update('CANCELED')
    expect(mutations).toHaveLength(0)
    queue.selectLoaded()
    const update = queue.update('CANCELED')
    expect(mutations).toHaveLength(1)
    queue.dispose()
    response.resolve()
    await update
    expect(mutations).toHaveLength(1)
  })
  test('disposed fetches cannot publish or mutate selection', async () => {
    const response = deferred<TwitchRedemptionsPage>()
    const { queue } = queueFixture(() => response.promise)
    const loading = queue.load()
    queue.dispose()
    response.resolve({ redemptions: [redemption('late')] })
    await loading
    expect(queue.store.get().items).toEqual([])
  })
  test('deduplication updates existing data while retaining pagination order', () => {
    const initial = redemption('one')
    expect(
      mergeRedemptions([initial], [{ ...initial, userName: 'updated' }, redemption('two')]).map(
        (item) => item.userName,
      ),
    ).toEqual(['updated', 'two'])
  })
})
describe('following navigation', () => {
  test('all/live switching rejects late results from the previous filter', async () => {
    const first = deferred<TwitchFollowingPage>()
    const controller = createFollowingController({
      getTwitchFollowing: async (params) =>
        params?.liveOnly
          ? first.promise
          : { channels: [{ id: 'all', login: 'all', displayName: 'All', isLive: false }] },
    })
    const live = controller.load(true)
    await controller.load(false)
    first.resolve({ channels: [{ id: 'old', login: 'old', displayName: 'Old', isLive: true }] })
    await live
    expect(controller.store.get().liveOnly).toBe(false)
    expect(required(controller.store.get().page?.channels[0]).id).toBe('all')
    controller.dispose()
  })
  test('following pagination deduplicates channels and stops a repeated cursor', async () => {
    const channel = { id: 'one', login: 'one', displayName: 'One', isLive: true }
    const controller = createFollowingController({
      getTwitchFollowing: async () => ({ channels: [channel], cursor: 'same' }),
    })
    await controller.load(true)
    await controller.load(true, true)
    expect(controller.store.get().page?.channels).toHaveLength(1)
    expect(controller.store.get().page?.cursor).toBeUndefined()
    controller.dispose()
  })
})

const oldStores = {
  watched: watchedChannelsStore.get(),
  ids: tabChannelIdsStore.get(),
  active: activeWatchedTabStore.get(),
  tab: activeTabStore.get(),
  chatTabs: chatTabsStore.get(),
}
afterEach(() => {
  watchedChannelsStore.set(oldStores.watched)
  tabChannelIdsStore.set(oldStores.ids)
  activeWatchedTabStore.set(oldStores.active)
  activeTabStore.set(oldStores.tab)
  chatTabsStore.set(oldStores.chatTabs)
})
function tabApi() {
  chatTabsStore.set({
    value: { version: 1, openIds: [], metadata: {}, closed: [] },
    loaded: false,
    saving: false,
    error: null,
  })
  let raw = JSON.stringify({
    version: 1,
    openIds: tabChannelIdsStore.get(),
    metadata: {},
    closed: [],
  })
  return {
    getUiState: async () => raw,
    setUiState: async ({ value }: { value: string }) => {
      raw = value
    },
    getTabChannelIds: async () => tabChannelIdsStore.get(),
    getWatchedChannelsLayout: async () => null,
    setWatchedChannelsLayout: async () => {},
  }
}
test('join chat persists and selects a real frontend tab; duplicate joins coalesce', async () => {
  watchedChannelsStore.set([])
  tabChannelIdsStore.set(['existing'])
  activeTabStore.set('settings')
  const channel = {
    id: 'joined',
    channelSlug: 'viewer',
    displayName: 'Viewer',
    platform: literal('twitch'),
    createdAt: 0,
  }
  let adds = 0
  const persisted: string[][] = []
  const api = {
    ...tabApi(),
    addWatchedChannel: async () => {
      adds++
      return channel
    },
    getWatchedChannels: async () => [channel],
    setTabChannelIds: async ({ ids }: { ids: string[] }) => {
      persisted.push(ids)
    },
  }
  await Promise.all([joinFollowedChannel(api, 'Viewer'), joinFollowedChannel(api, 'viewer')])
  expect(adds).toBe(1)
  expect(persisted).toEqual([['existing', 'joined']])
  expect(watchedChannelsStore.get()).toEqual([channel])
  expect(tabChannelIdsStore.get()).toEqual(['existing', 'joined'])
  expect(activeWatchedTabStore.get()).toBe('joined')
  expect(activeTabStore.get()).toBe('chat')
  await joinFollowedChannel(api, 'viewer')
  expect(adds).toBe(1)
  expect(persisted).toHaveLength(1)
})

test('joining different channels serializes persisted tab additions', async () => {
  watchedChannelsStore.set([])
  tabChannelIdsStore.set([])
  const channels: import('@twirchat/shared/types').WatchedChannel[] = []
  const persisted: string[][] = []
  const api = {
    ...tabApi(),
    addWatchedChannel: async ({ channelSlug }: { channelSlug: string }) => {
      const channel = {
        id: channelSlug,
        channelSlug,
        displayName: channelSlug,
        platform: literal('twitch'),
        createdAt: 0,
      }
      channels.push(channel)
      return channel
    },
    getWatchedChannels: async () => [...channels],
    setTabChannelIds: async ({ ids }: { ids: string[] }) => {
      await Promise.resolve()
      persisted.push(ids)
    },
  }
  await Promise.all([joinFollowedChannel(api, 'first'), joinFollowedChannel(api, 'second')])
  expect(persisted).toEqual([['first'], ['first', 'second']])
  expect(tabChannelIdsStore.get()).toEqual(['first', 'second'])
})
test('failed tab persistence surfaces errors and permits retry without duplicate channels', async () => {
  const channel = {
    id: 'retry',
    channelSlug: 'retry',
    displayName: 'Retry',
    platform: literal('twitch'),
    createdAt: 0,
  }
  watchedChannelsStore.set([channel])
  tabChannelIdsStore.set([])
  activeWatchedTabStore.set('home')
  let fail = true
  const api = {
    ...tabApi(),
    addWatchedChannel: async () => {
      throw new Error('Already exists')
    },
    getWatchedChannels: async () => [channel],
    setUiState: async () => {
      if (fail) throw new Error('Disk unavailable')
    },
    setTabChannelIds: async () => {},
  }
  await expect(joinFollowedChannel(api, 'retry')).rejects.toThrow('Disk unavailable')
  expect(activeWatchedTabStore.get()).toBe('home')
  fail = false
  await joinFollowedChannel(api, 'retry')
  expect(activeWatchedTabStore.get()).toBe('retry')
})
