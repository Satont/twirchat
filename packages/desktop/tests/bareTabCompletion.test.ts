import { describe, expect, test } from 'bun:test'

import type {
  NormalizedChatMessage,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'

import { channelBroadcasters, recentAuthors } from '../src/gpuix/hooks/use-autocomplete'
import {
  bareCompletionQuery,
  rankBareMentionMatches,
  rankBareTabCompletions,
  reconcileBareTabCycle,
  stepBareTabCompletion,
  type BareTabCycleState,
} from '../src/views/main/utils/bareTabCompletion'

function chatMessage(
  id: string,
  author: Partial<NormalizedChatMessage['author']> & { displayName: string },
  overrides: Partial<NormalizedChatMessage> = {},
): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'alpha',
    type: 'message',
    text: 'hello',
    timestamp: new Date(1_700_000_000_000),
    emotes: [],
    author: {
      id: author.id ?? id,
      displayName: author.displayName,
      username: author.username,
      badges: [],
    },
    ...overrides,
  }
}

describe('bareCompletionQuery', () => {
  test('extracts a final plain word including unicode and internal hyphens', () => {
    expect(bareCompletionQuery('sat')).toBe('sat')
    expect(bareCompletionQuery('hello sat')).toBe('sat')
    expect(bareCompletionQuery('hi foo-bar')).toBe('foo-bar')
    expect(bareCompletionQuery('привет Сат')).toBe('Сат')
  })

  test('ignores prefixed tokens, URLs, leading hyphens, and trailing whitespace', () => {
    for (const text of ['', 'sat ', '@sat', ':sat', '/sat', '!sat', '-sat', 'https://sat']) {
      expect(bareCompletionQuery(text)).toBeUndefined()
    }
  })
})

describe('rankBareMentionMatches', () => {
  test('ranks exact matches before prefixes and preserves recency within prefixes', () => {
    const result = rankBareMentionMatches(
      [
        { displayName: 'Satont', insertLabel: 'Satont', username: 'satont' },
        { displayName: 'saturn', insertLabel: 'saturn', username: 'saturn' },
        { displayName: 'sat', insertLabel: 'sat', username: 'sat' },
        { displayName: 'Sat', insertLabel: 'Sat', username: 'sat' },
        { displayName: 'xSatont', insertLabel: 'xSatont', username: 'xsatont' },
      ],
      'Sat',
    )
    expect(result).toEqual({
      exact: ['Sat', 'sat'],
      prefix: ['Satont', 'saturn'],
    })

    // Typing lowercase still keeps the newer capitalized chatter ahead of an older lowercase one.
    expect(
      rankBareMentionMatches(
        [
          { displayName: 'Satont', insertLabel: 'Satont', username: 'satont' },
          { displayName: 'saturn', insertLabel: 'saturn', username: 'saturn' },
        ],
        'sat',
      ),
    ).toEqual({
      exact: [],
      prefix: ['Satont', 'saturn'],
    })
  })

  test('supports localized Twitch logins and custom aliases', () => {
    const candidates = [
      { displayName: 'テスト', insertLabel: 'テスト', username: 'viewer42' },
      { displayName: 'Satont', insertLabel: 'Satont', username: 'satont', currentAlias: 'Anton' },
    ]
    expect(rankBareMentionMatches(candidates, 'view')).toEqual({
      exact: [],
      prefix: ['viewer42'],
    })
    expect(rankBareMentionMatches(candidates, 'テス')).toEqual({
      exact: [],
      prefix: ['テスト'],
    })
    expect(rankBareMentionMatches(candidates, 'ant')).toEqual({
      exact: [],
      prefix: ['Satont'],
    })
  })
})

describe('rankBareTabCompletions', () => {
  test('prioritizes exact/prefix emotes over same-tier usernames, while prefix usernames beat weak emotes', () => {
    const emotes = [{ label: 'xSatx' }, { label: 'S_a_t' }, { label: 'SatEmote' }, { label: 'Sat' }]
    const mentions = [
      { displayName: 'Satont', insertLabel: 'Satont', username: 'satont' },
      { displayName: 'sat', insertLabel: 'sat', username: 'sat' },
      { displayName: 'Sat', insertLabel: 'Sat', username: 'sat' },
    ]
    expect(rankBareTabCompletions({ emotes, mentions, query: 'sat' })).toEqual([
      'Sat',
      'sat',
      'SatEmote',
      'Satont',
      'xSatx',
      'S_a_t',
    ])
  })

  test('a prefix-matched username is first when emotes only match as substring or subsequence', () => {
    const emotes = [{ label: 'mySatontEmote' }, { label: 'S_a_t_o' }]
    const mentions = [{ displayName: 'Satont', insertLabel: 'Satont', username: 'satont' }]
    expect(rankBareTabCompletions({ emotes, mentions, query: 'sat' })).toEqual([
      'Satont',
      'mySatontEmote',
      'S_a_t_o',
    ])
  })
})

describe('stepBareTabCompletion and reconcileBareTabCycle', () => {
  const resolveCandidates = (query: string) =>
    rankBareTabCompletions({
      emotes: [{ label: 'Salute' }],
      mentions: [
        { displayName: 'Satont', insertLabel: 'Satont', username: 'satont' },
        { displayName: 'Sasha', insertLabel: 'Sasha', username: 'sasha' },
      ],
      query,
    })

  test('cycles forward with Tab and backward with Shift+Tab, wrapping around', () => {
    let text = 'hi sa'
    let cycle: BareTabCycleState | null = null

    const step1 = stepBareTabCompletion({ text, direction: 1, cycle, resolveCandidates })
    expect(step1?.nextText).toBe('hi Salute ')
    text = step1!.nextText
    cycle = reconcileBareTabCycle(step1!.nextCycle, text)

    const step2 = stepBareTabCompletion({ text, direction: 1, cycle, resolveCandidates })
    expect(step2?.nextText).toBe('hi Satont ')
    text = step2!.nextText
    cycle = reconcileBareTabCycle(step2!.nextCycle, text)

    const step3 = stepBareTabCompletion({ text, direction: 1, cycle, resolveCandidates })
    expect(step3?.nextText).toBe('hi Sasha ')
    text = step3!.nextText
    cycle = reconcileBareTabCycle(step3!.nextCycle, text)

    const step4 = stepBareTabCompletion({ text, direction: 1, cycle, resolveCandidates })
    expect(step4?.nextText).toBe('hi Salute ')
    text = step4!.nextText
    cycle = reconcileBareTabCycle(step4!.nextCycle, text)

    const back = stepBareTabCompletion({ text, direction: -1, cycle, resolveCandidates })
    expect(back?.nextText).toBe('hi Sasha ')
  })

  test('does not start a bare completion on Shift+Tab when no cycle is active', () => {
    expect(
      stepBareTabCompletion({
        text: 'hi sa',
        direction: -1,
        cycle: null,
        resolveCandidates,
      }),
    ).toBeNull()
  })

  test('supports rapid consecutive Tabs before React commits the previous edit', () => {
    const step1 = stepBareTabCompletion({
      text: 'hi sa',
      direction: 1,
      cycle: null,
      resolveCandidates,
    })
    expect(step1?.nextText).toBe('hi Salute ')

    const step2 = stepBareTabCompletion({
      text: 'hi sa',
      direction: 1,
      cycle: step1!.nextCycle,
      resolveCandidates,
    })
    expect(step2?.nextText).toBe('hi Satont ')
  })

  test('cancels the cycle once the user edits the text', () => {
    const step1 = stepBareTabCompletion({
      text: 'hi sa',
      direction: 1,
      cycle: null,
      resolveCandidates,
    })
    const committed = reconcileBareTabCycle(step1!.nextCycle, 'hi Salute ')
    expect(committed).not.toBeNull()
    expect(reconcileBareTabCycle(committed, 'hi Salute there')).toBeNull()
  })
})

describe('recentAuthors and channelBroadcasters', () => {
  test('appends broadcaster fallback, deduplicates once chatted, and excludes synthetic system authors', () => {
    const watched: WatchedChannel = {
      id: 'w1',
      platform: 'twitch',
      channelSlug: 'alpha',
      displayName: 'Alpha',
      createdAt: 0,
    }
    const broadcasters = channelBroadcasters(watched, {})
    expect(broadcasters).toEqual([{ platform: 'twitch', displayName: 'Alpha', username: 'alpha' }])

    const messages = [
      chatMessage('1', { id: 'u1', displayName: 'Alice', username: 'alice' }),
      chatMessage(
        '2',
        { id: '', displayName: 'Twitch' },
        { type: 'system', text: 'Slow mode enabled' },
      ),
      chatMessage(
        '3',
        { id: '7tv-system', displayName: '7TV', username: '7TV' },
        { type: 'system', text: 'Emote added' },
      ),
      chatMessage(
        '4',
        { id: 'u2', displayName: 'Bob', username: 'bob' },
        { type: 'system', text: 'Bob subscribed' },
      ),
    ]

    expect(
      recentAuthors(messages, undefined, broadcasters).map((item) => item.displayName),
    ).toEqual(['Bob', 'Alice', 'Alpha'])

    const withBroadcasterMessage = [
      ...messages,
      chatMessage('5', { id: 'u3', displayName: 'Alpha', username: 'alpha' }),
    ]
    expect(
      recentAuthors(withBroadcasterMessage, undefined, broadcasters).map(
        (item) => item.displayName,
      ),
    ).toEqual(['Alpha', 'Bob', 'Alice'])
  })

  test('skips YouTube channel IDs and reads connected non-YouTube home statuses', () => {
    const ytChannel: WatchedChannel = {
      id: 'yt1',
      platform: 'youtube',
      channelSlug: 'UC1234567890',
      displayName: 'Streamer',
      createdAt: 0,
    }
    expect(channelBroadcasters(ytChannel, {})).toEqual([])

    const statuses: Partial<Record<PlatformStatusInfo['platform'], PlatformStatusInfo>> = {
      twitch: {
        platform: 'twitch',
        status: 'connected',
        mode: 'authenticated',
        channelLogin: 'satont',
      },
      youtube: {
        platform: 'youtube',
        status: 'connected',
        mode: 'authenticated',
        channelLogin: 'UC123',
      },
      kick: {
        platform: 'kick',
        status: 'disconnected',
        mode: 'anonymous',
        channelLogin: 'offline',
      },
    }
    expect(channelBroadcasters(null, statuses)).toEqual([
      { platform: 'twitch', displayName: 'satont', username: 'satont' },
    ])
  })
})
