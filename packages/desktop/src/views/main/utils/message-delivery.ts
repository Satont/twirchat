import type { Account, NormalizedChatMessage, Platform } from '@twirchat/shared/types'

export type DeliveryState = 'pending' | 'confirmed' | 'failed'

export interface DeliveryMessage extends NormalizedChatMessage {
  delivery?: {
    state: DeliveryState
    error?: string
  }
}

export interface PendingMessageInput {
  account: Account
  channelId: string
  reply?: NormalizedChatMessage['reply']
  text: string
}

// Provider timestamps are rounded and may arrive a few seconds behind the
// desktop clock. Older history, however, must never consume a newly-created
// local echo that happens to have the same text.
const providerEchoClockSkewMs = 10_000

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function sendablePlatform(platform: Platform): Extract<Platform, 'twitch' | 'kick'> {
  if (platform !== 'twitch' && platform !== 'kick') {
    throw new Error(`create pending message: ${platform} does not support chat sending`)
  }
  return platform
}

export function createPendingMessage(input: PendingMessageInput): DeliveryMessage {
  const platform = sendablePlatform(input.account.platform)
  const channelId = normalize(input.channelId)
  if (!channelId) {
    throw new Error('create pending message: channel is required')
  }

  return {
    id: `pending:${platform}:${channelId}:${crypto.randomUUID()}`,
    platform,
    channelId,
    author: {
      id: input.account.platformUserId,
      username: input.account.username,
      displayName: input.account.displayName,
      avatarUrl: input.account.avatarUrl,
      badges: [],
    },
    text: input.text,
    emotes: [],
    timestamp: new Date(),
    type: 'message',
    reply: input.reply,
    delivery: { state: 'pending' },
  }
}

export function confirmDelivery(messages: DeliveryMessage[], id: string): DeliveryMessage[] {
  return messages.map((message) =>
    message.id === id ? { ...message, delivery: { state: 'confirmed' } } : message,
  )
}

export function failDelivery(
  messages: DeliveryMessage[],
  id: string,
  error: string,
): DeliveryMessage[] {
  return messages.map((message) =>
    message.id === id ? { ...message, delivery: { state: 'failed', error } } : message,
  )
}

function matchesProviderMessage(local: DeliveryMessage, provider: NormalizedChatMessage): boolean {
  return (
    local.delivery?.state !== 'failed' &&
    local.platform === provider.platform &&
    normalize(local.channelId) === normalize(provider.channelId) &&
    normalize(local.text) === normalize(provider.text) &&
    local.author.id !== '' &&
    local.author.id === provider.author.id &&
    provider.timestamp.getTime() >= local.timestamp.getTime() - providerEchoClockSkewMs
  )
}

// Provider messages are the durable source of truth. Once one arrives for a
// confirmed local echo, remove the in-memory echo so the virtual list cannot
// display a duplicate. Failed messages intentionally remain for their reason.
export function reconcilePendingMessages(
  pending: DeliveryMessage[],
  providerMessages: NormalizedChatMessage[],
): DeliveryMessage[] {
  return pending.filter(
    (local) => !providerMessages.some((provider) => matchesProviderMessage(local, provider)),
  )
}
