import { describe, expect, test } from 'bun:test'

import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import {
  chatMessageKey,
  compileChatSearch,
  createMentionMatcher,
  formatChatTranscript,
  type SearchDetails,
} from '../src/gpuix/chat-tools'

const account: Account = {
  id: 'account-twitch',
  platform: 'twitch',
  platformUserId: '42',
  username: 'satont',
  displayName: 'Сатонт',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}

function chat(
  overrides: Omit<Partial<NormalizedChatMessage>, 'author'> & {
    author?: Partial<NormalizedChatMessage['author']>
  } = {},
): NormalizedChatMessage {
  return {
    id: 'message-1',
    platform: 'twitch',
    channelId: '123',
    text: 'hello chat',
    emotes: [],
    timestamp: new Date('2026-11-01T10:20:30Z'),
    type: 'message',
    ...overrides,
    author: {
      id: 'viewer-1',
      username: 'alice',
      displayName: 'Alice Viewer',
      badges: [],
      ...overrides.author,
    },
  }
}

function replyTo(parent: Partial<NonNullable<NormalizedChatMessage['reply']>['parentAuthor']>) {
  return {
    parentMessageId: 'parent-message',
    parentMessageText: 'a previous message',
    parentAuthor: { id: 'someone', username: 'someone', displayName: 'Someone', ...parent },
  }
}

function matches(query: string, message: NormalizedChatMessage, details: SearchDetails = {}) {
  return compileChatSearch(query).matches(message, details)
}

describe('chat search workflows', () => {
  test('combines author, content and link filters with AND', () => {
    const linked = chat({ text: 'Here is the BUILD https://example.com/release' })
    expect(matches('from:alice build has:link', linked)).toBe(true)
    expect(matches('from:bob build has:link', linked)).toBe(false)
    expect(matches('from:alice build has:link', chat({ text: 'build is ready' }))).toBe(false)
    expect(matches('from:alice missing has:link', linked)).toBe(false)
  })

  test('quoted author names and phrases stay together', () => {
    const message = chat({ text: 'Please bring the green tea, thanks!' })
    expect(matches('from:"Alice Viewer" "green tea"', message)).toBe(true)
    expect(matches('from:"Alice Viewer" "tea green"', message)).toBe(false)
    expect(matches('from:"Viewer Alice" "green tea"', message)).toBe(false)
  })

  test('comma alternatives are OR within one filter and can resolve aliases', () => {
    const message = chat({ author: { username: 'bob', displayName: 'Bob', id: '17' } })
    expect(matches('from:alice,bob', message)).toBe(true)
    expect(matches('from:@alice,@bob', message)).toBe(true)
    expect(matches('from:17', message)).toBe(true)
    expect(matches('from:"Favourite Mod"', message, { alias: 'Favourite Mod' })).toBe(true)
    expect(matches('from:alice,charlie', message, { alias: 'Favourite Mod' })).toBe(false)
  })

  test('negated author and content terms hide only matching messages', () => {
    const message = chat({ text: 'release is ready' })
    expect(matches('!from:bob -spam release', message)).toBe(true)
    expect(matches('!from:alice release', message)).toBe(false)
    expect(matches('-ready', message)).toBe(false)
    expect(matches('!has:link release', message)).toBe(true)
    expect(matches('!has:link', chat({ text: 'see www.example.com' }))).toBe(false)
    expect(matches('-"release is"', message)).toBe(false)
  })

  test('treats regular expression syntax as literal message text', () => {
    expect(matches('[a-z]+', chat({ text: 'The pattern is [a-z]+ today' }))).toBe(true)
    expect(matches('[a-z]+', chat({ text: 'abcdef' }))).toBe(false)
    expect(matches('(a+)+$', chat({ text: 'a'.repeat(10_000) }))).toBe(false)
    expect(matches('https://example.com/a?b=1', chat({ text: 'https://example.com/a?b=1' }))).toBe(
      true,
    )
  })

  test('filters by platform and channel ID or readable channel name', () => {
    const message = chat({ platform: 'kick', channelId: '987' })
    expect(matches('platform:twitch,kick in:#Satont', message, { channelName: 'satont' })).toBe(
      true,
    )
    expect(matches('platform:KICK in:123,987', message)).toBe(true)
    expect(matches('platform:youtube in:987', message)).toBe(false)
    expect(matches('in:another', message, { channelName: 'satont' })).toBe(false)
  })

  test('finds badges by role, badge ID or displayed label', () => {
    const message = chat({
      author: { badges: [{ id: 'sub-12', type: 'subscriber', text: '1 Year Subscriber' }] },
    })
    expect(matches('badge:moderator,subscriber', message)).toBe(true)
    expect(matches('badge:sub-12', message)).toBe(true)
    expect(matches('badge:"1 Year Subscriber"', message)).toBe(true)
    expect(matches('badge:moderator', message)).toBe(false)
    expect(matches('badge:subscriber', chat())).toBe(false)
  })

  test('finds emote messages and replies without matching their absence', () => {
    const emoteMessage = chat({
      text: 'Kappa',
      emotes: [{ id: '25', name: 'Kappa', imageUrl: 'https://example.com/25.png', positions: [] }],
    })
    expect(matches('has:emote', emoteMessage)).toBe(true)
    expect(matches('has:emote', chat())).toBe(false)
    expect(matches('has:reply', chat({ reply: replyTo({}) }))).toBe(true)
    expect(matches('is:reply', chat({ reply: replyTo({}) }))).toBe(true)
    expect(matches('is:reply', chat())).toBe(false)
  })

  test('uses resolved highlight/deletion state and message action/delivery flags', () => {
    const message = chat()
    expect(matches('is:highlighted', message, { highlighted: true })).toBe(true)
    expect(matches('is:mention', message, { highlighted: true })).toBe(true)
    expect(matches('is:highlighted', message)).toBe(false)
    expect(matches('is:deleted', message, { deleted: true })).toBe(true)
    expect(matches('!is:deleted', message, { deleted: true })).toBe(false)
    expect(matches('is:action', chat({ type: 'action' }))).toBe(true)
    expect(matches('is:system', chat({ type: 'system' }))).toBe(true)
    expect(
      matches('is:failed', chat({ delivery: { state: 'failed', error: 'Not allowed' } })),
    ).toBe(true)
    expect(matches('is:failed', chat({ delivery: { state: 'pending' } }))).toBe(false)
  })

  test('shows a useful hint while a quotation is unfinished and matches its partial phrase', () => {
    const search = compileChatSearch('from:alice "green tea')
    expect(search.error).toContain('quotation mark')
    expect(search.matches(chat({ text: 'green tea' }), {})).toBe(true)
    expect(compileChatSearch('from:alice "green tea"').error).toBeUndefined()
    expect(matches('', chat())).toBe(true)
  })
})

describe('mentions', () => {
  const mentions = createMentionMatcher([account])

  test('recognizes bare or @ names, case-insensitively, across Unicode boundaries', () => {
    for (const text of [
      'satont, hello',
      'Hello @SATONT!',
      'Привет, Сатонт!',
      '@сатонт?',
      '(satont)',
    ]) {
      expect(mentions(chat({ text }))).toBe(true)
    }
  })

  test('does not highlight another username that merely contains the same text', () => {
    for (const text of [
      'satont123',
      'test_satont',
      'satont_hello',
      'сатонтчик',
      'досатонт',
      '@satonttv',
    ]) {
      expect(mentions(chat({ text }))).toBe(false)
    }
  })

  test('does not mistake a URL path for a mention but still sees names outside URLs', () => {
    for (const text of [
      'https://example.com/satont',
      'http://example.com/@satont',
      'www.example.com/satont',
    ]) {
      expect(mentions(chat({ text }))).toBe(false)
    }
    expect(mentions(chat({ text: 'https://example.com/satont — hello @satont' }))).toBe(true)
  })

  test('ignores own messages, other platforms and system announcements', () => {
    expect(mentions(chat({ text: '@satont', author: { id: '42' } }))).toBe(false)
    expect(mentions(chat({ text: '@satont', author: { username: 'SATONT' } }))).toBe(false)
    expect(mentions(chat({ text: '@satont', platform: 'kick' }))).toBe(false)
    expect(mentions(chat({ text: '@satont added an emote', type: 'system' }))).toBe(false)
  })

  test('recognizes replies to own platform ID or username without a textual mention', () => {
    expect(mentions(chat({ reply: replyTo({ id: '42' }) }))).toBe(true)
    expect(mentions(chat({ reply: replyTo({ username: 'SATONT' }) }))).toBe(true)
    expect(mentions(chat({ reply: replyTo({}) }))).toBe(false)
    expect(mentions(chat({ platform: 'kick', reply: replyTo({ id: '42' }) }))).toBe(false)
    expect(mentions(chat({ author: { id: '42' }, reply: replyTo({ id: '42' }) }))).toBe(false)
  })

  test('escapes punctuation in configured names instead of interpreting regular expressions', () => {
    const specialName = createMentionMatcher([
      { ...account, username: 'user[1]', displayName: 'user[1]' },
    ])
    expect(specialName(chat({ text: 'Hello @user[1]!' }))).toBe(true)
    expect(specialName(chat({ text: 'Hello user1!' }))).toBe(false)
    expect(createMentionMatcher([])(chat({ text: '@satont' }))).toBe(false)
  })
})

test('message keys distinguish repeated provider IDs across platforms and channels', () => {
  const keys = new Set([
    chatMessageKey(chat()),
    chatMessageKey(chat({ platform: 'kick' })),
    chatMessageKey(chat({ channelId: 'another-channel' })),
  ])
  expect(keys.size).toBe(3)
  expect(chatMessageKey(chat())).toBe(chatMessageKey(chat()))
})

test('chat transcripts keep visible order, authors, platforms and message content', () => {
  const first = chat({ text: 'first line' })
  const second = chat({ platform: 'kick', author: { displayName: 'Боб' }, text: 'second line' })
  const output = formatChatTranscript([first, second]).split('\n')
  expect(output).toHaveLength(2)
  expect(output[0]).toEndWith('[twitch] Alice Viewer: first line')
  expect(output[1]).toEndWith('[kick] Боб: second line')
  expect(output[0]).toMatch(/^\[[^\]]+\] /u)
  expect(formatChatTranscript([])).toBe('')
  expect(formatChatTranscript([chat({ timestamp: new Date(Number.NaN) })])).toStartWith(
    '[] [twitch]',
  )
})

test('PCRE search preserves quoted escapes and case controls while ANDing predicates', () => {
  expect(
    matches(String.raw`regex:"(?-i:BUILD)\s+\d{2}" from:alice`, chat({ text: 'BUILD 42' })),
  ).toBe(true)
  expect(matches(String.raw`regex:"(?-i:BUILD)\s+\d{2}"`, chat({ text: 'build 42' }))).toBe(false)
  expect(matches(String.raw`regex:"(\w+) \1"`, chat({ text: 'привет привет' }))).toBe(true)
  expect(matches('!regex:fail', chat({ text: 'passed' }))).toBe(true)
  expect(compileChatSearch('!regex:[').error).toBeString()
  expect(matches('!regex:[', chat())).toBe(false)
})

test('search resolves subscriber tier and detected client with comma alternatives', () => {
  const message = chat({
    author: { badges: [{ id: 'subscriber/2006', type: 'subscriber', text: 'Subscriber' }] },
    metadata: { clientDetection: 'Leafyrino' },
  })
  expect(matches('subtier:2,3 client:leafyrino,dankerino', message)).toBe(true)
  expect(matches('-subtier:2', message)).toBe(false)
  expect(matches('subtier:1', message)).toBe(false)
  expect(matches('client:leafyrino', chat())).toBe(false)
})

test('upstream event flags are searchable and system omits standalone timeout notices', () => {
  const message = chat({
    metadata: {
      firstMessage: true,
      bits: 100,
      rewardId: 'reward',
      announcement: 'blue',
      flags: {
        sub_message: true,
        monitored: true,
        restricted: true,
        repeated_messages: true,
        watch_streak: true,
      },
    },
  })
  for (const flag of [
    'first-msg',
    'cheer-msg',
    'redemption',
    'announcement',
    'sub',
    'subscription',
    'monitored',
    'restricted',
    'repeated',
    'repeated-message',
    'repeated-messages',
    'watch-streak',
  ])
    expect(matches(`is:${flag}`, message)).toBe(true)
  const moderation = chat({ type: 'system', metadata: { flags: { timeout: true } } })
  expect(matches('is:system', moderation)).toBe(false)
  expect(matches('is:system,ban', moderation)).toBe(true)
  expect(matches('is:timeout', moderation)).toBe(true)
  expect(matches('is:disabled', chat(), { deleted: true })).toBe(true)
})
