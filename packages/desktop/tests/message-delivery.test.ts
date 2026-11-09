import { expect, test } from 'bun:test'

import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { appendLiveChatMessages } from '../src/views/main/utils/chat-message-buffer'
import {
  confirmDelivery,
  createPendingMessage,
  failDelivery,
  reconcilePendingMessages,
  type DeliveryMessage,
} from '../src/views/main/utils/message-delivery'
import { required } from './fixture-values'

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

const kickAccount: Account = {
  ...twitchAccount,
  id: 'kick:3195252',
  platform: 'kick',
  platformUserId: '3195252',
  username: 'satont',
  displayName: 'Satont',
}

function providerMessage(local: DeliveryMessage, id: string): NormalizedChatMessage {
  return { ...local, id, delivery: undefined }
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

test('preserves array identity when a provider batch does not remove any local echoes', () => {
  const pending = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'unsent',
  })
  const provider: NormalizedChatMessage = {
    ...pending,
    id: 'provider-other-message',
    text: 'another message',
    delivery: undefined,
  }
  const empty: DeliveryMessage[] = []
  const messages = [pending]
  expect(reconcilePendingMessages(empty, [provider])).toBe(empty)
  expect(reconcilePendingMessages(messages, [])).toBe(messages)
  expect(reconcilePendingMessages(messages, [provider])).toBe(messages)

  const failed = failDelivery(messages, pending.id, 'Rejected by provider')
  expect(reconcilePendingMessages(failed, [{ ...provider, text: pending.text }])).toBe(failed)
})

test('allocates a new array only when removing echoes and retains the other message objects', () => {
  const first = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'first',
  })
  const echoed = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'echoed',
  })
  const last = createPendingMessage({
    account: twitchAccount,
    channelId: 'stray228',
    text: 'last',
  })
  const messages = [first, echoed, last]
  const result = reconcilePendingMessages(messages, [
    { ...echoed, id: 'provider-echo', delivery: undefined },
  ])
  expect(result).not.toBe(messages)
  expect(result).toEqual([first, last])
  expect(result[0]).toBe(first)
  expect(result[1]).toBe(last)
  expect(messages).toEqual([first, echoed, last])
})

test('reconciles canonical Kick channels before or after the HTTP acknowledgement and preserves provider badges', () => {
  const pending = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'test' })
  const actual = providerMessage(pending, 'kick-real')
  actual.author = {
    ...actual.author,
    badges: [{ id: 'broadcaster', type: 'broadcaster', text: 'Broadcaster' }],
  }
  expect(reconcilePendingMessages([pending], [actual])).toEqual([])
  expect(confirmDelivery([], pending.id, { channelId: '3195252', messageId: 'kick-real' })).toEqual(
    [],
  )
  const confirmed = confirmDelivery([pending], pending.id, {
    channelId: '3195252',
    messageId: 'kick-real',
  })
  expect(reconcilePendingMessages(confirmed, [actual])).toEqual([])
  expect(actual.author.badges[0]?.type).toBe('broadcaster')
})

test('a watched Kick receipt resolves the target channel without mistaking it for the account channel', () => {
  const pending = createPendingMessage({
    account: kickAccount,
    channelId: 'watched-streamer',
    text: 'hello',
    scope: 'watched-pane',
  })
  const actual = { ...providerMessage(pending, 'watched-real'), channelId: '9000001' }
  expect(reconcilePendingMessages([pending], [actual])).toEqual([pending])
  const confirmed = confirmDelivery([pending], pending.id, {
    channelId: '9000001',
    messageId: 'watched-real',
  })
  expect(reconcilePendingMessages(confirmed, [{ ...actual, channelId: '3195252' }])).toEqual(
    confirmed,
  )
  expect(reconcilePendingMessages(confirmed, [actual])).toEqual([])
})

test('an exact provider ID reconciles late delivery without accepting another same-text message', () => {
  const pending = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'test' })
  const confirmed = confirmDelivery([pending], pending.id, {
    channelId: '3195252',
    messageId: 'expected-id',
  })
  const actual = {
    ...providerMessage(pending, 'expected-id'),
    timestamp: new Date(pending.timestamp.getTime() + 90_000),
  }
  expect(reconcilePendingMessages(confirmed, [{ ...actual, id: 'another-id' }])).toBe(confirmed)
  expect(reconcilePendingMessages(confirmed, [actual])).toEqual([])
})

test('one provider echo consumes only one of repeated sends, including across later batches', () => {
  const first = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'same' })
  const second = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'same' })
  const provider = providerMessage(first, 'first-provider')
  const once = reconcilePendingMessages([first, second], [provider])
  expect(once).toHaveLength(1)
  expect(once[0]?.id).toBe(second.id)
  expect(reconcilePendingMessages(once, [provider])).toBe(once)
  expect(
    reconcilePendingMessages(once, [provider, providerMessage(second, 'second-provider')]),
  ).toEqual([])
})

test('existing visible provider messages cannot consume a newly-created identical send', () => {
  const earlier = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'same' })
  const oldEcho = providerMessage(earlier, 'already-visible')
  const pending = createPendingMessage({
    account: kickAccount,
    channelId: '3195252',
    text: 'same',
    providerMessages: [oldEcho],
  })
  const messages = [pending]
  expect(reconcilePendingMessages(messages, [oldEcho])).toBe(messages)
  expect(
    reconcilePendingMessages(messages, [oldEcho, providerMessage(pending, 'new-echo')]),
  ).toEqual([])
})

test('explicit acknowledgement IDs take priority over earlier same-text sends without acknowledgements', () => {
  const first = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'same' })
  const second = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'same' })
  const acknowledged = confirmDelivery([first, second], second.id, {
    channelId: '3195252',
    messageId: 'second-provider',
  })
  const actualSecond = providerMessage(second, 'second-provider')
  const retained = reconcilePendingMessages(acknowledged, [actualSecond])
  expect(retained).toHaveLength(1)
  expect(retained[0]?.id).toBe(first.id)
  expect(reconcilePendingMessages(retained, [actualSecond])).toBe(retained)
  const firstAcknowledged = confirmDelivery(retained, first.id, {
    channelId: '3195252',
    messageId: 'first-provider',
  })
  expect(
    reconcilePendingMessages(firstAcknowledged, [
      actualSecond,
      providerMessage(first, 'first-provider'),
    ]),
  ).toEqual([])
})

test('a Twitch history replacement matches the original receipt and stays reserved for that send', () => {
  const first = createPendingMessage({ account: twitchAccount, channelId: 'viewer', text: 'same' })
  const second = createPendingMessage({ account: twitchAccount, channelId: 'viewer', text: 'same' })
  const localTwitchEchoId = 'local:twitch:viewer:second'
  const confirmed = confirmDelivery([first, second], second.id, {
    channelId: 'viewer',
    messageId: localTwitchEchoId,
  })
  const replacement = { ...providerMessage(second, 'canonical-second'), localTwitchEchoId }
  const retained = reconcilePendingMessages(confirmed, [replacement])
  expect(retained.map(({ id }) => id)).toEqual([first.id])
  expect(reconcilePendingMessages(retained, [replacement])).toBe(retained)
})

test('fallback matching keeps text, author, platform, reply and channel identity exact and bounds its time window', () => {
  const pending = createPendingMessage({ account: kickAccount, channelId: '3195252', text: 'Test' })
  const original = providerMessage(pending, 'candidate')
  const variants: NormalizedChatMessage[] = [
    { ...original, text: 'test' },
    { ...original, text: 'Test ' },
    { ...original, author: { ...original.author, id: 'another-author' } },
    { ...original, platform: 'twitch' },
    { ...original, channelId: 'another-channel' },
    { ...original, timestamp: new Date(pending.timestamp.getTime() + 31_000) },
    {
      ...original,
      reply: {
        parentMessageId: 'a-parent',
        parentMessageText: 'parent',
        parentAuthor: { id: 'parent-author', username: 'parent', displayName: 'Parent' },
      },
    },
  ]
  const messages = [pending]
  for (const variant of variants)
    expect(reconcilePendingMessages(messages, [variant])).toBe(messages)
  expect(reconcilePendingMessages(messages, [original])).toEqual([])
})

test('remaining optimistic and failed messages keep their chronological position as later traffic arrives', () => {
  const pending = createPendingMessage({
    account: kickAccount,
    channelId: '3195252',
    text: 'pending',
  })
  const failed = required(failDelivery([pending], pending.id, 'Rejected')[0])
  const older = {
    ...providerMessage(pending, 'older'),
    timestamp: new Date(pending.timestamp.getTime() - 1000),
  }
  const newer = {
    ...providerMessage(pending, 'newer'),
    timestamp: new Date(pending.timestamp.getTime() + 1000),
  }
  const merged = appendLiveChatMessages([older, newer], [failed], 0)
  expect(merged).toEqual([older, failed, newer])
  expect(merged[1]).toBe(failed)
  expect(merged[2]).toBe(newer)
})
