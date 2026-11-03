import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { buildMessageTokens } from '../src/gpuix/message-tokens'
import { createStore } from '../src/gpuix/state/create-store'
import { messageLength, messageLengthLimit } from '../src/views/main/utils/chat-send-targets'
import {
  codePointRangeToUtf16,
  initialsOf,
  sanitizeDisplayText,
  truncateGraphemes,
} from '../src/views/shared/utils/display-text'
import { buildMessageParts } from '../src/views/shared/utils/messageParts'

function makeMessage(partial: Partial<NormalizedChatMessage>): NormalizedChatMessage {
  return {
    id: 'm1',
    platform: 'twitch',
    channelId: 'chan',
    author: { id: 'u1', displayName: 'User', badges: [] },
    text: '',
    emotes: [],
    timestamp: new Date(0),
    type: 'message',
    ...partial,
  }
}

describe('buildMessageTokens', () => {
  test('plain text becomes word tokens with trailing spaces preserved', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hello world' }))
    expect(tokens).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'text', text: 'world' },
    ])
  })

  test('emote positions become emote tokens', () => {
    const tokens = buildMessageTokens(
      makeMessage({
        text: 'hi Kappa there',
        emotes: [
          {
            id: 'e1',
            name: 'Kappa',
            imageUrl: 'https://example.com/kappa.png',
            positions: [{ start: 3, end: 7 }],
          },
        ],
      }),
    )
    expect(tokens).toEqual([
      { kind: 'text', text: 'hi ' },
      {
        kind: 'emote',
        emote: expect.objectContaining({ id: 'e1' }),
      },
      { kind: 'text', text: 'there' },
    ])
  })

  test('links are detected and keep their url', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'see https://example.com/x now' }))
    expect(tokens[1]).toEqual({
      kind: 'link',
      text: 'https://example.com/x ',
      url: 'https://example.com/x',
    })
  })

  test('mentions become mention tokens', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hey @someone nice' }))
    expect(tokens[1]).toEqual({ kind: 'mention', text: '@someone ', color: null })
  })

  test('whitespace-only tokens after emotes are dropped (emote has its own margin)', () => {
    const tokens = buildMessageTokens(
      makeMessage({
        text: 'Kappa Kappa',
        emotes: [
          { id: 'e1', name: 'Kappa', imageUrl: 'x', positions: [{ start: 0, end: 4 }] },
          { id: 'e1', name: 'Kappa', imageUrl: 'x', positions: [{ start: 6, end: 10 }] },
        ],
      }),
    )
    expect(tokens.filter((t) => t.kind === 'text')).toEqual([])
    expect(tokens.filter((t) => t.kind === 'emote')).toHaveLength(2)
  })

  test('very long words are chunked so flex rows can wrap them', () => {
    const long = 'a'.repeat(70)
    const tokens = buildMessageTokens(makeMessage({ text: long }))
    expect(tokens.length).toBeGreaterThan(1)
    for (const token of tokens) {
      expect(token.kind).toBe('text')
      if (token.kind === 'text') expect(token.text.length).toBeLessThanOrEqual(28)
    }
  })

  test('emoji walls are chunked on grapheme boundaries (no lone surrogates)', () => {
    const wall = '😂👨‍👩‍👧‍👦🏳️‍🌈'.repeat(30)
    const tokens = buildMessageTokens(makeMessage({ text: wall }))
    expect(tokens.length).toBeGreaterThan(1)
    for (const token of tokens) {
      if (token.kind === 'text') expect(token.text.isWellFormed()).toBe(true)
    }
    expect(tokens.map((t) => (t.kind === 'text' ? t.text : '')).join('')).toBe(wall)
  })

  test('zalgo mark stacks are capped and newlines collapse to spaces', () => {
    const zalgo = `Z${'\u0301\u0302\u0303\u0304'.repeat(25)}a\n\n\tb`
    const tokens = buildMessageTokens(makeMessage({ text: zalgo }))
    const text = tokens.map((t) => (t.kind === 'text' ? t.text : '')).join('')
    expect(text).toBe('Z\u0301\u0302\u0303a b')
  })
})

describe('display-text', () => {
  test('sanitizeDisplayText repairs lone surrogates', () => {
    expect(sanitizeDisplayText('a\uD83Db').isWellFormed()).toBe(true)
  })

  test('truncateGraphemes never splits an emoji', () => {
    const out = truncateGraphemes('👍'.repeat(100), 80)
    expect(out.isWellFormed()).toBe(true)
    expect(out).toBe(`${'👍'.repeat(80)}…`)
    expect(truncateGraphemes('short', 80)).toBe('short')
  })

  test('initialsOf takes whole graphemes', () => {
    expect(initialsOf('👨‍👩‍👧 family')).toBe('👨‍👩‍👧')
    expect(initialsOf('satont', 2)).toBe('SA')
    expect(initialsOf('   ')).toBe('')
  })

  test('Twitch code-point emote offsets map to UTF-16 after an emoji', () => {
    // "😂 Kappa": Twitch reports Kappa at code points 2-6, UTF-16 units 3-7.
    const text = '😂 Kappa'
    const range = codePointRangeToUtf16(text, 2, 6)
    expect(text.slice(range.start, range.end + 1)).toBe('Kappa')
  })

  test('messageParts skips overlapping and out-of-range emote positions', () => {
    const emote = { id: '1', name: 'Kappa', imageUrl: '', positions: [] }
    const parts = buildMessageParts(
      makeMessage({
        text: 'Kappa hi',
        emotes: [
          {
            ...emote,
            positions: [
              { start: 0, end: 4 },
              { start: 2, end: 6 },
              { start: 50, end: 54 },
            ],
          },
        ],
      }),
    )
    expect(parts.map((p) => p.type)).toEqual(['emote', 'text'])
  })
})

describe('createStore', () => {
  test('set/get/update semantics', () => {
    const store = createStore({ count: 0 })
    expect(store.get().count).toBe(0)
    store.set({ count: 5 })
    expect(store.get().count).toBe(5)
    store.modify((prev) => ({ count: prev.count + 1 }))
    expect(store.get().count).toBe(6)
    store.update({ count: 10 })
    expect(store.get().count).toBe(10)
  })

  test('identical values do not notify', async () => {
    const store = createStore(1)
    let calls = 0
    store.subscribe(() => calls++)
    store.set(1)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(0)
  })

  test('unsubscribe cancels a notification queued before a component unmounts', async () => {
    const store = createStore(0)
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)
    store.set(1)
    unsubscribe()
    await Bun.sleep(10)
    expect(calls).toBe(0)
  })

  test('unsubscribe also cancels a listener already copied into the flushing batch', async () => {
    const store = createStore(0)
    let calls = 0
    let unsubscribe = () => {}
    store.subscribe(() => unsubscribe())
    unsubscribe = store.subscribe(() => calls++)
    store.set(1)
    await Bun.sleep(10)
    expect(calls).toBe(0)
  })

  test('an old subscription cannot cancel a later registration of the same callback', async () => {
    const store = createStore(0)
    let calls = 0
    const listener = () => calls++
    const first = store.subscribe(listener)
    store.subscribe(listener)
    store.set(1)
    first()
    await Bun.sleep(10)
    expect(calls).toBe(1)
  })

  test('notifications are coalesced into one macrotask (GPUI reentrancy guard)', async () => {
    const store = createStore(0)
    let calls = 0
    store.subscribe(() => calls++)
    store.set(1)
    store.set(2)
    store.set(3)
    // Not synchronous: the whole point is escaping the current dispatch.
    expect(calls).toBe(0)
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(1)
    expect(store.get()).toBe(3)
  })
})

describe('composer message length', () => {
  test('uses the tightest limit across target platforms', () => {
    expect(messageLengthLimit(['twitch', 'kick'])).toBe(500)
    expect(messageLengthLimit(['twitch', 'youtube'])).toBe(200)
    expect(messageLengthLimit([])).toBeNull()
  })

  test('counts emoji as one character', () => {
    expect(messageLength('👍👍 hi')).toBe(5)
  })
})
