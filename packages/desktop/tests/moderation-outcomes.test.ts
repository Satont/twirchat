import { expect, test } from 'bun:test'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { createModerationOutcomeStore } from '../src/views/main/composables/useModerationOutcomes'

function message(overrides: Partial<NormalizedChatMessage> = {}): NormalizedChatMessage {
  return {
    author: { badges: [], displayName: 'Viewer', id: 'viewer-1' },
    channelId: 'streamer',
    emotes: [],
    id: 'message-1',
    platform: 'twitch',
    text: 'hello',
    timestamp: new Date('2026-07-13T12:00:00Z'),
    type: 'message',
    ...overrides,
  }
}

test('resolves exact deletion and channel-scoped user sanctions without mutating messages', () => {
  const outcomes = createModerationOutcomeStore()
  const deleted = message()
  const sameAuthor = message({ id: 'message-2' })
  const otherAuthor = message({
    author: { badges: [], displayName: 'Other', id: 'viewer-2' },
    id: 'message-3',
  })

  outcomes.apply({
    action: 'delete_message',
    channelId: 'streamer',
    messageId: 'message-1',
    platform: 'twitch',
  })
  expect(outcomes.outcomeFor(deleted)).toEqual({
    action: 'delete_message',
    label: '(message deleted)',
  })
  expect(outcomes.outcomeFor(sameAuthor)).toBeUndefined()

  outcomes.apply({
    action: 'timeout',
    channelId: 'streamer',
    durationSeconds: 600,
    platform: 'twitch',
    targetUserId: 'viewer-1',
  })
  expect(outcomes.outcomeFor(sameAuthor)).toEqual({
    action: 'timeout',
    label: '(timed out for 10m)',
  })
  expect(outcomes.outcomeFor(otherAuthor)).toBeUndefined()
  expect(deleted).not.toHaveProperty('moderation')
})

test('uses a permanent ban when no valid timeout duration is supplied', () => {
  const outcomes = createModerationOutcomeStore()
  const target = message({ platform: 'kick' })

  outcomes.apply({
    action: 'timeout',
    channelId: 'streamer',
    durationSeconds: 0,
    platform: 'kick',
    targetUserId: 'viewer-1',
  })
  expect(outcomes.outcomeFor(target)).toBeUndefined()

  outcomes.apply({
    action: 'ban',
    channelId: 'streamer',
    platform: 'kick',
    targetUserId: 'viewer-1',
  })
  expect(outcomes.outcomeFor(target)).toEqual({ action: 'ban', label: '(banned)' })
})
