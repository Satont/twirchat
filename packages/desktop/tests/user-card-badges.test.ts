import { describe, expect, test } from 'bun:test'

import type { Badge, NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { collectUserBadges, mergeBadges } from '../src/gpuix/components/user-card-dialog/utils'

function badge(id: string, type: string): Badge {
  return { id, type, text: `${type} ${id}` }
}

function message(
  platform: Platform,
  authorId: string,
  badges: Badge[],
  id = `${platform}-${authorId}-${badges.map((entry) => entry.id).join('-')}`,
): NormalizedChatMessage {
  return {
    id,
    platform,
    channelId: 'channel',
    author: { id: authorId, displayName: authorId, badges },
    text: 'hello',
    emotes: [],
    timestamp: new Date(0),
    type: 'message',
  }
}

describe('mergeBadges', () => {
  test('keeps every badge from both platform and cosmetic sources', () => {
    const platform = [badge('moderator/1', 'moderator'), badge('subscriber/12', 'subscriber')]
    const cosmetics = [badge('7tv/1', 'seventv'), badge('bttv/2', 'bttv'), badge('ffz/3', 'ffz')]

    expect(mergeBadges(platform, cosmetics)).toEqual([...platform, ...cosmetics])
  })

  test('deduplicates badges by type and id while keeping the first occurrence', () => {
    const platform = [badge('moderator/1', 'moderator'), badge('subscriber/12', 'subscriber')]
    const cosmetics = [
      badge('moderator/1', 'moderator'),
      badge('7tv/1', 'seventv'),
      badge('subscriber/12', 'subscriber'),
    ]

    expect(mergeBadges(platform, cosmetics)).toEqual([
      badge('moderator/1', 'moderator'),
      badge('subscriber/12', 'subscriber'),
      badge('7tv/1', 'seventv'),
    ])
  })

  test('keeps badges that share an id but have different types', () => {
    const platform = [badge('1', 'moderator')]
    const cosmetics = [badge('1', 'seventv')]

    expect(mergeBadges(platform, cosmetics)).toEqual([...platform, ...cosmetics])
  })

  test('accepts missing collections', () => {
    const platform = [badge('moderator/1', 'moderator')]

    expect(mergeBadges(platform, undefined)).toEqual(platform)
    expect(mergeBadges(undefined, undefined)).toEqual([])
  })
})

describe('collectUserBadges', () => {
  test('unions every badge the user displayed across messages in the same platform', () => {
    const moderator = badge('moderator/1', 'moderator')
    const subscriber = badge('subscriber/12', 'subscriber')
    const premium = badge('premium/1', 'premium')

    expect(
      collectUserBadges(
        [
          message('twitch', 'user-1', [subscriber, premium]),
          message('twitch', 'user-1', [moderator, subscriber]),
          message('twitch', 'user-2', [badge('vip/1', 'vip')]),
          message('kick', 'user-1', [badge('moderator/1', 'moderator')]),
        ],
        'twitch',
        'user-1',
      ),
    ).toEqual([subscriber, premium, moderator])
  })

  test('returns an empty list when the user has not spoken', () => {
    expect(
      collectUserBadges(
        [message('twitch', 'other', [badge('moderator/1', 'moderator')])],
        'twitch',
        'user-1',
      ),
    ).toEqual([])
  })
})
