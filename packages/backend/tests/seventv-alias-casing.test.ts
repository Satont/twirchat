import { describe, expect, it } from 'bun:test'
import type { Platform } from '@twirchat/shared'
import { SevenTVCache } from '../src/seventv/cache.ts'
import { createSevenTvEmote } from '../src/seventv/emote.ts'

describe('7TV alias casing', () => {
  it('preserves exact alias casing when building emitted emotes', () => {
    const uppercaseAlias = createSevenTvEmote({
      alias: 'WW',
      animated: false,
      aspectRatio: 1,
      id: 'emote-ww',
      imageUrl: 'https://cdn.7tv.app/emote/emote-ww/4x.webp',
      name: 'w',
      zeroWidth: false,
    })
    const lowercaseAlias = createSevenTvEmote({
      alias: 'vahui',
      animated: false,
      aspectRatio: 1,
      id: 'emote-vahui',
      imageUrl: 'https://cdn.7tv.app/emote/emote-vahui/4x.webp',
      name: 'vahui',
      zeroWidth: false,
    })

    expect(uppercaseAlias.alias).toBe('WW')
    expect(uppercaseAlias.name).toBe('w')
    expect(lowercaseAlias.alias).toBe('vahui')
    expect(lowercaseAlias.name).toBe('vahui')
  })

  it('keeps case-distinct aliases in the cache', () => {
    const cache = new SevenTVCache()
    const platform = 'kick' as Platform
    const channelId = 'channel-1'

    cache.set(platform, channelId, {
      channelId,
      emotes: new Map([
        [
          'WW',
          createSevenTvEmote({
            alias: 'WW',
            animated: false,
            aspectRatio: 1,
            id: 'emote-ww',
            imageUrl: 'https://cdn.7tv.app/emote/emote-ww/4x.webp',
            name: 'w',
            zeroWidth: false,
          }),
        ],
        [
          'vahui',
          createSevenTvEmote({
            alias: 'vahui',
            animated: false,
            aspectRatio: 1,
            id: 'emote-vahui',
            imageUrl: 'https://cdn.7tv.app/emote/emote-vahui/4x.webp',
            name: 'vahui',
            zeroWidth: false,
          }),
        ],
      ]),
      fetchedAt: 0,
      id: 'set-1',
      name: 'Fixture Set',
      platform,
      ttl: 5 * 60 * 1000,
    })

    const cached = cache.get(platform, channelId)

    expect(cached?.emotes.get('WW')?.alias).toBe('WW')
    expect(cached?.emotes.get('vahui')?.alias).toBe('vahui')
    expect(cached?.emotes.has('ww')).toBe(false)

    const added = cache.addEmote(
      platform,
      channelId,
      createSevenTvEmote({
        alias: 'ww',
        animated: false,
        aspectRatio: 1,
        id: 'emote-ww-lower',
        imageUrl: 'https://cdn.7tv.app/emote/emote-ww-lower/4x.webp',
        name: 'w',
        zeroWidth: false,
      }),
    )

    expect(added).toBe(true)

    const next = cache.get(platform, channelId)
    expect(next?.emotes.get('ww')?.alias).toBe('ww')
    expect(next?.emotes.size).toBe(3)
  })

  it('updates exact alias keys without adding lowercase variants', () => {
    const cache = new SevenTVCache()
    const platform = 'kick' as Platform
    const channelId = 'channel-1'

    cache.set(platform, channelId, {
      channelId,
      emotes: new Map([
        [
          'WW',
          createSevenTvEmote({
            alias: 'WW',
            animated: false,
            aspectRatio: 1,
            id: 'emote-ww',
            imageUrl: 'https://cdn.7tv.app/emote/emote-ww/4x.webp',
            name: 'w',
            zeroWidth: false,
          }),
        ],
        [
          'vahui',
          createSevenTvEmote({
            alias: 'vahui',
            animated: false,
            aspectRatio: 1,
            id: 'emote-vahui',
            imageUrl: 'https://cdn.7tv.app/emote/emote-vahui/4x.webp',
            name: 'vahui',
            zeroWidth: false,
          }),
        ],
      ]),
      fetchedAt: 0,
      id: 'set-1',
      name: 'Fixture Set',
      platform,
      ttl: 5 * 60 * 1000,
    })

    const updated = cache.updateEmote(platform, channelId, 'emote-ww', {
      alias: 'WwRenamed',
    })

    expect(updated).toBe(true)

    const next = cache.get(platform, channelId)
    expect(next?.emotes.has('WW')).toBe(false)
    expect(next?.emotes.get('WwRenamed')?.alias).toBe('WwRenamed')
    expect(next?.emotes.has('wwrenamed')).toBe(false)
    expect(next?.emotes.get('vahui')?.alias).toBe('vahui')
    expect(next?.emotes.size).toBe(2)
  })
})
