import { expect, test } from 'bun:test'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'
import * as chatTargets from '../src/views/main/utils/chat-send-targets'

const accounts: Account[] = [
  {
    id: 'twitch:1',
    platform: 'twitch',
    platformUserId: '1',
    username: 'MyStreamer',
    displayName: 'MyStreamer',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'kick:2',
    platform: 'kick',
    platformUserId: '2',
    username: 'MyKick',
    displayName: 'MyKick',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  },
]

function message(
  id: string,
  platform: 'twitch' | 'kick',
  channelId: string,
): NormalizedChatMessage {
  return {
    id,
    platform,
    channelId,
    author: {
      id: 'viewer',
      username: 'viewer',
      displayName: 'Viewer',
      badges: [],
    },
    text: id,
    type: 'message',
    emotes: [],
    data: {},
    timestamp: new Date('2026-07-14T00:00:00.000Z'),
  }
}

test('keeps My channels scoped to the connected account channels', () => {
  const filterHomeChatMessages = (chatTargets as unknown as Record<string, unknown>)[
    'filterHomeChatMessages'
  ]

  expect(filterHomeChatMessages).toBeTypeOf('function')
  if (typeof filterHomeChatMessages !== 'function') return

  const messages = [
    message('twitch-own', 'twitch', 'MYSTREAMER'),
    message('twitch-watched', 'twitch', 'another-streamer'),
    message('kick-own', 'kick', 'mykick'),
    message('kick-watched', 'kick', 'another-kick'),
  ]
  const filter = filterHomeChatMessages as (
    messages: readonly NormalizedChatMessage[],
    accounts: readonly Account[],
  ) => NormalizedChatMessage[]

  expect(filter(messages, accounts).map((item) => item.id)).toEqual(['twitch-own', 'kick-own'])
})

test('routes live messages and history through the My channels filter', async () => {
  const source = await Bun.file(new URL('../src/views/main/App.vue', import.meta.url)).text()

  expect(source).toContain('filterHomeChatMessages(recentMsgs, accounts.value)')
  expect(source).toContain('filterHomeChatMessages([msg], accounts.value)')
  expect(source).toContain('filterHomeChatMessages(recentMessages, accounts.value)')
})
