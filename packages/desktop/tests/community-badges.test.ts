import { describe, expect, test } from 'bun:test'

import {
  createCommunityBadgeService,
  DEFAULT_COMMUNITY_BADGE_PREFERENCES,
  indexChatsenBadges,
  indexDankChatBadges,
  indexFfzApBadges,
  indexHomiesCustomBadges,
  indexTwirBadges,
} from '../src/services/community-badges'
import { validateEmotePreferences } from '../src/services/emote-preferences'

const ffzapPayload = [
  { id: '26964566', tier: 3 },
  { id: '11819690', tier: 3 },
  { id: '42', tier: 1 },
  { id: 'undefined', tier: 1 },
]
const dankChatPayload = [
  {
    type: 'DankChat Developer',
    url: 'https://api.dank.chat/badges/gold.png',
    users: ['42'],
  },
  {
    type: 'DuckerZ',
    url: 'https://api.dank.chat/badges/ente.gif',
    users: ['42', '43'],
  },
  {
    type: 'DankChat Top Supporter',
    url: 'https://api.dank.chat/badges/top.png',
    users: ['44'],
  },
  { type: 'External', url: 'https://example.com/external.png', users: ['45'] },
]
const chatsenPayload = {
  badges: [
    {
      name: 'developer',
      title: 'Chatsen Developer',
      description: 'That one code guy or something',
      image: 'https://raw.githubusercontent.com/chatsen/resources/master/assets/nagato.gif',
    },
    {
      name: 'early_supporter',
      title: 'Chatsen Early Supporter',
      image:
        'https://raw.githubusercontent.com/chatsen/resources/master/assets/early_supporter.png',
    },
    {
      name: 'test_animated',
      title: 'Animated test',
      image: 'https://raw.githubusercontent.com/chatsen/resources/master/assets/test.gif',
    },
    {
      name: 'chill',
      title: 'Chill',
      image: 'https://raw.githubusercontent.com/chatsen/resources/master/assets/chill.png',
    },
  ],
  users: [
    { id: '42', badges: [{ badgeName: 'early_supporter' }, { badgeName: 'developer' }] },
    { id: '43', badges: [{ badgeName: 'test_animated' }, { badgeName: 'chill' }] },
    { id: '44', badges: [{ badgeName: 'missing' }] },
  ],
}
const homiesPayload = {
  badges: [
    {
      badgeId: 'first',
      tooltip: 'First badge',
      userId: '42',
      image1: 'https://cdn.chatterinohomies.com/badges/first/18.webp',
      image2: 'https://cdn.chatterinohomies.com/badges/first/36.webp',
      image3: 'https://cdn.chatterinohomies.com/badges/first/72.webp',
    },
    {
      badgeId: 'second',
      tooltip: 'Second badge',
      userId: '42',
      image1: 'https://cdn.chatterinohomies.com/badges/second/18.webp',
      image2: 'https://cdn.chatterinohomies.com/badges/second/36.webp',
      image3: 'https://cdn.chatterinohomies.com/badges/second/72.webp',
    },
    {
      badgeId: 'external',
      tooltip: 'External badge',
      userId: '43',
      image1: 'https://example.com/external.webp',
    },
  ],
}
const twirPayload = [
  {
    id: 'contributor',
    name: 'Twir Contributor',
    url: 'https://s3.twir.app/badges/contributor.svg',
    users: ['42', '43'],
  },
  {
    id: 'translator',
    name: 'Twir Translator',
    url: 'https://s3.twir.app/badges/translator.svg',
    users: ['42'],
  },
]

function communityPreferences(enabled: boolean) {
  return {
    ffzap: enabled,
    dankchat: enabled,
    chatsen: enabled,
    homies: enabled,
    twir: enabled,
  }
}

describe('community badge payload adapters', () => {
  test('maps FFZ:AP supporter, helper and developer labels to high-resolution artwork', () => {
    const index = indexFfzApBadges(ffzapPayload)
    expect(index.get('26964566')?.[0]).toMatchObject({
      id: 'ffzap:26964566',
      type: 'ffzap',
      text: 'FFZ:AP Developer',
      imageUrl: 'https://api.ffzap.com/v1/user/badge/26964566/3',
    })
    expect(index.get('11819690')?.[0]?.text).toBe('FFZ:AP Helper')
    expect(index.get('42')?.[0]?.text).toBe('FFZ:AP Supporter')
    expect(index.has('undefined')).toBe(false)
  })

  test('filters deactivated DankChat badges and deterministically keeps the first assignment', () => {
    const index = indexDankChatBadges(dankChatPayload)
    expect(index.get('42')?.[0]?.text).toBe('DankChat Developer')
    expect(index.get('43')?.[0]).toMatchObject({
      type: 'dankchat',
      text: 'DuckerZ',
      imageUrl: 'https://api.dank.chat/badges/ente.gif',
    })
    expect(index.has('44')).toBe(false)
    expect(index.has('45')).toBe(false)
  })

  test('selects Chatsen badges by priority and preserves first-wins for unknown priorities', () => {
    const index = indexChatsenBadges(chatsenPayload)
    expect(index.get('42')?.[0]).toMatchObject({
      id: 'chatsen:developer',
      text: 'Chatsen Developer',
      description: 'That one code guy or something',
    })
    expect(index.get('43')?.[0]?.id).toBe('chatsen:test_animated')
    expect(index.has('44')).toBe(false)
  })

  test('uses Homies Custom only, prefers 72px artwork and keeps the last duplicate', () => {
    const index = indexHomiesCustomBadges(homiesPayload)
    expect(index.get('42')).toEqual([
      {
        id: 'homies-custom:second',
        type: 'homies',
        text: 'Second badge',
        imageUrl: 'https://cdn.chatterinohomies.com/badges/second/72.webp',
      },
    ])
    expect(index.has('43')).toBe(false)
  })

  test('retains every Twir badge assigned to a user in catalog order', () => {
    const index = indexTwirBadges(twirPayload)
    expect(index.get('42')?.map((badge) => badge.id)).toEqual([
      'twir:contributor',
      'twir:translator',
    ])
    expect(index.get('42')?.map((badge) => badge.type)).toEqual(['twir', 'twir'])
    expect(index.get('43')).toHaveLength(1)
  })
})

describe('community badge loading and preferences', () => {
  test('loads exactly the five opted-in catalogs and never supporter or excluded fork endpoints', async () => {
    const calls: string[] = []
    const service = createCommunityBadgeService(async (url) => {
      calls.push(url)
      if (url.includes('ffzap')) return ffzapPayload
      if (url.includes('flxrs')) return dankChatPayload
      if (url.includes('githubusercontent')) return chatsenPayload
      if (url.includes('chatterinohomies')) return homiesPayload
      if (url.includes('twir.app')) return twirPayload
      throw new Error(`Unexpected endpoint ${url}`)
    })
    const badges = await service.getBadges('twitch', '42', {
      badges: true,
      communityBadges: DEFAULT_COMMUNITY_BADGE_PREFERENCES,
    })
    expect(calls).toEqual([
      'https://api.ffzap.com/v1/supporters',
      'https://flxrs.com/api/badges',
      'https://raw.githubusercontent.com/chatsen/resources/master/assets/data.json',
      'https://chatterinohomies.com/api/badges/list',
      'https://twir.app/api/v1/public/badges',
    ])
    expect(calls.some((url) => /itzalex|moltorino|bluzyrino|blazyrino/i.test(url))).toBe(false)
    expect(badges.map((badge) => badge.type)).toEqual([
      'ffzap',
      'dankchat',
      'chatsen',
      'homies',
      'twir',
      'twir',
    ])
  })

  test('does not fetch disabled sources, non-Twitch users or globally disabled badges', async () => {
    const calls: string[] = []
    const service = createCommunityBadgeService(async (url) => {
      calls.push(url)
      return twirPayload
    })
    const enabled = communityPreferences(false)
    enabled.twir = true
    expect(
      await service.getBadges('twitch', '42', { badges: true, communityBadges: enabled }),
    ).toHaveLength(2)
    expect(calls).toEqual(['https://twir.app/api/v1/public/badges'])
    expect(
      await service.getBadges('kick', '42', { badges: true, communityBadges: enabled }),
    ).toEqual([])
    expect(
      await service.getBadges('twitch', '42', { badges: false, communityBadges: enabled }),
    ).toEqual([])
    expect(calls).toHaveLength(1)
  })

  test('indexes a cached payload once and isolates a failed provider', async () => {
    const payload = twirPayload
    const service = createCommunityBadgeService(async (url) => {
      if (url.includes('chatterinohomies')) throw new Error('unavailable')
      if (url.includes('twir.app')) return payload
      return []
    })
    const preferences = communityPreferences(false)
    preferences.homies = true
    preferences.twir = true
    const first = await service.getBadges('twitch', '42', {
      badges: true,
      communityBadges: preferences,
    })
    const second = await service.getBadges('twitch', '42', {
      badges: true,
      communityBadges: preferences,
    })
    expect(first.map((badge) => badge.type)).toEqual(['twir', 'twir'])
    expect(second).toEqual(first)
    expect(second[0]).toBe(first[0])
  })

  test('persists independent source switches with backward-compatible enabled defaults', () => {
    const defaults = validateEmotePreferences({})
    expect(defaults.communityBadges).toEqual(DEFAULT_COMMUNITY_BADGE_PREFERENCES)
    const validated = validateEmotePreferences({
      communityBadges: { ffzap: false, homies: false, twir: false },
    })
    expect(validated.communityBadges).toEqual({
      ffzap: false,
      dankchat: true,
      chatsen: true,
      homies: false,
      twir: false,
    })
    expect(() => validateEmotePreferences({ communityBadges: { twir: 'yes' } })).toThrow()
  })
})
