import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  getEmotesInMessage,
  hasEmotes,
  parseMessageWithEmotes,
} from '@desktop/platforms/7tv/emote-parser'
import { sevenTVService } from '@desktop/seventv'
import type { SevenTVEmote } from '@twirchat/shared'

const channelId = 'case-sensitive-emote-parser'
const originalSend = sevenTVService.sendToBackend

beforeEach(() => {
  sevenTVService.sendToBackend = () => {}
})

afterEach(async () => {
  await sevenTVService.unsubscribeFromChannel('twitch', channelId)
  sevenTVService.sendToBackend = originalSend
})

test('parses only exact aliases and leaves unmatched casing as text', () => {
  const upper: SevenTVEmote = {
    id: 'upper',
    alias: 'Pog',
    name: 'OriginalUpper',
    animated: false,
    zeroWidth: false,
    aspectRatio: 1,
    imageUrl: 'https://cdn.7tv.app/emote/upper/4x.webp',
  }
  const lower: SevenTVEmote = { ...upper, id: 'lower', alias: 'pog', name: 'OriginalLower' }
  sevenTVService.handleEmoteSet('twitch', channelId, [upper, lower])

  const parsed = parseMessageWithEmotes('Pog pog POG', 'twitch', channelId)

  expect(parsed.text).toBe('Pog pog POG')
  expect(parsed.emotes).toMatchObject([
    { id: 'upper', name: 'OriginalUpper', start: 0, end: 2 },
    { id: 'lower', name: 'OriginalLower', start: 4, end: 6 },
  ])
  expect(parsed.parts).toMatchObject([
    { type: 'emote', emote: { id: 'upper' } },
    { type: 'text', content: ' ' },
    { type: 'emote', emote: { id: 'lower' } },
    { type: 'text', content: ' ' },
    { type: 'text', content: 'POG' },
  ])
  expect(getEmotesInMessage('Pog pog POG', 'twitch', channelId)).toEqual(parsed.emotes)
  expect(hasEmotes('Pog', 'twitch', channelId)).toBe(true)
  expect(hasEmotes('pog', 'twitch', channelId)).toBe(true)
  expect(hasEmotes('POG OriginalUpper', 'twitch', channelId)).toBe(false)
})
