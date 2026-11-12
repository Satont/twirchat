import { describe, expect, test } from 'bun:test'

import { parseCosmetics } from '../src/services/cosmetics'

interface BadgeImage {
  url: string
  scale: number
  frameCount: number
}

function images(id: string): BadgeImage[] {
  return [1, 2, 3, 4].map((scale) => ({
    url: `https://cdn.7tv.app/badge/${id}/${scale}x.webp`,
    scale,
    frameCount: 1,
  }))
}

function badge(id: string, name: string, description?: string) {
  return {
    id,
    name,
    ...(description ? { description } : {}),
    images: images(id),
  }
}

function cosmeticsValue(
  inventory: unknown,
  activeBadge: unknown = badge('active', 'Translator (Black)'),
) {
  return {
    data: {
      users: {
        userByConnection: {
          id: '7tv-user',
          personalEmoteSet: { id: 'personal-set' },
          style: {
            activeBadge,
            activePaint: null,
          },
          inventory: { badges: inventory },
        },
      },
    },
  }
}

describe('parseCosmetics badges', () => {
  test('keeps the active badge as the chat badge and exposes the full inventory separately', () => {
    const result = parseCosmetics(
      cosmeticsValue([
        {
          accessible: true,
          to: { badgeId: 'active', badge: badge('active', 'Translator (Black)') },
        },
        {
          accessible: true,
          to: {
            badgeId: 'subscriber',
            badge: badge('subscriber', '7TV Subscriber - 1 Month', 'Monthly subscriber badge'),
          },
        },
        {
          accessible: false,
          to: { badgeId: 'hidden', badge: badge('hidden', 'Hidden badge') },
        },
      ]),
    )

    expect(result.lookupStatus).toBe('available')
    expect(result.badges).toEqual([
      {
        id: '7tv:active',
        type: 'seventv',
        text: 'Translator (Black)',
        imageUrl: 'https://cdn.7tv.app/badge/active/2x.webp',
      },
    ])
    expect(result.inventoryBadges).toEqual([
      {
        id: '7tv:active',
        type: 'seventv',
        text: 'Translator (Black)',
        imageUrl: 'https://cdn.7tv.app/badge/active/2x.webp',
      },
      {
        id: '7tv:subscriber',
        type: 'seventv',
        text: '7TV Subscriber - 1 Month',
        description: 'Monthly subscriber badge',
        imageUrl: 'https://cdn.7tv.app/badge/subscriber/2x.webp',
      },
    ])
  })

  test('falls back to the active badge when inventory is absent', () => {
    const result = parseCosmetics(cosmeticsValue(undefined))

    expect(result.badges).toEqual([
      {
        id: '7tv:active',
        type: 'seventv',
        text: 'Translator (Black)',
        imageUrl: 'https://cdn.7tv.app/badge/active/2x.webp',
      },
    ])
    expect(result.inventoryBadges).toEqual([])
  })

  test('returns inventory badges without an active badge', () => {
    const result = parseCosmetics(
      cosmeticsValue(
        [
          {
            accessible: true,
            to: { badgeId: 'owned', badge: badge('owned', 'Event badge') },
          },
        ],
        null,
      ),
    )

    expect(result.badges).toEqual([])
    expect(result.inventoryBadges).toEqual([
      {
        id: '7tv:owned',
        type: 'seventv',
        text: 'Event badge',
        imageUrl: 'https://cdn.7tv.app/badge/owned/2x.webp',
      },
    ])
  })
})
