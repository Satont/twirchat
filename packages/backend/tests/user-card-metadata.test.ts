import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { fetchUserCardMetadata } from '../src/api/user-card-metadata.ts'
import { AccountStore } from '../src/db/store.ts'

describe('user card metadata', () => {
  beforeEach(() => {
    global.fetch = fetch
  })

  it('returns unsupported Kick metadata', async () => {
    const metadata = await fetchUserCardMetadata('client-1', 'kick', 'user-1', '123')

    expect(metadata.platform).toBe('kick')
    expect(metadata.accountAge.status).toBe('unsupported')
    expect(metadata.followAge.status).toBe('unsupported')
    expect(metadata.subscriptionDuration.status).toBe('unsupported')
    expect(metadata.subAge.status).toBe('unsupported')
  })

  it('maps Twitch account age, follow age, and current subscription state', async () => {
    const originalFindByClientAndPlatform = AccountStore.findByClientAndPlatform
    AccountStore.findByClientAndPlatform = async () => ({
      id: 'twitch:broadcaster-id',
      clientSecret: 'client-1',
      platform: 'twitch',
      platformUserId: 'broadcaster-id',
      username: 'broadcaster',
      displayName: 'Broadcaster',
      accessToken: 'token-1',
      scopes: ['channel:read:subscriptions', 'moderator:read:followers'],
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://id.twitch.tv/oauth2/token') {
        return Response.json({
          access_token: 'app-token',
          expires_in: 3600,
        })
      }

      if (url.includes('/helix/users?id=target-user')) {
        return Response.json({
          data: [{ id: 'target-user', created_at: '2020-01-02T03:04:05Z' }],
        })
      }

      if (url.includes('/helix/users?login=broadcaster')) {
        return Response.json({
          data: [{ id: 'broadcaster-id', login: 'broadcaster' }],
        })
      }

      if (url.includes('/helix/channels/followers?')) {
        return Response.json({
          data: [{ followed_at: '2021-02-03T04:05:06Z' }],
        })
      }

      if (url.includes('/helix/subscriptions?')) {
        return Response.json({
          data: [{ tier: '1000', is_gift: true, gifter_name: 'GiftUser' }],
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    try {
      const metadata = await fetchUserCardMetadata(
        'client-1',
        'twitch',
        'target-user',
        'broadcaster',
      )

      expect(metadata.accountAge.status).toBe('available')
      expect(metadata.accountAge.createdAt).toBe('2020-01-02T03:04:05Z')
      expect(metadata.followAge.status).toBe('available')
      expect(metadata.followAge.followedAt).toBe('2021-02-03T04:05:06Z')
      expect(metadata.subscriptionDuration.status).toBe('available')
      expect(metadata.subscriptionDuration.currentlySubscribed).toBe(true)
      expect(metadata.subscriptionDuration.tier).toBe('1000')
      expect(metadata.subAge.status).toBe('unsupported')
    } finally {
      AccountStore.findByClientAndPlatform = originalFindByClientAndPlatform
    }
  })
})
