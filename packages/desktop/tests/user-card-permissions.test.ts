import { expect, test } from 'bun:test'

import { canUseUserCardAction } from '../src/gpuix/hooks/user-card-dialog/use-user-card-permissions'
import type { UserCardTarget } from '../src/views/main/utils/chatCommands'

function user(overrides: Partial<UserCardTarget> = {}): UserCardTarget {
  return {
    platform: 'twitch',
    platformUserId: '42',
    displayName: 'viewer',
    ...overrides,
  }
}

test('grants read for a moderator badge', () => {
  expect(
    canUseUserCardAction(user({ badges: [{ id: 'm', type: 'moderator', text: 'Mod' }] }), 'read'),
  ).toBe(true)
})

test('grants read for the channel owner by id or login', () => {
  expect(canUseUserCardAction(user({ channelId: '42' }), 'read')).toBe(true)
  expect(
    canUseUserCardAction(user({ username: 'streamer', channelSlug: 'streamer' }), 'read'),
  ).toBe(true)
})

test('denies read for a regular viewer', () => {
  expect(canUseUserCardAction(user({ channelSlug: 'streamer' }), 'read')).toBe(false)
})
