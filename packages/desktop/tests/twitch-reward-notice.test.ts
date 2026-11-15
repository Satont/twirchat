import { expect, test } from 'bun:test'

import type { TwitchActivityEvent } from '@twirchat/shared/twitch-activities'

import { parseTwitchRewardNotice } from '../src/services/twitch-reward-notice'

const redemption: TwitchActivityEvent = {
  type: 'redemption',
  channelId: '1337',
  eventType: 'channel.channel_points_custom_reward_redemption.add',
  data: {
    id: '7f1ea233-8141-4512-8a01-1c9fe0cd930e',
    broadcaster_user_id: '1337',
    broadcaster_user_login: 'Creator',
    user_id: '9000',
    user_login: 'Viewer',
    user_name: 'Viewer',
    user_input: '',
    redeemed_at: '2026-11-15T09:00:00.123456Z',
    reward: { id: 'reward-1', title: 'Hydrate', cost: 150 },
  },
}

test('renders an EventSub redemption without input as a stable Twitch system message', () => {
  expect(parseTwitchRewardNotice(redemption)).toEqual({
    id: 'twitch:reward-redemption:7f1ea233-8141-4512-8a01-1c9fe0cd930e',
    platform: 'twitch',
    channelId: 'creator',
    author: { id: '9000', username: 'viewer', displayName: 'Viewer', badges: [] },
    text: '',
    emotes: [],
    timestamp: new Date('2026-11-15T09:00:00.123Z'),
    type: 'system',
    metadata: { rewardId: 'reward-1', rewardTitle: 'Hydrate', rewardCost: 150 },
  })
})

test('leaves redemptions with text to Twitch IRC', () => {
  const withText = { ...redemption, data: { ...redemption.data, user_input: 'My request' } }
  expect(parseTwitchRewardNotice(withText)).toBeUndefined()
})

test('ignores status updates and invalid redemption payloads', () => {
  const update = {
    ...redemption,
    eventType: 'channel.channel_points_custom_reward_redemption.update',
  }
  const invalidTimestamp = { ...redemption, data: { ...redemption.data, redeemed_at: 'yesterday' } }
  expect(parseTwitchRewardNotice(update)).toBeUndefined()
  expect(parseTwitchRewardNotice(invalidTimestamp)).toBeUndefined()
})
