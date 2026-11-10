import { describe, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { buildMessageTokens, mergePlainText } from '../src/gpuix/message-tokens'
import { createStore } from '../src/gpuix/state/create-store'
import {
  createMentionAppearances,
  mentionAppearanceKey,
} from '../src/gpuix/state/mention-appearances'
import { messageLength, messageLengthLimit } from '../src/views/main/utils/chat-send-targets'
import {
  codePointRangeToUtf16,
  graphemes,
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

describe('mention appearances', () => {
  test('a late author and a color change notify only matching mentions', async () => {
    const appearances = createMentionAppearances()
    const key = mentionAppearanceKey('twitch', 'USER')
    const otherKey = mentionAppearanceKey('kick', 'user')
    const colors: Array<string | undefined> = []
    const unsubscribe = appearances.subscribe(key, () => {
      colors.push(appearances.snapshot(key)?.color)
    })
    const unsubscribeOther = appearances.subscribe(otherKey, () => {
      throw new Error('Another platform should not be notified')
    })
    try {
      const author = {
        id: 'u1',
        username: 'user',
        displayName: 'VisibleName',
        color: '#aabbcc',
        badges: [],
      }
      expect(appearances.snapshot(key)).toBeUndefined()
      appearances.addMessage(makeMessage({ author, timestamp: new Date(1) }))
      const initial = appearances.snapshot(key)
      expect(initial?.id).toBe('u1')
      expect(appearances.snapshot(mentionAppearanceKey('twitch', 'visiblename'))).toEqual(initial)
      expect(colors).toEqual([])
      await Bun.sleep(1)
      expect(colors).toEqual(['#aabbcc'])

      appearances.addMessage(makeMessage({ author: { ...author }, timestamp: new Date(3) }))
      appearances.addMessage(makeMessage({ author: { ...author, color: '#000000' } }))
      expect(appearances.snapshot(key)).toBe(initial)
      appearances.addMessage(
        makeMessage({ author: { ...author, color: '#aabbdd' }, timestamp: new Date(4) }),
      )
      await Bun.sleep(1)
      expect(colors).toEqual(['#aabbcc', '#aabbdd'])
    } finally {
      unsubscribe()
      unsubscribeOther()
    }
  })

  test('normalizes YouTube handles and ignores synthetic messages', () => {
    const appearances = createMentionAppearances()
    const author = { id: 'yt-1', username: '@Handle', displayName: 'Video Viewer', badges: [] }
    const key = mentionAppearanceKey('youtube', 'HANDLE')
    const message = makeMessage({ author, platform: 'youtube' })
    appearances.addMessage({ ...message, type: 'system' })
    appearances.addMessage({ ...message, delivery: { state: 'pending' } })
    expect(appearances.snapshot(key)).toBeUndefined()
    appearances.addMessage(message)
    expect(appearances.snapshot(key)?.id).toBe('yt-1')
  })
})

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

  test('emote aliases are read from each occurrence after UTF-16 surrogate pairs', () => {
    const tokens = buildMessageTokens(
      makeMessage({
        text: '😀 :) Улыбка smile',
        emotes: [
          {
            id: 'e1',
            name: 'smile',
            provider: 'seventv',
            imageUrl: 'https://example.com/smile.webp',
            positions: [
              { start: 3, end: 4 },
              { start: 6, end: 11 },
              { start: 13, end: 17 },
            ],
          },
        ],
      }),
    )
    const emoteTokens = tokens.filter((token) => token.kind === 'emote')
    expect(emoteTokens.map((token) => token.alias)).toEqual([':)', 'Улыбка', undefined])
    expect(emoteTokens.map((token) => token.emote.name)).toEqual(['smile', 'smile', 'smile'])
  })

  test('links are detected and keep their url', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'see https://example.com/x now' }))
    expect(tokens[1]).toEqual({
      kind: 'link',
      text: 'https://example.com/x ',
      url: 'https://example.com/x',
    })
  })

  test('encoded Cyrillic links wrap readable labels and retain the original target', () => {
    const path = 'очень-длинное-название-темы-на-русском-языке-для-проверки-переноса'
    const url = `https://forum.example.com/t/${encodeURIComponent(path)}/123`
    const message = makeMessage({ text: url })
    const tokens = buildMessageTokens(message)
    const links = tokens.filter((token) => token.kind === 'link')
    expect(links.length).toBeGreaterThan(2)
    expect(links).toHaveLength(tokens.length)
    expect(links.map((token) => token.text).join('')).toBe(
      `https://forum.example.com/t/${path}/123`,
    )
    for (const token of links) {
      expect(token.url).toBe(url)
      expect(graphemes(token.text).length).toBeLessThanOrEqual(28)
    }
    expect(message.text).toBe(url)
  })

  test('link labels preserve ASCII escapes and invisible Unicode escapes', () => {
    const escaped = '%2F%3F%23%26%25%40%20%09%0A%00%7F/%C2%85/%C2%A0/%E2%80%8B/%E2%80%AE/%E2%80%A8'
    const url = `https://example.com/%d1%82/${escaped}`
    const links = buildMessageTokens(makeMessage({ text: url })).filter(
      (token) => token.kind === 'link',
    )
    expect(links.map((token) => token.text).join('')).toBe(`https://example.com/т/${escaped}`)
    expect(links.every((token) => token.url === url)).toBe(true)
  })

  test('malformed encoded UTF-8 stays escaped without preventing other runs from decoding', () => {
    const malformed = '%D0/%FF/%ED%A0%80/%E0%80%AF/%D0%ZZ/%'
    const url = `https://example.com/${malformed}/%D1%82`
    const links = buildMessageTokens(makeMessage({ text: url })).filter(
      (token) => token.kind === 'link',
    )
    expect(links.map((token) => token.text).join('')).toBe(`https://example.com/${malformed}/т`)
    expect(links.every((token) => token.url === url)).toBe(true)
  })

  test('decoded link labels bound combining stacks across literal and encoded text', () => {
    const url = `https://example.com/a\u0301\u0301${encodeURIComponent('\u0301'.repeat(20))}`
    const links = buildMessageTokens(makeMessage({ text: url })).filter(
      (token) => token.kind === 'link',
    )
    expect(links.map((token) => token.text).join('')).toBe(
      'https://example.com/a\u0301\u0301\u0301',
    )
    expect(links.every((token) => token.url === url)).toBe(true)
  })

  test('mentions become mention tokens', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hey @someone nice' }))
    expect(tokens[1]).toEqual({
      kind: 'mention',
      text: '@someone ',
      username: 'someone',
    })
  })

  test('wrapped mention chunks retain the full username independently of punctuation and spacing', () => {
    const username = 'long_username_'.repeat(5)
    const tokens = buildMessageTokens(makeMessage({ text: `@${username}, @Other_User hi` }))
    const mentions = tokens.filter((token) => token.kind === 'mention')
    expect(mentions.length).toBeGreaterThan(2)
    expect(mentions.slice(0, -1).every((token) => token.username === username)).toBe(true)
    expect(mentions.at(-1)).toEqual({
      kind: 'mention',
      text: '@Other_User ',
      username: 'Other_User',
    })
  })

  test('handles inside a URL remain links', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'https://example.com/@someone @other' }))
    expect(tokens.filter((token) => token.kind === 'mention')).toEqual([
      { kind: 'mention', text: '@other', username: 'other' },
    ])
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

describe('mergePlainText', () => {
  test('joins a plain message into one text token without losing text', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'hello big world' }))
    expect(mergePlainText(tokens)).toEqual([{ kind: 'text', text: 'hello big world' }])
  })

  test('keeps words separate when a link has to wrap between them', () => {
    const tokens = buildMessageTokens(makeMessage({ text: 'see https://example.com now' }))
    expect(mergePlainText(tokens)).toBe(tokens)
  })
})
