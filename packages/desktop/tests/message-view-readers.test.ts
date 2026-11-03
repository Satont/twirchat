import { afterEach, expect, spyOn, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import {
  applyChannelClear,
  applyModerationOutcome,
  moderationOutcomeFor,
  moderationViewStore,
} from '../src/gpuix/state/app'
import {
  classifyIncomingSimilarity,
  getMessageSimilarity,
  hydrateSimilarityHistory,
  messageSimilarityReaderStore,
  messageSimilarityStore,
  resetSimilarityHistory,
} from '../src/gpuix/state/message-similarity'
import { DEFAULT_MESSAGE_SIMILARITY_SETTINGS } from '../src/services/message-similarity'

const original = messageSimilarityStore.get()
function message(
  id: string,
  timestamp = Date.now(),
  channelId = 'reader-room',
): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId,
    text: 'identical reader test text',
    timestamp: new Date(timestamp),
    author: {
      id: 'reader-viewer',
      username: 'reader-viewer',
      displayName: 'Reader viewer',
      badges: [],
    },
    type: 'message',
    emotes: [],
  }
}
async function configure(): Promise<void> {
  resetSimilarityHistory()
  messageSimilarityStore.update({
    value: { ...DEFAULT_MESSAGE_SIMILARITY_SETTINGS, enabled: true, excludeOwn: false },
  })
  await Bun.sleep(5)
}
afterEach(async () => {
  resetSimilarityHistory()
  messageSimilarityStore.set(original)
  await Bun.sleep(5)
})

test('fresh messages share one live similarity reader without notifying every pane', async () => {
  await configure()
  const reader = messageSimilarityReaderStore.get()
  let notifications = 0
  const stop = messageSimilarityReaderStore.subscribe(() => {
    notifications++
  })
  try {
    classifyIncomingSimilarity(message('reader-first', 100))
    const second = message('reader-second', 101)
    classifyIncomingSimilarity(second)
    await Bun.sleep(5)
    expect(messageSimilarityReaderStore.get()).toBe(reader)
    expect(reader.get(second)?.similar).toBe(true)
    expect(notifications).toBe(0)
  } finally {
    stop()
  }
})

test('history hydration and reset replace the reader used by memoized chat rules', async () => {
  await configure()
  const first = message('hydrate-first', 100),
    second = message('hydrate-second', 101)
  const reader = messageSimilarityReaderStore.get()
  hydrateSimilarityHistory('twitch:reader-room', [second, first])
  const hydrated = messageSimilarityReaderStore.get()
  expect(hydrated).not.toBe(reader)
  expect(hydrated.get(second)?.similar).toBe(true)
  resetSimilarityHistory('twitch:reader-room')
  expect(messageSimilarityReaderStore.get()).not.toBe(hydrated)
  expect(messageSimilarityReaderStore.get().get(second)).toBeUndefined()
})

test('a new policy publishes a new reader while old readers retain their captured policy', async () => {
  await configure()
  classifyIncomingSimilarity(message('policy-first', 100))
  const second = message('policy-second', 101)
  classifyIncomingSimilarity(second)
  const previous = messageSimilarityReaderStore.get()
  expect(previous.get(second)?.gray).toBe(true)
  messageSimilarityStore.modify((state) => ({
    ...state,
    value: { ...state.value, graySimilar: false, hideSimilar: true },
  }))
  await Bun.sleep(5)
  const updated = messageSimilarityReaderStore.get()
  expect(updated).not.toBe(previous)
  expect(updated.get(second)?.gray).toBe(false)
  expect(updated.get(second)?.triggerHighlights).toBe(false)
  expect(previous.get(second)?.gray).toBe(true)
  expect(getMessageSimilarity(second)?.gray).toBe(false)
})

test('similarity results cannot be mutated to change the appearance of other messages', async () => {
  await configure()
  const first = message('immutable-first', 100)
  const second = message('immutable-second', 101)
  const third = message('immutable-third', 102)
  for (const entry of [first, second, third]) classifyIncomingSimilarity(entry)
  const reader = messageSimilarityReaderStore.get()
  const normal = reader.get(first)
  const similar = reader.get(second)
  if (!normal || !similar) throw new Error('Expected classified messages')
  expect(Reflect.set(normal, 'gray', true)).toBe(false)
  expect(Reflect.set(similar, 'triggerHighlights', true)).toBe(false)
  expect(reader.get(first)).toEqual({ similar: false, gray: false, triggerHighlights: true })
  expect(reader.get(third)).toEqual({ similar: true, gray: true, triggerHighlights: false })
  const current = getMessageSimilarity(second)
  if (!current) throw new Error('Expected a classified message')
  expect(Reflect.set(current, 'gray', false)).toBe(false)
  expect(getMessageSimilarity(third)?.gray).toBe(true)
})

test('moderation publishes immutable resolver snapshots while imperative lookup follows the newest view', () => {
  const entry = message(
    `moderation-${crypto.randomUUID()}`,
    Date.now() - 1,
    `room-${crypto.randomUUID()}`,
  )
  const before = moderationViewStore.get()
  applyModerationOutcome({
    platform: entry.platform,
    channelId: entry.channelId,
    action: 'delete_message',
    messageId: entry.id,
  })
  const deleted = moderationViewStore.get()
  expect(deleted).not.toBe(before)
  expect(before.outcomeFor(entry)).toBeUndefined()
  expect(deleted.outcomeFor(entry)?.isTombstone).toBe(true)
  const other = { ...entry, id: `${entry.id}-other` }
  applyModerationOutcome({
    platform: entry.platform,
    channelId: entry.channelId,
    action: 'ban',
    targetUserId: entry.author.id,
  })
  expect(deleted.outcomeFor(other)).toBeUndefined()
  expect(moderationViewStore.get().outcomeFor(other)?.action).toBe('ban')
  expect(moderationOutcomeFor(other)?.action).toBe('ban')
  applyChannelClear(entry)
  expect(moderationOutcomeFor(entry)?.label).toBe('(chat cleared)')
})

test('a retained moderation view cannot keep a deleted-message tombstone after its expiry', () => {
  const now = Date.now()
  const entry = message(`expire-${crypto.randomUUID()}`, now, `room-${crypto.randomUUID()}`)
  const clock = spyOn(Date, 'now').mockReturnValue(now)
  try {
    applyModerationOutcome({
      platform: entry.platform,
      channelId: entry.channelId,
      action: 'delete_message',
      messageId: entry.id,
    })
    const view = moderationViewStore.get()
    expect(view.outcomeFor(entry)?.isTombstone).toBe(true)
    clock.mockReturnValue(now + 300_001)
    expect(view.outcomeFor(entry)).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
