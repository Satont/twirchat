import { expect, test } from 'bun:test'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'
import {
  confirmDelivery,
  createPendingMessage,
  failDelivery,
  reconcilePendingMessages,
} from '../src/views/main/utils/message-delivery'

const twitchAccount: Account = {
  id: 'twitch:1',
  platform: 'twitch',
  platformUserId: '1',
  username: 'viewer',
  displayName: 'Viewer',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}

test('creates an in-memory faded message without treating it as persisted chat history', () => {
  const message = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'hello',
  })

  expect(message.id).toStartWith('pending:twitch:stray228:')
  expect(message.delivery).toEqual({ state: 'pending' })
  expect(message.channelId).toBe('stray228')
})

test('turns a pending message into a visible delivery failure with the provider reason', () => {
  const pending = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'hello',
  })

  expect(failDelivery([pending], pending.id, 'Followers-only mode for 10 minutes')).toEqual([
    expect.objectContaining({
      id: pending.id,
      delivery: { state: 'failed', error: 'Followers-only mode for 10 minutes' },
    }),
  ])
})

test('replaces a confirmed local echo with the provider chat event instead of duplicating it', () => {
  const pending = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'hello',
  })
  const confirmed = confirmDelivery([pending], pending.id)
  const providerMessage: NormalizedChatMessage = {
    ...pending,
    id: 'twitch-message-id',
    delivery: undefined,
  }

  expect(reconcilePendingMessages(confirmed, [providerMessage])).toEqual([])
})

test('replaces a pending local echo when the provider event arrives before the send request resolves', () => {
  const pending = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'hello',
  })
  const providerMessage: NormalizedChatMessage = {
    ...pending,
    id: 'kick-message-id',
    delivery: undefined,
  }

  expect(reconcilePendingMessages([pending], [providerMessage])).toEqual([])
})

test('does not reconcile a new local echo against an older identical provider message', () => {
  const pending = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: '123',
  })
  const oldProviderMessage: NormalizedChatMessage = {
    ...pending,
    id: 'older-provider-message',
    delivery: undefined,
    timestamp: new Date(pending.timestamp.getTime() - 60_000),
  }

  expect(reconcilePendingMessages([pending], [oldProviderMessage])).toEqual([pending])
})
