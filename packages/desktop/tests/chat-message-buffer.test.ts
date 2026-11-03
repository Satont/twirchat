import { expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  appendLiveChatMessages,
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
