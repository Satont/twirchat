import { expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  appendLiveChatMessages,
  appendLiveChatMessagesWithCount,
  mergeChatMessageSnapshot,
} from '../src/views/main/utils/chat-message-buffer'
import { literal, required } from './fixture-values'

function message(id: string, timestamp: string): NormalizedChatMessage {
  return {
    id,
    platform: 'kick',
    channelId: 'satont',
    author: { id: 'viewer', displayName: 'Viewer', badges: [] },
    text: id,
    emotes: [],
    timestamp: new Date(timestamp),
    type: 'message',
  }
}

function indexedMessage(id: number): NormalizedChatMessage {
  return message(`indexed-${id}`, new Date(1000 + id).toISOString())
}

test('keeps a live message when a stale initial history snapshot finishes afterward', () => {
  const earlier = message('persisted', '2026-07-13T14:00:00.000Z')
  const live = message('live', '2026-07-13T14:01:00.000Z')

  expect(mergeChatMessageSnapshot([live], [earlier])).toEqual([earlier, live])
})

test('live append keeps chronology for late messages without mutating the snapshot', () => {
  const earlier = message('first', '2026-07-13T14:00:00.000Z')
  const middle = message('second', '2026-07-13T14:01:00.000Z')
  const latest = message('third', '2026-07-13T14:02:00.000Z')
  const current = [earlier, latest]
  expect(appendLiveChatMessages(current, [middle])).toEqual([earlier, middle, latest])
  expect(current).toEqual([earlier, latest])
})

test('deduplicates both live batches and history by platform and ID', () => {
  const kick = message('same', '2026-07-13T14:00:00.000Z')
  const twitch = { ...kick, platform: literal('twitch') }
  const current = [kick]
  expect(appendLiveChatMessages(current, [kick, twitch, twitch])).toEqual([kick, twitch])
  expect(mergeChatMessageSnapshot(current, [twitch])).toEqual([kick, twitch])
  expect(appendLiveChatMessages(current, [{ ...kick, text: 'stale copy' }])).toBe(current)
  expect(mergeChatMessageSnapshot(current, [{ ...kick, text: 'stale copy' }])).toBe(current)
})

test('caps a mixed-order batch to the newest messages', () => {
  const messages = Array.from({ length: 12 }, (_, index) =>
    message(`message-${index}`, new Date(1_000 + index).toISOString()),
  )
  const current = messages.slice(4, 8)
  expect(appendLiveChatMessages(current, [...messages].reverse(), 4)).toEqual(messages.slice(8))
  expect(appendLiveChatMessages(current, [required(messages[0])], 4)).toBe(current)
})

test('orders equal timestamps deterministically across platform IDs', () => {
  const later = message('z', '2026-07-13T14:00:00.000Z')
  const earlier = message('a', '2026-07-13T14:00:00.000Z')
  expect(appendLiveChatMessages([later], [earlier])).toEqual([earlier, later])
  expect(appendLiveChatMessages([], [later, earlier])).toEqual([earlier, later])
})

test('supports uncapped buffers and returns the same reference for empty batches', () => {
  const current = [message('first', '2026-07-13T14:00:00.000Z')]
  expect(appendLiveChatMessages(current, [])).toBe(current)
  const incoming = Array.from({ length: 5 }, (_, index) =>
    message(`next-${index}`, new Date(2_000_000_000_000 + index).toISOString()),
  )
  expect(appendLiveChatMessages(current, incoming, 0)).toEqual([...current, ...incoming])
})

test('counts unique live arrivals even when they are older than the retained window', () => {
  const first = message('retained-first', '2026-07-13T14:01:00.000Z')
  const last = message('retained-last', '2026-07-13T14:02:00.000Z')
  const old = message('old-arrival', '2026-07-13T14:00:00.000Z')
  const current = [first, last]
  const otherPlatform = { ...old, platform: literal('twitch') }
  const result = appendLiveChatMessagesWithCount(
    current,
    [first, old, { ...old }, otherPlatform, otherPlatform],
    2,
  )
  expect(result.messages).toBe(current)
  expect(result.newMessageCount).toBe(2)
  expect(appendLiveChatMessagesWithCount(current, [old], 2)).toEqual({
    messages: current,
    newMessageCount: 1,
  })
})

test('counts a mixed-order uncapped batch while preserving platform and timestamp ordering', () => {
  const first = message('first', '2026-07-13T14:00:00.000Z')
  const kick = message('same', '2026-07-13T14:01:00.000Z')
  const twitch = { ...kick, platform: literal('twitch') }
  const last = message('last', '2026-07-13T14:02:00.000Z')
  const current = [first]
  expect(appendLiveChatMessagesWithCount(current, [last, twitch, first, kick, last], 0)).toEqual({
    messages: [first, kick, twitch, last],
    newMessageCount: 3,
  })
  expect(appendLiveChatMessagesWithCount(current, []).messages).toBe(current)
  expect(appendLiveChatMessagesWithCount(current, [first]).messages).toBe(current)
  expect(appendLiveChatMessagesWithCount(current, [first]).newMessageCount).toBe(0)
})

test('successive retained windows discard obsolete IDs without forgetting batch duplicates', () => {
  const first = appendLiveChatMessagesWithCount(
    [],
    [indexedMessage(0), indexedMessage(1)],
    2,
  ).messages
  const next = appendLiveChatMessagesWithCount(
    first,
    [indexedMessage(2), indexedMessage(3)],
    2,
  ).messages
  for (let index = 0; index < 2; index++) {
    const old = appendLiveChatMessagesWithCount(
      next,
      [indexedMessage(0), indexedMessage(0), indexedMessage(2)],
      2,
    )
    expect(old.messages).toBe(next)
    expect(old.newMessageCount).toBe(1)
  }
  const replay = indexedMessage(0)
  replay.timestamp = new Date(2000)
  expect(appendLiveChatMessagesWithCount(next, [replay, indexedMessage(3)], 2)).toEqual({
    messages: [indexedMessage(3), replay],
    newMessageCount: 1,
  })
})

test('branching an immutable older buffer cannot change the current version identity index', () => {
  const first = appendLiveChatMessagesWithCount(
    [],
    [indexedMessage(0), indexedMessage(1)],
    2,
  ).messages
  Object.freeze(first)
  const current = appendLiveChatMessagesWithCount(
    first,
    [indexedMessage(2), indexedMessage(3)],
    2,
  ).messages
  Object.freeze(current)
  const branch = appendLiveChatMessagesWithCount(first, [indexedMessage(2), indexedMessage(4)], 2)
  expect(branch).toEqual({ messages: [indexedMessage(2), indexedMessage(4)], newMessageCount: 2 })
  expect(first).toEqual([indexedMessage(0), indexedMessage(1)])
  expect(
    appendLiveChatMessagesWithCount(current, [indexedMessage(3), indexedMessage(2)], 2),
  ).toEqual({
    messages: current,
    newMessageCount: 0,
  })
  expect(appendLiveChatMessagesWithCount(branch.messages, [indexedMessage(3)], 2)).toEqual({
    messages: [indexedMessage(3), indexedMessage(4)],
    newMessageCount: 1,
  })
})

test('cached single arrivals, no-op batches and uncapped branches retain exact membership', () => {
  const initial = [indexedMessage(0), indexedMessage(1)]
  expect(
    appendLiveChatMessagesWithCount(initial, [indexedMessage(0), indexedMessage(1)], 2).messages,
  ).toBe(initial)
  expect(appendLiveChatMessagesWithCount(initial, []).messages).toBe(initial)
  const next = appendLiveChatMessagesWithCount(initial, [indexedMessage(2)], 2)
  expect(next).toEqual({ messages: [indexedMessage(1), indexedMessage(2)], newMessageCount: 1 })
  expect(
    appendLiveChatMessagesWithCount(next.messages, [indexedMessage(0)], 2).newMessageCount,
  ).toBe(1)
  expect(
    appendLiveChatMessagesWithCount(next.messages, [indexedMessage(0)], 2).newMessageCount,
  ).toBe(1)
  const uncapped = appendLiveChatMessagesWithCount(
    initial,
    [indexedMessage(3), indexedMessage(2)],
    0,
  )
  expect(uncapped).toEqual({
    messages: [indexedMessage(0), indexedMessage(1), indexedMessage(2), indexedMessage(3)],
    newMessageCount: 2,
  })
  const otherPlatform = { ...indexedMessage(3), platform: literal('twitch') }
  expect(
    appendLiveChatMessagesWithCount(uncapped.messages, [indexedMessage(3), otherPlatform], 0),
  ).toEqual({
    messages: [...uncapped.messages, otherPlatform],
    newMessageCount: 1,
  })
})
