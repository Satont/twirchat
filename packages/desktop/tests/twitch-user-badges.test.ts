import { describe, expect, test } from 'bun:test'

import { getTwitchUserBadges } from '../src/services/twitch-user-badges'

const badge = {
  setID: 'sub-gifter',
  version: '1',
  title: 'Sub Gifter',
  description: 'Gifted a subscription.',
  image2x: 'https://static-cdn.jtvnw.net/badges/v1/fixture/2',
}

function viewerCard(earnedBadges: unknown[]) {
  return Response.json([
    {
      data: {
        targetUser: { displayBadges: [{ setID: 'turbo', version: '1' }] },
        channelViewer: { earnedBadges },
      },
      errors: [{ message: 'unauthenticated', path: ['currentUser'] }],
    },
  ])
}

function requestBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string') throw new Error('Expected a JSON request body')
  return JSON.parse(init.body)
}

describe('Twitch ViewerCard badge collection', () => {
  test('requests channel-scoped earned badges anonymously and deduplicates by set and version', async () => {
    const request = new AbortController()
    const badges = await getTwitchUserBadges(
      {
        username: 'GiftSender',
        channelSlug: 'Channel_Name',
        channelId: '1234',
        signal: request.signal,
      },
      async (url, init) => {
        expect(url).toBe('https://gql.twitch.tv/gql')
        expect(init.method).toBe('POST')
        expect(init.credentials).toBe('omit')
        const headers = new Headers(init.headers)
        expect(headers.has('authorization')).toBe(false)
        expect(headers.has('cookie')).toBe(false)
        expect(headers.get('client-id')).toBeTruthy()
        expect(requestBody(init)).toEqual([
          {
            operationName: 'ViewerCard',
            variables: {
              channelLogin: 'channel_name',
              hasChannelID: false,
              giftRecipientLogin: 'giftsender',
              isViewerBadgeCollectionEnabled: true,
              withStandardGifting: true,
              badgeSourceChannelLogin: 'channel_name',
            },
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash: '80c53fe04c79a6414484104ea573c28d6a8436e031a235fc6908de63f51c74fd',
              },
            },
          },
        ])
        return viewerCard([badge, badge, { ...badge, version: '5' }])
      },
    )

    expect(badges).toEqual([
      {
        id: 'twitch:sub-gifter/1',
        type: 'twitch',
        text: badge.title,
        description: badge.description,
        imageUrl: badge.image2x,
      },
      {
        id: 'twitch:sub-gifter/5',
        type: 'twitch',
        text: badge.title,
        description: badge.description,
        imageUrl: badge.image2x,
      },
    ])
  })

  test.each([
    { channelId: 'legacy_login', expected: 'legacy_login' },
    { channelId: '1234', expected: 'viewer' },
    { channelId: 'plugin:watched', expected: 'viewer' },
    { channelId: undefined, expected: 'viewer' },
  ])('uses the channel login or the user’s own channel for $channelId', async (sample) => {
    const badges = await getTwitchUserBadges(
      { username: 'Viewer', channelId: sample.channelId, signal: new AbortController().signal },
      async (_url, init) => {
        expect(requestBody(init)).toMatchObject([
          {
            variables: {
              channelLogin: sample.expected,
              badgeSourceChannelLogin: sample.expected,
            },
          },
        ])
        return viewerCard([])
      },
    )
    expect(badges).toEqual([])
  })

  test('rejects missing and malformed collections', async () => {
    const params = { username: 'Viewer', signal: new AbortController().signal }
    await expect(
      getTwitchUserBadges(params, async () =>
        Response.json([{ errors: [{ message: 'unknown' }] }]),
      ),
    ).rejects.toThrow()
    await expect(
      getTwitchUserBadges(params, async () =>
        viewerCard([{ ...badge, image2x: 'file:///tmp/badge.png' }]),
      ),
    ).rejects.toThrow()
  })

  test('propagates cancellation to the request', async () => {
    const controller = new AbortController()
    await expect(
      getTwitchUserBadges({ username: 'Viewer', signal: controller.signal }, async (_url, init) => {
        controller.abort()
        init.signal?.throwIfAborted()
        return viewerCard([])
      }),
    ).rejects.toThrow('aborted')
  })
})
