import { afterEach, expect, mock, test } from 'bun:test'

import type { TwitchBadgesResponse } from '@twirchat/shared/types'

import { helixBadgesSchema, mergeHelixBadges } from '../src/api/twitch-badge-data'
import { handleTwitchBadges, TwitchBadgesRequestError } from '../src/api/twitch-badges'
import { fetchUrl } from './literal'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const helixSet = (setId: string, image: string) => ({
  data: [
    {
      set_id: setId,
      versions: [{ id: '1', image_url_1x: image, title: setId, description: `${setId} badge` }],
    },
  ],
})

test('badge catalogs come from cached Helix data, merged or per channel', async () => {
  const helixCalls: string[] = []
  globalThis.fetch = Object.assign(
    mock(async (input: string | URL | Request) => {
      const url = fetchUrl(input)
      if (url === 'https://id.twitch.tv/oauth2/token') {
        return Response.json({ access_token: 'app-token', expires_in: 3600 })
      }
      helixCalls.push(url)
      if (url.endsWith('/chat/badges/global')) {
        return Response.json(helixSet('moderator', 'https://example.com/moderator.png'))
      }
      const login = new URL(url).searchParams.get('login')
      if (login) return Response.json({ data: [{ id: '42', login }] })
      return Response.json(helixSet('subscriber', 'https://example.com/subscriber.png'))
    }),
    { preconnect: originalFetch.preconnect },
  )

  const merged = await handleTwitchBadges(
    new URL('http://localhost/api/twitch/badges?broadcasterLogin=Cached'),
  )
  expect(Object.keys(merged.badges).toSorted()).toEqual(['moderator/1', 'subscriber/1'])

  const channelOnly = await handleTwitchBadges(
    new URL('http://localhost/api/twitch/badges?broadcasterLogin=cached&scope=channel'),
  )
  expect(channelOnly.badges).toEqual({ 'subscriber/1': 'https://example.com/subscriber.png' })
  expect(helixCalls).toHaveLength(3)

  await expect(
    handleTwitchBadges(new URL('http://localhost/api/twitch/badges?scope=channel')),
  ).rejects.toBeInstanceOf(TwitchBadgesRequestError)

  // All-digit logins are valid and must resolve as logins, not be taken as user ids.
  helixCalls.length = 0
  await handleTwitchBadges(
    new URL('http://localhost/api/twitch/badges?broadcasterLogin=1234567&scope=channel'),
  )
  expect(helixCalls).toEqual([
    'https://api.twitch.tv/helix/users?login=1234567',
    'https://api.twitch.tv/helix/chat/badges?broadcaster_id=42',
  ])
})

test('channel badge versions override both global artwork and metadata', () => {
  const result: Required<TwitchBadgesResponse> = { badges: {}, badgeMetadata: {} }
  for (const source of ['global', 'channel']) {
    mergeHelixBadges(
      result,
      helixBadgesSchema.parse({
        data: [
          {
            set_id: 'subscriber',
            versions: [
              {
                id: '12',
                image_url_1x: `https://example.com/${source}.png`,
                title: `${source} subscriber`,
                description: `${source} description`,
              },
            ],
          },
        ],
      }),
    )
  }
  expect(result).toEqual({
    badges: { 'subscriber/12': 'https://example.com/channel.png' },
    badgeMetadata: {
      'subscriber/12': { title: 'channel subscriber', description: 'channel description' },
    },
  })
})

test('Helix badge metadata is validated at the API boundary', () => {
  expect(
    helixBadgesSchema.safeParse({
      data: [
        {
          set_id: 'subscriber',
          versions: [{ id: '1', image_url_1x: 'https://example.com/badge.png', title: 42 }],
        },
      ],
    }).success,
  ).toBe(false)
})
