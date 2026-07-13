import { expect, test } from 'bun:test'
import { moderationActionForDrag } from '../src/views/main/utils/moderation-drag'

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
