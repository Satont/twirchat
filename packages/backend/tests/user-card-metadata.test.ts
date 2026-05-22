import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { fetchUserCardMetadata } from '../src/api/user-card-metadata.ts'

describe('user card metadata', () => {
  beforeEach(() => {
    global.fetch = fetch
  })

  it('returns graceful Kick metadata unavailable state when numeric IDs are missing', async () => {
    global.fetch = mock(async (input: string | URL | Request) => {
      throw new Error(`Unexpected fetch: ${String(input)}`)
    }) as unknown as typeof global.fetch

    const metadata = await fetchUserCardMetadata({
      platform: 'kick',
      platformUserId: 'user-1',
    })

    expect(metadata.platform).toBe('kick')
    expect(metadata.accountAge.status).toBe('unsupported')
    expect(metadata.followAge.status).toBe('unavailable')
    expect(metadata.followAge.message).toContain('channel and user IDs')
    expect(metadata.subscriptionDuration.status).toBe('unavailable')
    expect(metadata.subscriptionDuration.message).toContain('channel and user IDs')
    expect(metadata.subAge.status).toBe('unavailable')
  })

  it('maps Twitch account age, follow age, and current subscription state', async () => {
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

    const metadata = await fetchUserCardMetadata({
      platform: 'twitch',
      platformUserId: 'target-user',
      channelId: 'broadcaster',
      twitchAuth: {
        accessToken: 'token-1',
        platformUserId: 'broadcaster-id',
        scopes: ['channel:read:subscriptions', 'moderator:read:followers'],
      },
    })

    expect(metadata.accountAge.status).toBe('available')
    expect(metadata.accountAge.createdAt).toBe('2020-01-02T03:04:05Z')
    expect(metadata.followAge.status).toBe('available')
    expect(metadata.followAge.followedAt).toBe('2021-02-03T04:05:06Z')
    expect(metadata.subscriptionDuration.status).toBe('available')
    expect(metadata.subscriptionDuration.currentlySubscribed).toBe(true)
    expect(metadata.subscriptionDuration.tier).toBe('1000')
    expect(metadata.subAge.status).toBe('unsupported')
  })

  it('maps Kick follow and subscription data from numeric channel user identity endpoint', async () => {
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://kick.com/api/v2/channels/123/users/35676191/identity') {
        return Response.json({
          id: 35676191,
          username: 'jopyle4ka',
          role: 'subscriber',
          badges: [],
          following_since: '2024-06-11T18:39:20.000000Z',
          subscribed_since: '2025-01-02T03:04:05.000000Z',
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    const metadata = await fetchUserCardMetadata({
      platform: 'kick',
      platformUserId: '35676191',
      username: 'jopyle4ka',
      channelId: '123',
      channelSlug: 'satont',
    })

    expect(metadata.accountAge.status).toBe('unsupported')
    expect(metadata.followAge.status).toBe('available')
    expect(metadata.followAge.followedAt).toBe('2024-06-11T18:39:20.000000Z')
    expect(metadata.subscriptionDuration.status).toBe('available')
    expect(metadata.subscriptionDuration.currentlySubscribed).toBe(true)
    expect(metadata.subscriptionDuration.message).toContain('2025-01-02T03:04:05.000000Z')
    expect(metadata.subAge.status).toBe('unavailable')
    expect(metadata.subAge.months).toBeNull()
  })

  it('reports Kick follow metadata as unavailable when following_since is missing', async () => {
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://kick.com/api/v2/channels/123/users/35676191/identity') {
        return Response.json({
          id: 35676191,
          username: 'jopyle4ka',
          role: 'subscriber',
          badges: [],
          subscribed_since: '2025-01-02T03:04:05.000000Z',
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    const metadata = await fetchUserCardMetadata({
      platform: 'kick',
      platformUserId: '35676191',
      channelId: '123',
    })

    expect(metadata.followAge.status).toBe('unavailable')
    expect(metadata.followAge.message).toBe(
      'Unable to verify Kick follow status from identity metadata.',
    )
    expect(metadata.subscriptionDuration.status).toBe('available')
    expect(metadata.subscriptionDuration.currentlySubscribed).toBe(true)
  })

  it('reports Kick identity lookup status when the numeric endpoint fails', async () => {
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://kick.com/api/v2/channels/123/users/35676191/identity') {
        return new Response(null, { status: 404 })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    const metadata = await fetchUserCardMetadata({
      platform: 'kick',
      platformUserId: '35676191',
      channelId: '123',
    })

    expect(metadata.followAge.status).toBe('unavailable')
    expect(metadata.followAge.message).toBe(
      'Unable to verify Kick follow status from identity metadata (404).',
    )
    expect(metadata.subscriptionDuration.message).toBe(
      'Unable to verify Kick follow status from identity metadata (404).',
    )
    expect(metadata.subAge.message).toBe(
      'Unable to verify Kick follow status from identity metadata (404).',
    )
  })
})
