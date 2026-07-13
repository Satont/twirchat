import { expect, test } from 'bun:test'
import type { Account } from '@twirchat/shared/types'
import { ownChatSendTargets } from '../src/views/main/utils/chat-send-targets'

test('uses connected account channels as home composer targets, never watched channel statuses', () => {
  const accounts: Account[] = [
    {
      id: 'twitch:1',
      platform: 'twitch',
      platformUserId: '1',
      username: 'justovich221337',
      displayName: 'justovich221337',
      scopes: [],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'kick:2',
      platform: 'kick',
      platformUserId: '2',
      username: 'Satont',
      displayName: 'Satont',
      scopes: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]

  expect(ownChatSendTargets(accounts)).toEqual([
    { channelLogin: 'justovich221337', platform: 'twitch' },
    { channelLogin: 'Satont', platform: 'kick' },
  ])
})
