import { describe, expect, test } from 'bun:test'

import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import {
  compileMessageRules,
  DEFAULT_CHAT_RULES,
  replaceMessageText,
  validateChatRules,
  type ChatRules,
  type HighlightRule,
  type IgnoreRule,
} from '../src/gpuix/message-rules'

const account: Account = {
  id: 'mine',
  platform: 'twitch',
  platformUserId: 'me',
  username: 'streamer',
  displayName: 'Streamer',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}
const base: NormalizedChatMessage = {
  id: 'm',
  platform: 'twitch',
  channelId: 'streamer',
  text: 'Hello chat',
  author: { id: 'viewer', username: 'alice', displayName: 'Alice', badges: [] },
  timestamp: new Date(),
  emotes: [],
  type: 'message',
}
function rules(patch: Partial<ChatRules> = {}): ChatRules {
  return { ...structuredClone(DEFAULT_CHAT_RULES), ...patch }
}
function highlight(patch: Partial<HighlightRule> = {}): HighlightRule {
  return {
    id: 'h',
    pattern: 'hello',
    target: 'message',
    enabled: true,
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    color: '#a78bfa',
    mentions: true,
    sound: true,
    flash: true,
    ...patch,
  }
}
function ignore(patch: Partial<IgnoreRule> = {}): IgnoreRule {
  return {
    id: 'i',
    pattern: 'spam',
    target: 'message',
    enabled: true,
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    placeholder: false,
    ...patch,
  }
}

describe('chat rule classification', () => {
  test('custom highlights resolve all notification flags and cache immutable messages', () => {
    const classifier = compileMessageRules(rules({ highlights: [highlight()] }), [account])
    const result = classifier.classify(base)
    expect(result).toMatchObject({
      highlighted: true,
      mention: true,
      sound: true,
      flash: true,
      color: '#a78bfa',
      hidden: false,
      rules: ['h'],
    })
    expect(classifier.classify(base)).toBe(result)
    expect(
      compileMessageRules(rules({ highlights: [highlight({ enabled: false })] }), []).classify(base)
        .highlighted,
    ).toBe(false)
  })

  test('matches user and badge targets and respects whole words and case', () => {
    expect(
      compileMessageRules(rules({ highlights: [highlight({ pattern: '\\1' })] }), []).classify({
        ...base,
        text: 'literal \\1 text',
      }).highlighted,
    ).toBe(true)
    expect(
      compileMessageRules(
        rules({ highlights: [highlight({ target: 'user', pattern: 'ALICE' })] }),
        [],
      ).classify(base).highlighted,
    ).toBe(true)
    expect(
      compileMessageRules(
        rules({
          highlights: [highlight({ target: 'user', pattern: 'ALICE', caseSensitive: true })],
        }),
        [],
      ).classify(base).highlighted,
    ).toBe(false)
    const badge = {
      ...base,
      author: { ...base.author, badges: [{ id: 'sub-12', type: 'subscriber', text: 'One year' }] },
    }
    expect(
      compileMessageRules(
        rules({ highlights: [highlight({ target: 'badge', pattern: 'subscriber' })] }),
        [],
      ).classify(badge).highlighted,
    ).toBe(true)
    const classifier = compileMessageRules(
      rules({ highlights: [highlight({ pattern: 'cat', wholeWord: true })] }),
      [],
    )
    expect(classifier.classify({ ...base, text: 'a cat!' }).highlighted).toBe(true)
    expect(classifier.classify({ ...base, text: 'category' }).highlighted).toBe(false)
  })

  test('DSL highlight rules cover special provider and fork events', () => {
    for (const flag of [
      'first_message',
      'sub_message',
      'whisper',
      'announcement',
      'restricted',
      'watch_streak',
      'follow_message',
    ]) {
      const classifier = compileMessageRules(
        rules({ highlights: [highlight({ target: 'filter', pattern: `flags.${flag}` })] }),
        [],
      )
      expect(
        classifier.classify({ ...base, metadata: { flags: { [flag]: true } } }).highlighted,
      ).toBe(true)
      expect(classifier.classify(base).highlighted).toBe(false)
    }
    const classifier = compileMessageRules(
      rules({
        highlights: [
          highlight({ target: 'filter', pattern: 'reward.cost >= 500 && flags.reward_message' }),
        ],
      }),
      [],
    )
    expect(
      classifier.classify({ ...base, metadata: { rewardCost: 500, rewardId: 'reward' } }).mention,
    ).toBe(true)
  })

  test('own-message and reply options have independent effects', () => {
    const own = { ...base, author: { ...base.author, id: 'me' } }
    expect(
      compileMessageRules(rules({ highlights: [highlight()] }), [account]).classify(own)
        .highlighted,
    ).toBe(false)
    expect(
      compileMessageRules(rules({ highlightOwnMessages: true, highlights: [highlight()] }), [
        account,
      ]).classify(own).highlighted,
    ).toBe(true)
    const reply = {
      ...base,
      reply: {
        parentMessageId: 'parent',
        parentMessageText: '',
        parentAuthor: { id: 'me', username: 'streamer', displayName: 'Streamer' },
      },
    }
    expect(compileMessageRules(rules(), [account]).classify(reply).mention).toBe(true)
    expect(
      compileMessageRules(rules({ highlightReplies: false }), [account]).classify(reply).mention,
    ).toBe(false)
  })

  test('ignores can hide with placeholders or suppress every highlight without hiding', () => {
    const hidden = compileMessageRules(
      rules({ ignores: [ignore({ pattern: 'alice', target: 'user', placeholder: true })] }),
      [],
    ).classify(base)
    expect(hidden).toMatchObject({ hidden: true, placeholder: true })
    const suppressed = compileMessageRules(
      rules({
        highlights: [highlight()],
        ignores: [ignore({ pattern: 'alice', target: 'user', action: 'suppress-highlights' })],
      }),
      [],
    ).classify({ ...base, metadata: { highlighted: true } })
    expect(suppressed).toMatchObject({
      hidden: false,
      highlighted: false,
      mention: false,
      sound: false,
      flash: false,
      rules: [],
    })
    expect(suppressed.color).toBeUndefined()
  })

  test('platform and immutable user IDs constrain ignored users', () => {
    const classifier = compileMessageRules(
      rules({
        ignores: [
          ignore({ target: 'user', pattern: 'unused', userId: 'viewer', platform: 'kick' }),
        ],
      }),
      [],
    )
    expect(classifier.classify(base).hidden).toBe(false)
    expect(classifier.classify({ ...base, platform: 'kick' }).hidden).toBe(true)
    expect(
      classifier.classify({ ...base, platform: 'kick', author: { ...base.author, id: 'another' } })
        .hidden,
    ).toBe(false)
  })

  test('replacement preserves whitespace and shifts retained emotes without changing originals', () => {
    const original: NormalizedChatMessage = {
      ...base,
      text: 'badly bad Kappa bad',
      emotes: [
        {
          id: '25',
          name: 'Kappa',
          imageUrl: 'https://example.com/emote.png',
          positions: [{ start: 10, end: 14 }],
        },
      ],
    }
    const classifier = compileMessageRules(
      rules({
        ignores: [ignore({ pattern: 'bad', wholeWord: true, action: 'replace', replacement: 'X' })],
      }),
      [],
    )
    const result = classifier.classify(original)
    expect(result.hidden).toBe(false)
    expect(result.message.text).toBe('badly X Kappa X')
    expect(result.message.emotes[0]?.positions).toEqual([{ start: 8, end: 12 }])
    expect(original.text).toBe('badly bad Kappa bad')
    expect(original.emotes[0]?.positions[0]?.start).toBe(10)
    expect(replaceMessageText(original, /missing/u, 'new')).toBe(original)
    expect(replaceMessageText(original, /Kappa/u, '').emotes).toEqual([])
  })

  test('ANDs assigned filters and can exempt own messages without exempting other users', () => {
    const config = rules({
      filters: [
        { id: 'long', name: 'Long', expression: 'message.length > 5' },
        { id: 'kick', name: 'Kick', expression: 'platform.name == "kick"' },
      ],
      paneFilters: { pane: ['long', 'kick'] },
      filterOwnMessages: false,
    })
    const classifier = compileMessageRules(config, [account])
    expect(classifier.matchesFilters(base, 'pane')).toBe(false)
    expect(classifier.matchesFilters({ ...base, platform: 'kick' }, 'pane')).toBe(true)
    expect(classifier.matchesFilters({ ...base, platform: 'kick', text: 'hi' }, 'pane')).toBe(false)
    expect(
      classifier.matchesFilters({ ...base, author: { ...base.author, id: 'me' } }, 'pane'),
    ).toBe(true)
    expect(classifier.matchesFilters(base, 'unassigned')).toBe(true)
  })
})

describe('chat rule preference validation', () => {
  test('normalizes optional options and removes deleted pane-filter IDs', () => {
    const config = validateChatRules({
      highlights: [],
      ignores: [],
      filters: [],
      paneFilters: { pane: ['deleted'] },
    })
    expect(config.highlightReplies).toBe(true)
    expect(config.filterOwnMessages).toBe(true)
    expect(config.paneFilters.pane).toEqual([])
  })
  test('rejects invalid expressions, duplicate IDs, invalid colors and unsupported ignore actions', () => {
    expect(() => validateChatRules(rules({ highlights: [highlight({ color: 'red' })] }))).toThrow(
      'color',
    )
    expect(() => validateChatRules(rules({ highlights: [highlight(), highlight()] }))).toThrow(
      'duplicate',
    )
    expect(() =>
      validateChatRules(rules({ highlights: [highlight({ target: 'filter', pattern: '1' })] })),
    ).toThrow('boolean')
    expect(() =>
      validateChatRules(rules({ ignores: [ignore({ target: 'user', action: 'replace' })] })),
    ).toThrow('invalid')
    expect(() =>
      validateChatRules(
        rules({ filters: [{ id: 'f', name: 'Broken', expression: 'missing.variable' }] }),
      ),
    ).toThrow('Broken')
  })
})
