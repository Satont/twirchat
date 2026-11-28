import { describe, expect, it } from 'bun:test'

import {
  createSevenTvEmote,
  createSevenTvEmoteFromEventValue,
  isSevenTvEventEmoteUpdate,
  updateSetEmote,
} from '../src/seventv/emote.ts'
import type { SevenTVEventEmoteUpdate } from '../src/seventv/event-client.ts'

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

  it('preserves exact alias casing when mapping event payload emotes', () => {
    const uppercaseAlias = createSevenTvEmoteFromEventValue({
      id: 'emote-ww',
      name: 'WW',
      data: {
        animated: false,
        host: {
          files: [{ name: '4x.webp', url: '/4x.webp' }],
          url: '//cdn.7tv.app/emote/emote-ww',
        },
      },
    })
    const lowercaseAlias = createSevenTvEmoteFromEventValue({
      id: 'emote-vahui',
      name: 'vahui',
      data: {
        animated: false,
        host: {
          files: [{ name: '4x.webp', url: '/4x.webp' }],
          url: '//cdn.7tv.app/emote/emote-vahui',
        },
      },
    })

    expect(uppercaseAlias.alias).toBe('WW')
    expect(uppercaseAlias.name).toBe('WW')
    expect(lowercaseAlias.alias).toBe('vahui')
    expect(lowercaseAlias.name).toBe('vahui')
  })

  it('accepts realistic event update payloads without changing alias case', () => {
    const update = {
      index: 0,
      key: 'emotes',
      old_value: {
        data: {
          animated: false,
          host: {
            files: [{ name: '4x.webp', url: '/4x.webp' }],
            url: '//cdn.7tv.app/emote/emote-ww',
          },
        },
        id: 'emote-ww',
        name: 'ww',
      },
      type: 'emote',
      value: {
        data: {
          animated: false,
          host: {
            files: [{ name: '4x.webp', url: '/4x.webp' }],
            url: '//cdn.7tv.app/emote/emote-ww',
          },
        },
        id: 'emote-ww',
        name: 'WW',
      },
    } satisfies SevenTVEventEmoteUpdate

    expect(isSevenTvEventEmoteUpdate(update)).toBe(true)

    const emote = createSevenTvEmoteFromEventValue(update.value)
    expect(emote.alias).toBe('WW')
    expect(emote.name).toBe('WW')
  })

  it('updates only the matching emote and preserves case-distinct aliases', () => {
    const uppercase = createSevenTvEmote({
      alias: 'WW',
      animated: false,
      aspectRatio: 1,
      id: 'emote-ww-upper',
      imageUrl: 'https://cdn.7tv.app/emote/emote-ww-upper/4x.webp',
      name: 'w',
      zeroWidth: false,
    })
    const lowercase = { ...uppercase, alias: 'ww', id: 'emote-ww-lower' }
    const emotes = new Map([
      [uppercase.alias, uppercase],
      [lowercase.alias, lowercase],
    ])

    const renamed = updateSetEmote(emotes, uppercase.id, { alias: 'WwRenamed' })

    expect(renamed).toEqual({ ...uppercase, alias: 'WwRenamed' })
    expect(emotes.has('WW')).toBe(false)
    expect(emotes.get('WwRenamed')).toBe(renamed)
    expect(emotes.has('wwrenamed')).toBe(false)
    expect(emotes.get('ww')).toBe(lowercase)
    expect(emotes.size).toBe(2)
  })
})
