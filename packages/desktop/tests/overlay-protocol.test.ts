import { expect, test } from 'bun:test'

import {
  overlayEventSchema,
  parseOverlayAnimation,
  parseOverlayPosition,
} from '../src/views/overlay/protocol'

test('overlay URL enums use known defaults for malformed or unsupported values', () => {
  expect(parseOverlayAnimation('fade')).toBe('fade')
  expect(parseOverlayAnimation('invalid')).toBe('slide')
  expect(parseOverlayPosition('top')).toBe('top')
  expect(parseOverlayPosition(null)).toBe('bottom')
})

test('overlay validates nested wire messages and restores dates at its socket boundary', () => {
  const raw = {
    type: 'chat_message',
    data: {
      message: {
        id: 'm',
        platform: 'twitch',
        channelId: 'room',
        author: { id: 'viewer', displayName: 'Viewer', badges: [] },
        text: 'hello',
        emotes: [],
        timestamp: '2026-11-01T12:00:00Z',
        type: 'message',
      },
      parts: [{ type: 'text', content: 'hello' }],
    },
  }
  const event = overlayEventSchema.parse({ ...raw, futureField: true })
  if (event.type !== 'chat_message') throw new Error('Expected chat message.')
  expect(event.data.message.timestamp).toBeInstanceOf(Date)
  expect(event.data.parts).toEqual([{ type: 'text', content: 'hello' }])
  expect(
    overlayEventSchema.safeParse({
      ...raw,
      data: { ...raw.data, parts: [{ type: 'emote', emote: { id: 42 } }] },
    }).success,
  ).toBe(false)
  expect(
    overlayEventSchema.safeParse({
      ...raw,
      data: { ...raw.data, message: { ...raw.data.message, author: { id: 42 } } },
    }).success,
  ).toBe(false)
  expect(overlayEventSchema.parse({ type: 'clear' })).toEqual({ type: 'clear' })
})
