import { expect, test } from 'bun:test'

import { canUseUserCardAction } from '../src/gpuix/hooks/user-card-dialog/use-user-card-permissions'
import type { UserCardTarget } from '../src/views/main/utils/chatCommands'

function user(overrides: Partial<UserCardTarget> = {}): UserCardTarget {
  return {
    platform: 'twitch',
    platformUserId: '42',
    displayName: 'viewer',
    channelSlug: 'streamer',
    ...overrides,
  }
}

test('grants read when the acting account can moderate in the channel', () => {
  expect(canUseUserCardAction(user(), 'read', true)).toBe(true)
  expect(canUseUserCardAction(user({ platform: 'kick' }), 'read', true)).toBe(true)
})

test('ignores roles held by the card target', () => {
  expect(
    canUseUserCardAction(
      user({ badges: [{ id: 'm', type: 'moderator', text: 'Mod' }] }),
      'read',
      false,
    ),
  ).toBe(false)
  expect(canUseUserCardAction(user({ channelId: '42' }), 'read', false)).toBe(false)
})

test('denies read without moderation capability, channel or unsupported platform', () => {
  expect(canUseUserCardAction(user(), 'read', false)).toBe(false)
  expect(canUseUserCardAction(user({ channelSlug: undefined }), 'read', true)).toBe(false)
  expect(canUseUserCardAction(user({ platform: 'youtube' }), 'read', true)).toBe(false)
})
