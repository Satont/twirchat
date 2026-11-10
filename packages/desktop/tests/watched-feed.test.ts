import { expect, test } from 'bun:test'

import { chatMessageIdentity } from '@twirchat/shared/message-identity'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  createWatchedFeedReader,
  observeWatchedFeedSources,
  readWatchedFeed,
  recordWatchedFeedAppend,
} from '../src/gpuix/state/watched-feed'
import { appendLiveChatMessages } from '../src/views/main/utils/chat-message-buffer'

function message(platform: 'twitch' | 'kick', timestamp: number): NormalizedChatMessage {
  return {
    id: String(timestamp),
    channelId: platform === 'kick' ? '184206' : 'stream',
    platform,
    type: 'message',
    author: { id: 'user', displayName: 'Viewer', badges: [] },
    text: String(timestamp),
    timestamp: new Date(timestamp),
    emotes: [],
  }
}

test('live append merges retained rows by source while preserving older snapshots', () => {
  const sourceIds = ['twitch-id', 'kick-id']
  const dispose = observeWatchedFeedSources(sourceIds)
  const read = createWatchedFeedReader(sourceIds)
  const twitch = [message('twitch', 1), message('twitch', 3)]
  const kick = [message('kick', 2), message('kick', 4)]
  const buffers = new Map([
    ['twitch-id', twitch],
    ['kick-id', kick],
  ])
  try {
    const first = read(buffers)
    expect(first.messages.map((entry) => entry.id)).toEqual(['1', '2', '3', '4'])
    expect(read(new Map(buffers).set('outside', [message('twitch', 5)]))).toBe(first)

    const latest = message('kick', 5)
    const next = appendLiveChatMessages(kick, [latest], 2)
    recordWatchedFeedAppend('kick-id', kick, next)
    const updated = new Map(buffers).set('kick-id', next)
    const result = read(updated)
    expect(result.messages.map((entry) => entry.id)).toEqual(['1', '3', '4', '5'])
    expect(result.sourceByKey.get(chatMessageIdentity(latest))).toBe('kick-id')
    expect(result).toEqual(readWatchedFeed(sourceIds, updated))
    expect(first.messages.map((entry) => entry.id)).toEqual(['1', '2', '3', '4'])
    expect(first.sourceByKey.size).toBe(4)

    const late = appendLiveChatMessages(next, [message('kick', 4.5)], 3)
    recordWatchedFeedAppend('kick-id', next, late)
    const lateBuffers = new Map(buffers).set('kick-id', late)
    expect(read(lateBuffers)).toEqual(readWatchedFeed(sourceIds, lateBuffers))
    const replacement = { ...latest, text: 'Updated from history' }
    const hydrated = new Map(buffers).set('kick-id', [...late.slice(0, -1), replacement])
    expect(read(hydrated).messages.at(-1)).toBe(replacement)
  } finally {
    dispose()
  }
})

test('combined retention backfills older rows when a capped source disappears', () => {
  const sourceIds = ['one', 'two', 'three']
  const read = createWatchedFeedReader(sourceIds)
  const buffers = new Map(
    sourceIds.map((id, index) => [
      id,
      Array.from({ length: 200 }, (_, item) => message('twitch', index * 200 + item)),
    ]),
  )
  const first = read(buffers)
  expect(first.messages).toHaveLength(500)
  expect(first.messages[0]?.id).toBe('100')

  const withoutLatest = new Map(buffers)
  withoutLatest.delete('three')
  const result = read(withoutLatest)
  expect(result.messages).toHaveLength(400)
  expect(result.messages[0]?.id).toBe('0')
  expect(result.messages.at(-1)?.id).toBe('399')
})
