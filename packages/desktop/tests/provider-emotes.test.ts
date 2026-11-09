import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import sharp from 'sharp'

import { buildMessageTokens } from '../src/gpuix/message-tokens'
import {
  emotePreferencesStore,
  favoriteEmoteKey,
  loadEmotePreferences,
  saveEmotePreferences,
  toggleFavoriteEmote,
  validateEmotePreferences,
} from '../src/gpuix/state/emote-preferences'
import { getDbPath, setRuntimeConfig } from '../src/runtime-config'
import {
  createCosmeticsService,
  paintNameSvg,
  parseCosmetics,
  type CosmeticPaint,
} from '../src/services/cosmetics'
import { emojiShortcodeSuggestions } from '../src/services/emoji-shortcodes'
import { modifiedEmoteImage } from '../src/services/emote-image'
import {
  createEmoteProviderService,
  DEFAULT_EMOTE_PREFERENCES,
  enrichProviderEmotes,
  mergeProviderEmotes,
  parseBttvEmotes,
  parseFfzEmotes,
  parseSevenTvEmotes,
} from '../src/services/emote-providers'
import { createPaintRenderer } from '../src/services/paint-renderer'
import { replaceToken } from '../src/views/main/utils/autocompleteUtils'
import { required } from './fixture-values'

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const entry = (
  alias: string,
  provider: 'bttv' | 'ffz' | 'seventv' | 'twitch' = 'bttv',
  extra: Partial<EmoteCatalogEntry> = {},
): EmoteCatalogEntry => ({
  id: alias,
  alias,
  name: alias,
  imageUrl: `https://example.com/${alias}.png`,
  provider,
  source: provider === 'twitch' ? 'channel' : provider,
  animated: false,
  zeroWidth: false,
  aspectRatio: 1,
  ...extra,
})
const message = (text: string): NormalizedChatMessage => ({
  id: '1',
  platform: 'twitch',
  channelId: 'satont',
  author: { id: '2', displayName: 'Viewer', badges: [] },
  text,
  emotes: [],
  type: 'message',
  timestamp: new Date(),
})
const prefs = () => structuredClone(DEFAULT_EMOTE_PREFERENCES)

describe('real provider response formats', () => {
  test('parses BTTV globals/channel sharing, dimensions, animation, overlays and modifier flags', () => {
    const list = parseBttvEmotes({
      channelEmotes: [{ id: '1', code: 'Wide', width: 84, height: 28, imageType: 'gif' }],
      sharedEmotes: [
        { id: '2', code: 'SantaHat' },
        { id: '3', code: 'h!', modifier: true },
      ],
    })
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({
      alias: 'Wide',
      aspectRatio: 3,
      animated: true,
      provider: 'bttv',
      source: 'bttv',
    })
    expect(list[1]?.zeroWidth).toBe(true)
    expect(list[2]?.modifier).toBe(true)
    expect(parseBttvEmotes([{ id: '4', code: 'Global' }], true)[0]?.source).toBe('global')
  })

  test('loads only FFZ default global sets and prefers animated HTTPS assets', () => {
    const result = parseFfzEmotes(
      {
        default_sets: [1],
        sets: {
          '1': {
            id: 1,
            emoticons: [
              {
                id: 10,
                name: 'Dance',
                width: 40,
                height: 20,
                urls: { '1': '//cdn.frankerfacez.com/static/10/1' },
                animated: { '4': '//cdn.frankerfacez.com/animated/10/4' },
              },
            ],
          },
          '2': {
            id: 2,
            emoticons: [{ id: 20, name: 'NotGlobal', urls: { '1': '//example.com/20' } }],
          },
        },
      },
      true,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      alias: 'Dance',
      imageUrl: 'https://cdn.frankerfacez.com/animated/10/4',
      animated: true,
      aspectRatio: 2,
      provider: 'ffz',
    })
  })

  test('retains case-sensitive 7TV aliases, zero-width flags and actual host image sizes', () => {
    const result = parseSevenTvEmotes(
      {
        emotes: [
          {
            id: 'abc',
            name: 'Alias',
            flags: 1,
            data: {
              name: 'Original',
              animated: true,
              host: {
                url: '//cdn.7tv.app/emote/abc',
                files: [{ name: '2x.webp', width: 96, height: 64 }],
              },
            },
          },
        ],
      },
      'personal',
    )
    expect(result[0]).toMatchObject({
      alias: 'Alias',
      name: 'Original',
      zeroWidth: true,
      animated: true,
      aspectRatio: 1.5,
      source: 'personal',
      imageUrl: 'https://cdn.7tv.app/emote/abc/2x.webp',
    })
    expect(parseSevenTvEmotes({ emotes: [{ id: 'broken' }] })).toEqual([])
  })

  test('respects provider priority, enabled flags, channel-over-global collisions and exact alias case', () => {
    const settings = prefs()
    const catalogs = [
      [
        entry('Pog', 'bttv', { source: 'global' }),
        entry('Pog', 'bttv', { id: 'channel' }),
        entry('pog', 'ffz'),
      ],
      [entry('Pog', 'seventv')],
    ]
    expect(mergeProviderEmotes(catalogs, settings).find((e) => e.alias === 'Pog')?.provider).toBe(
      'seventv',
    )
    settings.precedence = ['bttv', 'ffz', 'seventv', 'twitch']
    expect(mergeProviderEmotes(catalogs, settings).find((e) => e.alias === 'Pog')?.id).toBe(
      'channel',
    )
    expect(mergeProviderEmotes(catalogs, settings).map((e) => e.alias)).toEqual(['Pog', 'pog'])
    settings.enabled.bttv = false
    expect(mergeProviderEmotes(catalogs, settings).find((e) => e.alias === 'Pog')?.provider).toBe(
      'seventv',
    )
  })

  test('can disable zero-width and modifier behavior independently', () => {
    const settings = prefs()
    settings.zeroWidth = false
    settings.modifiers = false
    const result = mergeProviderEmotes(
      [[entry('Hat', 'seventv', { zeroWidth: true }), entry('h!', 'bttv', { modifier: true })]],
      settings,
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.zeroWidth).toBe(false)
  })
})

describe('provider fetching and badges', () => {
  test('limits concurrent provider downloads while many channel catalogs load', async () => {
    let active = 0,
      maximum = 0
    const settings = prefs()
    settings.enabled.seventv = false
    const service = createEmoteProviderService(async () => {
      active++
      maximum = Math.max(maximum, active)
      await Bun.sleep(2)
      active--
      return json({})
    })
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.getProviderEmotes('twitch', `channel${index}`, {
          twitchUserId: String(index),
          preferences: settings,
        }),
      ),
    )
    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(6)
  })
  test('coalesces requests and caches globals across channels with real endpoint routing', async () => {
    const urls: string[] = []
    const settings = prefs()
    settings.enabled.seventv = false
    settings.enabled.ffz = false
    const service = createEmoteProviderService(async (url) => {
      urls.push(url)
      await Bun.sleep(1)
      return url.endsWith('/global')
        ? json([{ id: 'global', code: 'Global' }])
        : json({ channelEmotes: [{ id: 'channel', code: 'Local' }], sharedEmotes: [] })
    })
    const [first, second] = await Promise.all([
      service.getProviderEmotes('twitch', 'satont', { twitchUserId: '42', preferences: settings }),
      service.getProviderEmotes('twitch', 'satont', { twitchUserId: '42', preferences: settings }),
    ])
    expect(first.map((e) => e.alias)).toEqual(['Local', 'Global'])
    expect(second).toEqual(first)
    expect(urls.filter((url) => url.endsWith('/global'))).toHaveLength(1)
    expect(urls).toContain('https://api.betterttv.net/3/cached/users/twitch/42')
    await service.getProviderEmotes('twitch', 'other', {
      twitchUserId: '99',
      preferences: settings,
    })
    expect(urls.filter((url) => url.endsWith('/global'))).toHaveLength(1)
  })

  test('one failing provider does not remove other catalogs or trigger immediate retry storms', async () => {
    const calls: string[] = []
    const settings = prefs()
    settings.enabled.seventv = false
    const service = createEmoteProviderService(async (url) => {
      calls.push(url)
      if (url.includes('betterttv')) return new Response('unavailable', { status: 503 })
      return json({
        default_sets: [1],
        sets: {
          '1': {
            id: 1,
            emoticons: [
              { id: 1, name: 'Working', urls: { '1': '//cdn.frankerfacez.com/emote/1' } },
            ],
          },
        },
      })
    })
    const first = await service.getProviderEmotes('kick', 'channel', { preferences: settings })
    expect(first[0]?.alias).toBe('Working')
    await service.getProviderEmotes('kick', 'channel', { preferences: settings })
    expect(calls.filter((url) => url.includes('betterttv'))).toHaveLength(1)
    expect(service.errors()[0]?.error).toContain('503')
  })

  test('fetches 7TV personal sets through actual user set flags', async () => {
    const calls: string[] = []
    const service = createEmoteProviderService(async (url) => {
      calls.push(url)
      return url.includes('/users/')
        ? json({
            user: {
              emote_sets: [
                { id: 'channel', flags: 0 },
                { id: 'personal', flags: 4 },
              ],
            },
          })
        : json({
            emotes: [
              {
                id: 'e',
                name: 'Mine',
                data: {
                  host: {
                    url: '//cdn.7tv.app/emote/e',
                    files: [{ name: '2x.webp', width: 28, height: 28 }],
                  },
                },
              },
            ],
          })
    })
    const result = await service.getPersonalEmotes('twitch', '42')
    expect(calls).toEqual([
      'https://7tv.io/v3/users/twitch/42',
      'https://7tv.io/v3/emote-sets/personal',
    ])
    expect(result[0]).toMatchObject({ alias: 'Mine', source: 'personal' })
  })

  test('maps global BTTV/FFZ badge assignments and channel authority/user badges', async () => {
    const service = createEmoteProviderService(async (url) => {
      if (url.includes('betterttv'))
        return json([
          {
            providerId: '42',
            badge: {
              type: 1,
              description: 'Developer',
              svg: 'https://cdn.betterttv.net/badges/developer.svg',
            },
          },
        ])
      if (url.includes('/room/'))
        return json({
          room: {
            mod_urls: { '2': '//cdn.frankerfacez.com/mod.png' },
            vip_badge: { '4': '//cdn.frankerfacez.com/vip.png' },
            user_badge_ids: { '3': ['42'] },
          },
        })
      return json({
        badges: [
          { id: 3, title: 'Supporter', urls: { '4': 'https://cdn.frankerfacez.com/badge/3/4' } },
        ],
        users: { '3': ['42'] },
      })
    })
    expect((await service.getProviderBadges('twitch', '42')).map((badge) => badge.type)).toEqual([
      'bttv',
      'ffz',
    ])
    const channel = await service.getChannelProviderBadges('satont')
    expect(channel.moderator?.imageUrl).toBe('https://cdn.frankerfacez.com/mod.png')
    expect(channel.vip?.type).toBe('vip')
    expect(channel.users['42']?.[0]?.text).toBe('Supporter')
  })
})

describe('native emote message rendering', () => {
  test('enriches exact aliases with UTF-16 offsets and preserves existing platform emotes', () => {
    const original = message('😀 Pog pog Pog')
    original.emotes = [
      {
        id: 'native',
        name: 'pog',
        imageUrl: 'https://example.com/native.png',
        provider: 'twitch',
        positions: [{ start: 7, end: 9 }],
      },
    ]
    const result = enrichProviderEmotes(original, [entry('Pog')])
    expect(result.emotes.find((e) => e.id === 'Pog')?.positions).toEqual([
      { start: 3, end: 5 },
      { start: 11, end: 13 },
    ])
    expect(result.emotes[0]?.id).toBe('native')
  })

  test('groups zero-width emotes into a single native layout box in paint order', () => {
    const original = enrichProviderEmotes(message('Base Hat Sparkle hello'), [
      entry('Base'),
      entry('Hat', 'seventv', { zeroWidth: true }),
      entry('Sparkle', 'seventv', { zeroWidth: true }),
    ])
    const tokens = buildMessageTokens(original)
    const emotes = tokens.filter((token) => token.kind === 'emote')
    expect(emotes).toHaveLength(1)
    expect(emotes[0]?.overlays?.map((emote) => emote.name)).toEqual(['Hat', 'Sparkle'])
    expect(
      tokens
        .filter((token) => token.kind === 'text')
        .map((token) => token.text)
        .join(''),
    ).toBe('hello')
    expect(
      buildMessageTokens(original, { zeroWidth: false }).filter((token) => token.kind === 'emote'),
    ).toHaveLength(3)
  })

  test('supports BTTV prefix/FFZ suffix modifiers without hiding orphan words', () => {
    const original = enrichProviderEmotes(message('w! h! Base ffzY'), [entry('Base')])
    const token = buildMessageTokens(original).find((item) => item.kind === 'emote')
    expect(token?.kind === 'emote' && token.modifiers).toEqual([
      'wide',
      'flip-horizontal',
      'flip-vertical',
    ])
    expect(
      buildMessageTokens(message('h! hello'))
        .filter((item) => item.kind === 'text')
        .map((item) => item.text)
        .join(''),
    ).toBe('h! hello')
    expect(
      buildMessageTokens(original, { modifiers: false })
        .filter((item) => item.kind === 'text')
        .map((item) => item.text)
        .join(''),
    ).toContain('w!')
  })

  test('keeps every animated base frame, source timing and loop count after modifiers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'twir-animated-modifier-'))
    const previousPath = getDbPath()
    setRuntimeConfig({ dbPath: join(directory, 'db.sqlite') })
    try {
      const source = join(directory, 'source.webp')
      await Bun.write(
        source,
        await sharp(
          Buffer.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 0, 255]),
          { raw: { width: 2, height: 2, pageHeight: 1, channels: 4 } },
        )
          .webp({ lossless: true, delay: [80, 120], loop: 3 })
          .toBuffer(),
      )
      const [path, repeated] = await Promise.all([
        modifiedEmoteImage(source, 2, 1, ['flip-horizontal']),
        modifiedEmoteImage(source, 2, 1, ['flip-horizontal']),
      ])
      expect(path).toBe(repeated)
      const meta = await sharp(path, { animated: true }).metadata()
      expect(meta.pages).toBe(2)
      expect(meta.delay).toEqual([80, 120])
      expect(meta.loop).toBe(3)
      const pixels = await sharp(path, { animated: true }).ensureAlpha().raw().toBuffer()
      expect([...pixels]).toEqual([
        0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255,
      ])
      const party = await modifiedEmoteImage(source, 2, 1, ['party'])
      expect((await sharp(party, { animated: true }).metadata()).pages).toBeGreaterThan(2)
      const solid = join(directory, 'solid.png')
      await Bun.write(
        solid,
        await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff0000' } })
          .png()
          .toBuffer(),
      )
      const shake = await modifiedEmoteImage(solid, 8, 8, ['shake'])
      expect((await sharp(shake, { animated: true }).metadata()).pages).toBeGreaterThan(1)
    } finally {
      setRuntimeConfig({ dbPath: previousPath })
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('rasterizes a horizontal image modifier with the actual pixels flipped', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'twir-emote-modifier-'))
    const previousPath = getDbPath()
    setRuntimeConfig({ dbPath: join(directory, 'db.sqlite') })
    try {
      const source = join(directory, 'source.png')
      await Bun.write(
        source,
        await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
          raw: { width: 2, height: 1, channels: 4 },
        })
          .png()
          .toBuffer(),
      )
      const path = await modifiedEmoteImage(source, 2, 1, ['flip-horizontal'])
      const pixels = await sharp(Buffer.from(await Bun.file(path).arrayBuffer()))
        .ensureAlpha()
        .raw()
        .toBuffer()
      expect(Array.from(pixels.slice(0, 4))).toEqual([0, 0, 255, 255])
      expect(Array.from(pixels.slice(4, 8))).toEqual([255, 0, 0, 255])
    } finally {
      setRuntimeConfig({ dbPath: previousPath })
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

const cosmeticResponse = () => ({
  data: {
    users: {
      userByConnection: {
        id: '7tv-user',
        personalEmoteSet: { id: 'personal' },
        style: {
          activeBadge: {
            id: 'badge',
            name: 'Supporter',
            images: [{ url: 'https://cdn.7tv.app/badge/id/2x.webp', scale: 2 }],
          },
          activePaint: {
            id: 'paint',
            name: 'Gradient',
            data: {
              layers: [
                {
                  opacity: 1,
                  ty: {
                    __typename: 'PaintLayerTypeLinearGradient',
                    angle: 90,
                    repeating: false,
                    stops: [
                      { at: 0, color: { hex: '#ff0000' } },
                      { at: 1, color: { hex: '#0000ff' } },
                    ],
                  },
                },
              ],
              shadows: [],
            },
          },
        },
      },
    },
  },
})

describe('7TV cosmetics', () => {
  test('bounds simultaneous user lookups during a burst of new chatters', async () => {
    let active = 0,
      maximum = 0
    const service = createCosmeticsService(
      async () => {
        active++
        maximum = Math.max(maximum, active)
        await Bun.sleep(2)
        active--
        return json(cosmeticResponse())
      },
      async () => [],
    )
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => service.getUserCosmetics('twitch', String(index))),
    )
    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(4)
  })
  test('keeps image-paint animation frames, timing, looping and cached output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'twir-animated-paint-'))
    try {
      const first = Buffer.alloc(16 * 16 * 4),
        second = Buffer.alloc(16 * 16 * 4)
      for (let index = 0; index < first.length; index += 4) {
        first.set([255, 0, 0, 255], index)
        second.set([0, 0, 255, 255], index)
      }
      const animation = await sharp(Buffer.concat([first, second]), {
        raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
      })
        .webp({ lossless: true, delay: [80, 120], loop: 3 })
        .toBuffer()
      let fetches = 0
      const renderer = createPaintRenderer({
        directory: () => directory,
        fetch: async () => {
          fetches++
          return new Response(animation)
        },
      })
      const paint: CosmeticPaint = {
        id: 'animated',
        name: 'Animated Paint',
        layers: [
          { type: 'image', imageUrl: 'https://cdn.7tv.app/paint/animated/1x.webp', opacity: 1 },
        ],
        shadows: [],
      }
      const [output, repeated] = await Promise.all([
        renderer.render('Paint', paint, 18, 'Inter', paintNameSvg),
        renderer.render('Paint', paint, 18, 'Inter', paintNameSvg),
      ])
      expect(output).toEqual(repeated)
      const metadata = await sharp(output.path, { animated: true }).metadata()
      expect(metadata.pages).toBe(2)
      expect(metadata.delay).toEqual([80, 120])
      expect(metadata.loop).toBe(3)
      const pixels = await sharp(output.path, { animated: true }).ensureAlpha().raw().toBuffer()
      const frameSize = output.width * output.height * 4
      const sample = required(
        Array.from({ length: frameSize / 4 }, (_, index) => index * 4).find(
          (index) => required(pixels[index + 3]) > 200,
        ),
      )
      expect(required(pixels[sample])).toBeGreaterThan(required(pixels[sample + 2]))
      expect(required(pixels[sample + frameSize + 2])).toBeGreaterThan(
        required(pixels[sample + frameSize]),
      )
      await renderer.render('Paint', paint, 18, 'Inter', paintNameSvg)
      expect(fetches).toBe(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('chooses animated 7TV paint assets over static thumbnails', () => {
    const value = cosmeticResponse()
    const layer = required(value.data.users.userByConnection.style.activePaint.data.layers[0])
    const response = {
      data: {
        users: {
          userByConnection: {
            id: 'user',
            style: {
              activePaint: {
                id: 'paint',
                name: 'Animated',
                data: {
                  layers: [
                    {
                      opacity: layer.opacity,
                      ty: {
                        __typename: 'PaintLayerTypeImage',
                        images: [
                          { url: 'https://cdn.7tv.app/paint/p/1x_static.webp', frameCount: 1 },
                          { url: 'https://cdn.7tv.app/paint/p/1x.webp', frameCount: 30 },
                        ],
                      },
                    },
                  ],
                  shadows: [],
                },
              },
            },
          },
        },
      },
    }
    expect(parseCosmetics(response).paint?.layers[0]).toMatchObject({
      type: 'image',
      imageUrl: 'https://cdn.7tv.app/paint/p/1x.webp',
    })
  })
  test('parses actual union paint data, badges and personal-set IDs', () => {
    const result = parseCosmetics(cosmeticResponse())
    expect(result).toMatchObject({
      sevenTvUserId: '7tv-user',
      personalEmoteSetId: 'personal',
      lookupStatus: 'available',
      badges: [{ type: 'seventv' }],
    })
    expect(result.paint?.layers[0]?.type).toBe('linear')
  })

  test('normalizes descending gradient positions without changing paint stop order', () => {
    const response = cosmeticResponse()
    const layer = required(response.data.users.userByConnection.style.activePaint.data.layers[0])
    layer.ty.stops.splice(
      1,
      0,
      { at: 0.6, color: { hex: '#00ff00' } },
      {
        at: 0.4,
        color: { hex: '#ffffff' },
      },
    )
    expect(parseCosmetics(response).paint?.layers[0]).toMatchObject({
      stops: [
        { at: 0, color: '#ff0000' },
        { at: 0.6, color: '#00ff00' },
        { at: 0.6, color: '#ffffff' },
        { at: 1, color: '#0000ff' },
      ],
    })
  })

  test('coalesces user lookups, caches metadata and sends the correct platform identity', async () => {
    let calls = 0
    const service = createCosmeticsService(
      async (_url, init) => {
        calls++
        expect(JSON.parse(String(init?.body)).variables).toEqual({
          platform: 'TWITCH',
          platformId: '42',
        })
        await Bun.sleep(1)
        return json(cosmeticResponse())
      },
      async () => [],
    )
    const results = await Promise.all([
      service.getUserCosmetics('twitch', '42'),
      service.getUserCosmetics('twitch', '42'),
    ])
    expect(calls).toBe(1)
    expect(results[0]).toEqual(results[1])
    await service.getUserCosmetics('twitch', '42')
    expect(calls).toBe(1)
  })

  test('honors badge and paint preferences in the resolver and cache key', async () => {
    let badgeCalls = 0
    const service = createCosmeticsService(
      async () => json(cosmeticResponse()),
      async () => {
        badgeCalls++
        return [{ id: 'twir:contributor', type: 'twir', text: 'Twir Contributor' }]
      },
    )
    const communityBadges = prefs().communityBadges
    const disabled = await service.getUserCosmetics('twitch', '42', undefined, {
      badges: false,
      paints: false,
      communityBadges,
    })
    expect(disabled.badges).toEqual([])
    expect(disabled.paint).toBeUndefined()
    expect(badgeCalls).toBe(0)

    const badgesOnly = await service.getUserCosmetics('twitch', '42', undefined, {
      badges: true,
      paints: false,
      communityBadges,
    })
    expect(badgesOnly.badges.map((badge) => badge.type)).toEqual(['seventv', 'twir'])
    expect(badgesOnly.paint).toBeUndefined()
    expect(badgeCalls).toBe(1)

    const paintsOnly = await service.getUserCosmetics('twitch', '42', undefined, {
      badges: false,
      paints: true,
      communityBadges,
    })
    expect(paintsOnly.badges).toEqual([])
    expect(paintsOnly.paint?.name).toBe('Gradient')
    expect(badgeCalls).toBe(1)
  })

  test('keeps other provider badges when the 7TV endpoint is unavailable', async () => {
    const service = createCosmeticsService(
      async () => new Response('down', { status: 503 }),
      async () => [{ id: 'bttv', type: 'bttv', text: 'Developer' }],
    )
    expect(await service.getUserCosmetics('twitch', '42')).toMatchObject({
      lookupStatus: 'unavailable',
      badges: [{ type: 'bttv' }],
    })
  })

  test('renders paint gradients through glyph masks with nonempty, differently colored pixels', async () => {
    const paint = required(parseCosmetics(cosmeticResponse()).paint)
    const output = paintNameSvg('MMMM', paint, 30, 'sans-serif')
    const pixels = await sharp(Buffer.from(output.svg)).ensureAlpha().raw().toBuffer()
    let red = false,
      blue = false
    for (let index = 0; index < pixels.length; index += 4) {
      if (required(pixels[index + 3]) < 200) continue
      if (required(pixels[index]) > required(pixels[index + 2])) red = true
      if (required(pixels[index + 2]) > required(pixels[index])) blue = true
    }
    expect(red).toBe(true)
    expect(blue).toBe(true)
  })
})

describe('favorites and emoji completion', () => {
  test('validates favorites, unique provider precedence, and caps persisted data', () => {
    expect(validateEmotePreferences({}).sendPresence).toBe(false)
    expect(() =>
      validateEmotePreferences({ precedence: ['twitch', 'twitch', 'bttv', 'ffz'] }),
    ).toThrow()
    expect(() => validateEmotePreferences({ favorites: [entry('Pog'), entry('Pog')] })).toThrow()
    expect(() =>
      validateEmotePreferences({
        favorites: [entry('Bad', 'bttv', { imageUrl: 'file:///etc/passwd' })],
      }),
    ).toThrow()
    expect(favoriteEmoteKey(entry('Pog', 'bttv'))).not.toBe(favoriteEmoteKey(entry('Pog', 'ffz')))
  })

  test('persists favorite add/remove operations through the UI-state facade', async () => {
    const previous = emotePreferencesStore.get()
    const writes: string[] = []
    const api = {
      getUiState: async () => null,
      setUiState: async ({ value }: { value: string }) => {
        writes.push(value)
      },
    }
    try {
      emotePreferencesStore.set({
        value: prefs(),
        loaded: true,
        loading: false,
        saving: false,
        error: null,
      })
      await loadEmotePreferences(api)
      await toggleFavoriteEmote(api, entry('Pog'))
      expect(JSON.parse(required(writes[0])).favorites[0].alias).toBe('Pog')
      await toggleFavoriteEmote(api, entry('Pog'))
      expect(JSON.parse(required(writes[1])).favorites).toEqual([])
      await saveEmotePreferences(api, { ...prefs(), zeroWidth: false })
      expect(emotePreferencesStore.get().value.zeroWidth).toBe(false)
    } finally {
      emotePreferencesStore.set(previous)
    }
  })

  test('completes real Unicode emoji aliases and inserts the emoji instead of its shortcode', () => {
    expect(emojiShortcodeSuggestions.length).toBeGreaterThan(1500)
    const smile = required(
      emojiShortcodeSuggestions.find((suggestion) => suggestion.label === ':smile:'),
    )
    expect(replaceToken('Hello :smi', smile)).toBe('Hello 😄 ')
    const flag = required(
      emojiShortcodeSuggestions.find((suggestion) => suggestion.label === ':ru:'),
    )
    expect(replaceToken(':ru', flag)).toBe('🇷🇺 ')
  })
})
