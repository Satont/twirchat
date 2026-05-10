import { describe, expect, test } from 'bun:test'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { buildMessageParts } from '../src/views/shared/utils/messageParts'

function makeMessage(overrides: Partial<NormalizedChatMessage>): NormalizedChatMessage {
  return {
    author: { badges: [], displayName: 'User', id: 'user-1' },
    channelId: 'channel-1',
    emotes: [],
    id: 'msg-1',
    platform: 'twitch',
    text: '',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    type: 'message',
    ...overrides,
  }
}

describe('buildMessageParts', () => {
  test('returns plain text when message has no emotes', () => {
    const parts = buildMessageParts(makeMessage({ text: 'hello world' }))

    expect(parts).toEqual([{ content: 'hello world', type: 'text' }])
  })

  test('splits text around a single emote', () => {
    const parts = buildMessageParts(
      makeMessage({
        emotes: [
          {
            id: 'smile',
            imageUrl: 'https://example.com/smile.webp',
            name: 'SMILE',
            positions: [{ end: 10, start: 6 }],
          },
        ],
        text: 'hello SMILE world',
      }),
    )

    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ content: 'hello ', type: 'text' })
    expect(parts[1]?.type).toBe('emote')
    expect(parts[1]?.emote?.name).toBe('SMILE')
    expect(parts[2]).toEqual({ content: ' world', type: 'text' })
  })

  test('reuses the same emote for repeated positions', () => {
    const parts = buildMessageParts(
      makeMessage({
        emotes: [
          {
            id: 'wave',
            imageUrl: 'https://example.com/wave.webp',
            name: 'WAVE',
            positions: [
              { end: 3, start: 0 },
              { end: 8, start: 5 },
            ],
          },
        ],
        text: 'WAVE WAVE',
      }),
    )

    expect(parts).toHaveLength(3)
    expect(parts[0]?.type).toBe('emote')
    expect(parts[1]).toEqual({ content: ' ', type: 'text' })
    expect(parts[2]?.type).toBe('emote')
    expect(parts[0]?.emote).toBe(parts[2]?.emote)
  })

  test('keeps UTF-16 indexed text around emotes after non-BMP characters', () => {
    const parts = buildMessageParts(
      makeMessage({
        emotes: [
          {
            id: 'kappa',
            imageUrl: 'https://example.com/kappa.webp',
            name: 'Kappa',
            positions: [{ end: 10, start: 6 }],
          },
        ],
        text: '😀 hi Kappa!',
      }),
    )

    expect(parts).toEqual([
      { content: '😀 hi ', type: 'text' },
      {
        emote: {
          id: 'kappa',
          imageUrl: 'https://example.com/kappa.webp',
          name: 'Kappa',
          positions: [{ end: 10, start: 6 }],
        },
        type: 'emote',
      },
      { content: '!', type: 'text' },
    ])
  })

  test('keeps trailing whitespace after 7tv-style inclusive ranges', () => {
    const parts = buildMessageParts(
      makeMessage({
        emotes: [
          {
            id: 'kekw',
            imageUrl: 'https://example.com/kekw.webp',
            name: 'KEKW',
            positions: [{ end: 6, start: 3 }],
          },
        ],
        text: 'hi KEKW there',
      }),
    )

    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ content: 'hi ', type: 'text' })
    expect(parts[1]?.type).toBe('emote')
    expect(parts[2]).toEqual({ content: ' there', type: 'text' })
  })
})
