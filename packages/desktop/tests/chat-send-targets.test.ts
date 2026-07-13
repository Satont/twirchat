import { expect, test } from 'bun:test'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'
import {
  createChatMessageTargets,
  ownChatSendTargets,
} from '../src/views/main/utils/chat-send-targets'

const homeTargets = [
  { channelLogin: 'justovich221337', platform: 'twitch' as const },
  { channelLogin: 'satont', platform: 'kick' as const },
]

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

test('sends a normal message to every enabled platform', () => {
  expect(createChatMessageTargets(homeTargets, 'hello', () => true)).toEqual([
    { channelLogin: 'justovich221337', platform: 'twitch', text: 'hello' },
    { channelLogin: 'satont', platform: 'kick', text: 'hello' },
  ])
})

test('sends a Kick reply only to Kick', () => {
  const replyTarget: Pick<NormalizedChatMessage, 'id' | 'platform'> = {
    id: 'kick-parent',
    platform: 'kick',
  }

  expect(createChatMessageTargets(homeTargets, 'hello', () => true, replyTarget)).toEqual([
    {
      channelLogin: 'satont',
      platform: 'kick',
      replyToMessageId: 'kick-parent',
      text: 'hello',
    },
  ])
})

test('sends a Twitch reply only to Twitch', () => {
  const replyTarget: Pick<NormalizedChatMessage, 'id' | 'platform'> = {
    id: 'twitch-parent',
    platform: 'twitch',
  }

  expect(createChatMessageTargets(homeTargets, 'hello', () => true, replyTarget)).toEqual([
    {
      channelLogin: 'justovich221337',
      platform: 'twitch',
      replyToMessageId: 'twitch-parent',
      text: 'hello',
    },
  ])
})
