import { describe, expect, test } from 'bun:test'

import { createKickBadgeCatalog } from '../src/platforms/kick/badge-catalog'
import {
  kickBadgeIdentitySchema,
  normalizeKickBadges,
  type KickSubscriberBadge,
} from '../src/platforms/kick/badge-data'
import { getKickBadgeSvg } from '../src/platforms/kick/badges'

const flybyUrl =
  'https://ext.cdn.kick.com/chat/badges/Flyby_019f591a-e1bb-7a1a-be0a-97d8d1ae1a91.png'
const subscriberBadge12: KickSubscriberBadge = {
  months: 12,
  badge_image: { src: 'https://files.kick.com/subscriber-12.png' },
}
const subscriberBadges: KickSubscriberBadge[] = [
  subscriberBadge12,
  { months: 1, badge_image: { src: 'https://files.kick.com/subscriber-1.png' } },
  { months: 6, badge_image: { src: 'https://files.kick.com/subscriber-6.png' } },
]

describe('official Kick badges', () => {
  test('preserves broadcaster role art and merges selected official image badges in provider order', () => {
    const badges = normalizeKickBadges({
      badges: [{ type: 'broadcaster', text: 'Broadcaster', sort_order: 13 }],
      badges_v2: [
        { name: 'Flyby', badge_type: 'global', image_url: flybyUrl, selected: true, sort_order: 4 },
        {
          name: 'level',
          badge_type: 'global',
          image_url: flybyUrl,
          selected: false,
          sort_order: 1,
        },
      ],
    })
    expect(badges.map((badge) => badge.type)).toEqual(['Flyby', 'broadcaster'])
    expect(badges[0]?.imageUrl).toBe(flybyUrl)
    expect(badges[1]?.imageUrl).toBe('embedded:kick:broadcaster')
    expect(getKickBadgeSvg('broadcaster')).toContain('linearGradient')
  })

  test('hides inactive roles, bounds the visible set to four and keeps equal-rank provider order', () => {
    const badges = normalizeKickBadges({
      badges: [
        { type: 'hidden', text: 'Hidden', active: false, sort_order: 0 },
        { type: 'first', text: 'First', sort_order: 1 },
        { type: 'second', text: 'Second', sort_order: 1 },
        { type: 'third', text: 'Third', sort_order: 2 },
        { type: 'fourth', text: 'Fourth', sort_order: 3 },
        { type: 'fifth', text: 'Fifth' },
      ],
    })
    expect(badges.map((badge) => badge.type)).toEqual(['first', 'second', 'third', 'fourth'])
    expect(badges[0]?.text).toBe('First')
    expect(badges[0]?.imageUrl).toBeUndefined()
  })

  test('prefers an official image over a duplicate legacy role without adding duplicate badge keys', () => {
    const badges = normalizeKickBadges({
      badges: [{ type: 'verified', text: 'Verified' }],
      badges_v2: [
        { name: 'verified', badge_type: 'global', image_url: flybyUrl },
        { name: 'verified', badge_type: 'global', image_url: flybyUrl },
      ],
    })
    expect(badges).toEqual([
      { id: 'global:verified', type: 'verified', text: 'verified', imageUrl: flybyUrl },
    ])
  })

  test('uses compact registry references and the official gift-count tiers', () => {
    for (const type of [
      'broadcaster',
      'moderator',
      'og',
      'founder',
      'sidekick',
      'staff',
      'subscriber',
      'vip',
      'bot',
      'verified',
      'chat_identity',
      'trainwreckstv',
    ]) {
      const badges = normalizeKickBadges({ badges: [{ type, text: type }] })
      expect(badges[0]?.imageUrl).toBe(`embedded:kick:${type}`)
      expect(getKickBadgeSvg(type)).toStartWith('<svg')
    }
    expect(getKickBadgeSvg('subgifter:9')).toBe(getKickBadgeSvg('sub_gifter', 5))
    expect(getKickBadgeSvg('subgifter:5001')).toBe(getKickBadgeSvg('sub_gifter', 5000))
    expect(
      normalizeKickBadges({ badges: [{ type: 'subgifter', text: 'Sub Gifter', count: 5 }] })[0]
        ?.imageUrl,
    ).toBe('embedded:kick:subgifter:5')
  })

  test('selects the highest earned custom subscriber tier, including gaps and the default month', () => {
    const tiers: Array<[number, string]> = [
      [1, 'subscriber-1.png'],
      [5, 'subscriber-1.png'],
      [6, 'subscriber-6.png'],
      [11, 'subscriber-6.png'],
      [12, 'subscriber-12.png'],
      [120, 'subscriber-12.png'],
    ]
    for (const [count, expected] of tiers) {
      const badges = normalizeKickBadges(
        { badges: [{ type: 'subscriber', text: 'Subscriber', count }] },
        subscriberBadges,
      )
      expect(badges[0]?.imageUrl).toEndWith(expected)
    }
    expect(
      normalizeKickBadges(
        { badges: [{ type: 'subscriber', text: 'Subscriber' }] },
        subscriberBadges,
      )[0]?.imageUrl,
    ).toEndWith('subscriber-1.png')
  })

  test('discards malformed badge entries without rejecting valid text-message identity', () => {
    const identity = kickBadgeIdentitySchema.parse({
      color: '#53fc18',
      badges: [{ type: 'broadcaster', text: 'Broadcaster' }, { type: 123 }],
      badges_v2: [
        { name: 'Flyby', badge_type: 'global', image_url: flybyUrl, selected: true },
        { name: 'bad', badge_type: 'global', image_url: 'javascript:alert(1)' },
        { name: 'bad', badge_type: 'global', image_url: 'http://plain.invalid/image.png' },
        null,
      ],
    })
    expect(normalizeKickBadges(identity).map((badge) => badge.type)).toEqual([
      'broadcaster',
      'Flyby',
    ])
    expect(kickBadgeIdentitySchema.parse({ color: '' }).badges).toEqual([])
  })
})

describe('Kick subscriber badge catalogs', () => {
  test('coalesces channel casing and in-flight requests, then retains successful catalogs', async () => {
    let requests = 0
    const gate = Promise.withResolvers<Response>()
    const catalog = createKickBadgeCatalog({
      fetchFn: async (input, init) => {
        requests++
        expect(String(input)).toEndWith('/channels/satont')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return gate.promise
      },
    })
    const first = catalog.load(' #Satont ')
    expect(catalog.load('satont')).toBe(first)
    gate.resolve(Response.json({ subscriber_badges: subscriberBadges }))
    expect(await first).toEqual(subscriberBadges)
    expect(await catalog.load('SATONT')).toEqual(subscriberBadges)
    expect(requests).toBe(1)
  })

  test('keeps chat usable on catalog failure, negatively caches it and retries after expiry', async () => {
    let time = 0,
      requests = 0
    const catalog = createKickBadgeCatalog({
      now: () => time,
      fetchFn: async () => {
        requests++
        return requests === 1
          ? new Response('Unavailable', { status: 503 })
          : Response.json({ subscriber_badges: subscriberBadges })
      },
    })
    expect(await catalog.load('satont')).toEqual([])
    expect(await catalog.load('satont')).toEqual([])
    expect(requests).toBe(1)
    time = 5 * 60_000
    expect(await catalog.load('satont')).toEqual(subscriberBadges)
    expect(requests).toBe(2)
  })

  test('filters malformed custom image tiers and limits concurrent public lookups', async () => {
    const gates: Array<PromiseWithResolvers<Response>> = []
    const catalog = createKickBadgeCatalog({
      fetchFn: async () => {
        const gate = Promise.withResolvers<Response>()
        gates.push(gate)
        return gate.promise
      },
    })
    const requests = Array.from({ length: 8 }, (_, index) => catalog.load(`channel-${index}`))
    expect(await catalog.load('excess')).toEqual([])
    expect(gates).toHaveLength(8)
    for (const gate of gates)
      gate.resolve(
        Response.json({
          subscriber_badges: [
            subscriberBadge12,
            { months: 0, badge_image: { src: flybyUrl } },
            { months: 1, badge_image: { src: 'file:///tmp/image.png' } },
          ],
        }),
      )
    for (const badges of await Promise.all(requests)) expect(badges).toEqual([subscriberBadge12])
  })
})
