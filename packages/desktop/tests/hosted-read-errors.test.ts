import { afterEach, expect, test } from 'bun:test'

import { BackendConnection } from '../src/backend-connection'
import { ChatAggregator } from '../src/chat/aggregator'
import { createDesktopApi } from '../src/gpuix/backend/api'
import { createDesktopEvents } from '../src/gpuix/backend/events'
import { t } from '../src/i18n'
import { AccountStore } from '../src/store/account-store'
import { initDb } from '../src/store/db'
import { WatchedChannelManager } from '../src/watched-channels/manager'

const originalFetch = globalThis.fetch
const api = createDesktopApi({
  aggregator: new ChatAggregator(),
  backendConn: new BackendConnection('hosted-read-test'),
  currentStatuses: new Map(),
  events: createDesktopEvents(),
  watchedChannelManager: new WatchedChannelManager(),
  openBrowser() {
    throw new Error('This test does not open external applications.')
  },
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a hosted read cannot turn a legacy upstream error body into a user OAuth prompt', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json(
        { error: 'Error: Failed to get Kick app token: 401 Unauthorized' },
        { status: 500 },
      ),
    { preconnect: originalFetch.preconnect },
  )
  await expect(api.getStreamStatus({ platform: 'kick', channelId: 'example' })).rejects.toThrow(
    t('runtime.api.httpStatus', { action: t('runtime.api.action.loadStreamInfo'), status: 500 }),
  )
  await expect(api.searchCategories({ platform: 'kick', query: 'example' })).rejects.toThrow(
    t('runtime.api.httpStatus', {
      action: t('runtime.api.action.categorySearchFailed'),
      status: 500,
    }),
  )
})

test('a Kick user-token operation still reports expired OAuth from a legacy backend', async () => {
  const database = initDb(':memory:')
  try {
    AccountStore.upsert({
      id: 'kick:123',
      platform: 'kick',
      platformUserId: '123',
      username: 'example',
      displayName: 'Example',
      accessToken: 'fixture-user-token',
    })
    AccountStore.setActive('kick', 'kick:123')
    globalThis.fetch = Object.assign(
      async () => Response.json({ error: 'Kick API failed: 401 Unauthorized' }, { status: 500 }),
      { preconnect: originalFetch.preconnect },
    )
    await expect(
      api.updateStream({ platform: 'kick', channelId: '123', title: 'Test' }),
    ).rejects.toThrow(
      t('runtime.api.authExpired', { action: t('runtime.api.action.updateStream') }),
    )
  } finally {
    database.close()
  }
})

test('a hosted read HTTP 401 does not mean a platform user token expired', async () => {
  globalThis.fetch = Object.assign(
    async () => Response.json({ error: 'Missing X-Client-Secret header' }, { status: 401 }),
    { preconnect: originalFetch.preconnect },
  )
  await expect(api.getChannelsStatus({ channels: [] })).rejects.toThrow(
    t('runtime.api.httpStatus', { action: t('runtime.api.action.loadChannelStatus'), status: 401 }),
  )
})
