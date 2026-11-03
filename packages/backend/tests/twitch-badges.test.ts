import { expect, test } from 'bun:test'

import type { TwitchBadgesResponse } from '@twirchat/shared/types'

import { helixBadgesSchema, mergeHelixBadges } from '../src/api/twitch-badge-data'

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
