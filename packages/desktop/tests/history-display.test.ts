import { expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { UserChatHistoryPage } from '../src/shared/rpc'
import {
  HISTORY_DISPLAY_LIMIT,
  appendLiveHistoryMessage,
  historyRowVisible,
  historySourceNotice,
  matchesHistoryUser,
  mergeHistoryMessages,
  type HistoryUserTarget,
} from '../src/views/main/utils/history-display'

function message(id: string, time = 1000, channelId = 'satont'): NormalizedChatMessage {
  return {
    id,
    channelId,
    platform: 'twitch',
    author: { id: '42', displayName: 'Viewer', badges: [] },
    text: 'same text',
    emotes: [],
    timestamp: new Date(time),
    type: 'message',
  }
}

test('history pages deduplicate provider overlap without removing distinct equal messages', () => {
  const local = message('one', 1000, 'Satont')
  const same = { ...message('one', 1000, '#satont'), text: 'external version' }
  const another = message('two', 1000)
  const otherChannel = message('one', 1000, 'another')
  const merged = mergeHistoryMessages([local], [same, same, another, otherChannel])
  expect(merged).toHaveLength(3)
  expect(merged).toContain(local)
  expect(merged).toContain(another)
  expect(merged).toContain(otherChannel)
  expect(merged).not.toContain(same)
})

test('late initial history cannot erase an arriving live message or replace its payload', async () => {
  const response = Promise.withResolvers<NormalizedChatMessage[]>()
  const live = { ...message('same', 2000), text: 'live authoritative' }
  let current = appendLiveHistoryMessage([], live)
  const loading = response.promise.then((page) => {
    current = mergeHistoryMessages(current, page)
  })
  response.resolve([message('older'), message('same', 2000)])
  await loading
  expect(current.map((entry) => entry.id)).toEqual(['older', 'same'])
  expect(current.at(-1)).toBe(live)
})

test('live upserts replace a historical copy and remain chronological without duplicates', () => {
  const first = message('first')
  const historical = message('middle', 2000)
  const last = message('last', 3000)
  const live = { ...historical, text: 'live version', channelId: '#Satont' }
  const initial = [first, historical, last]
  const next = appendLiveHistoryMessage(initial, live)
  expect(next).toEqual([first, live, last])
  expect(initial).toEqual([first, historical, last])
  expect(appendLiveHistoryMessage(next, live)).toBe(next)
  const late = message('late', 1500)
  expect(appendLiveHistoryMessage(next, late)).toEqual([first, late, live, last])
})

test('live index ownership keeps branches from an older history snapshot independent', () => {
  const one = message('one')
  const two = message('two', 2000)
  const three = message('three', 3000)
  const root = [one]
  const firstBranch = appendLiveHistoryMessage(root, two)
  const secondBranch = appendLiveHistoryMessage(root, three)
  expect(firstBranch).toEqual([one, two])
  expect(secondBranch).toEqual([one, three])
  expect(appendLiveHistoryMessage(firstBranch, three)).toEqual([one, two, three])
})

test('display retention rejects older arrivals and evicts identities with their rows', () => {
  const initial = Array.from({ length: HISTORY_DISPLAY_LIMIT }, (_, index) =>
    message(String(index), 1000 + index),
  )
  expect(appendLiveHistoryMessage(initial, message('too-old', 1))).toBe(initial)
  const newest = message('newest', 10000)
  const next = appendLiveHistoryMessage(initial, newest)
  expect(next).toHaveLength(HISTORY_DISPLAY_LIMIT)
  expect(next[0]?.id).toBe('1')
  expect(next.at(-1)).toBe(newest)
  const reusedId = message('0', 11000)
  const reused = appendLiveHistoryMessage(next, reusedId)
  expect(reused).toHaveLength(HISTORY_DISPLAY_LIMIT)
  expect(reused.at(-1)).toBe(reusedId)
})

test('user history live events match the requested channel and preserve YouTube ID case', () => {
  const target: HistoryUserTarget = {
    platform: 'twitch',
    platformUserId: '42',
    channelId: '#SATONT',
  }
  expect(matchesHistoryUser(message('one'), target)).toBe(true)
  expect(matchesHistoryUser(message('one', 1000, 'other'), target)).toBe(false)
  expect(
    matchesHistoryUser(
      { ...message('one'), author: { id: '43', displayName: 'Other', badges: [] } },
      target,
    ),
  ).toBe(false)
  const youtube: NormalizedChatMessage = { ...message('one', 1000, 'UCxY'), platform: 'youtube' }
  expect(
    matchesHistoryUser(youtube, { platform: 'youtube', platformUserId: '42', channelId: 'UCxY' }),
  ).toBe(true)
  expect(
    matchesHistoryUser(youtube, { platform: 'youtube', platformUserId: '42', channelId: 'UCxy' }),
  ).toBe(false)
})

test('source notices distinguish unavailable or partial history without hiding local results', () => {
  const history: NonNullable<UserChatHistoryPage['history']> = {
    partial: false,
    truncated: false,
    sources: [{ id: 'rm', kind: 'recent', status: 'ok', messages: 0, capabilities: ['recent'] }],
  }
  expect(historySourceNotice(undefined)).toBeNull()
  expect(historySourceNotice(history)).toContain('only channels and dates')
  expect(historySourceNotice({ ...history, partial: true })).toContain('available external history')
  expect(historySourceNotice({ ...history, error: 'Backend offline' })).toContain(
    'Local messages remain available',
  )
  expect(
    historySourceNotice({
      ...history,
      sources: [
        {
          ...history.sources[0],
          id: 'rm',
          kind: 'recent',
          capabilities: ['recent'],
          messages: 0,
          status: 'unavailable',
        },
      ],
    }),
  ).toContain('Showing stored local messages')
})

test('virtual history rows only request images near the visible range including the paging row', () => {
  expect(historyRowVisible(0, 2000, null)).toBe(false)
  expect(historyRowVisible(1999, 2000, null)).toBe(true)
  expect(historyRowVisible(10, 2000, { start: 16, end: 20 }, 1)).toBe(false)
  expect(historyRowVisible(11, 2000, { start: 16, end: 20 }, 1)).toBe(true)
  expect(historyRowVisible(24, 2000, { start: 16, end: 20 }, 1)).toBe(false)
})
