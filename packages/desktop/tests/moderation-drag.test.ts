import { expect, test } from 'bun:test'

import {
  moderationActionForDrag,
  type ModerationDragAction,
  unbanDistanceFrom,
} from '../src/views/main/utils/moderation-drag'

test('maps drag distance to a safe discrete moderation action', () => {
  expect(moderationActionForDrag('twitch', 20)).toBeNull()
  expect(moderationActionForDrag('kick', 48)).toEqual({
    action: 'delete_message',
    label: 'Delete message',
  })
  expect(moderationActionForDrag('twitch', 128)).toEqual({
    action: 'timeout',
    durationSeconds: 300,
    label: 'Timeout 5m',
  })
  expect(moderationActionForDrag('kick', 400)).toEqual({
    action: 'ban',
    label: 'Ban permanently',
  })
})

test('a deleted message keeps its timeout and ban zones but offers no second delete', () => {
  expect(moderationActionForDrag('twitch', 48, { messageDeleted: true })).toBeNull()
  expect(moderationActionForDrag('twitch', 128, { messageDeleted: true })).toEqual({
    action: 'timeout',
    durationSeconds: 300,
    label: 'Timeout 5m',
  })
  expect(moderationActionForDrag('kick', 400, { messageDeleted: true })).toEqual({
    action: 'ban',
    label: 'Ban permanently',
  })
})

test('a left drag unbans once it passes the unban threshold', () => {
  const unban: ModerationDragAction = { action: 'unban', label: 'Unban / untimeout' }
  expect(moderationActionForDrag('twitch', -10)).toBeNull()
  expect(moderationActionForDrag('twitch', -16)).toEqual(unban)
  expect(moderationActionForDrag('kick', -160, { messageDeleted: true })).toEqual(unban)
  expect(moderationActionForDrag('twitch', -5, { unbanDistance: 5 })).toEqual(unban)
})

test('the unban threshold shrinks to the room left of the press', () => {
  expect(unbanDistanceFrom(200)).toBe(16)
  expect(unbanDistanceFrom(7)).toBe(5)
  expect(unbanDistanceFrom(1)).toBe(3)
})
