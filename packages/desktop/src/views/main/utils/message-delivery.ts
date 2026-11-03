import type {
  Account,
  ChatSendReceipt,
  NormalizedChatMessage,
  Platform,
} from '@twirchat/shared/types'

export type DeliveryState = 'pending' | 'confirmed' | 'failed'

export interface DeliveryMessage extends NormalizedChatMessage {
  delivery?: {
    state: DeliveryState
    error?: string
    providerMessageId?: string
    excludedProviderKeys?: readonly string[]
    scope?: string
  }
}

export interface PendingMessageInput {
  account: Account
  channelId: string
  reply?: NormalizedChatMessage['reply']
  text: string
  providerMessages?: readonly NormalizedChatMessage[]
  scope?: string
}

const providerEchoClockSkewMs = 10_000
const providerEchoWindowMs = 30_000

function normalize(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

function providerKey(message: NormalizedChatMessage): string {
  return JSON.stringify([message.platform, normalize(message.channelId), message.id])
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
    delivery: {
      state: 'pending',
      ...(input.providerMessages?.length
        ? { excludedProviderKeys: input.providerMessages.map(providerKey) }
        : {}),
      ...(input.scope ? { scope: input.scope } : {}),
    },
  }
}

export function confirmDelivery(
  messages: DeliveryMessage[],
  id: string,
  receipt?: void | ChatSendReceipt,
): DeliveryMessage[] {
  if (!messages.some((message) => message.id === id)) return messages
  return messages.map((message) =>
    message.id === id
      ? {
          ...message,
          channelId: receipt?.channelId ?? message.channelId,
          delivery: {
            ...message.delivery,
            state: 'confirmed',
            ...(receipt?.messageId ? { providerMessageId: receipt.messageId } : {}),
          },
        }
      : message,
  )
}

export function failDelivery(
  messages: DeliveryMessage[],
  id: string,
  error: string,
): DeliveryMessage[] {
  if (!messages.some((message) => message.id === id)) return messages
  return messages.map((message) =>
    message.id === id
      ? { ...message, delivery: { ...message.delivery, state: 'failed', error } }
      : message,
  )
}

function matchesProviderMessage(local: DeliveryMessage, provider: NormalizedChatMessage): boolean {
  if (
    local.delivery?.state === 'failed' ||
    local.platform !== provider.platform ||
    normalize(local.channelId) !== normalize(provider.channelId) ||
    !local.author.id ||
    local.author.id !== provider.author.id
  )
    return false
  if (local.delivery?.providerMessageId) return local.delivery.providerMessageId === provider.id
  const sentText =
    local.platform === 'kick' ? local.text.replace(/\[emote:\d+:([^\]]+)\]/g, '$1') : local.text
  const elapsed = provider.timestamp.getTime() - local.timestamp.getTime()
  return (
    sentText === provider.text &&
    local.reply?.parentMessageId === provider.reply?.parentMessageId &&
    elapsed >= -providerEchoClockSkewMs &&
    elapsed <= providerEchoWindowMs
  )
}

// Consume provider echoes once, including across later batches. A newly-created
// send also excludes the provider messages that were already visible at creation.
export function reconcilePendingMessages(
  pending: DeliveryMessage[],
  providerMessages: NormalizedChatMessage[],
): DeliveryMessage[] {
  if (pending.length === 0 || providerMessages.length === 0) return pending
  const providers = providerMessages.map((message) => ({ message, key: providerKey(message) }))
  const reserved = new Set(
    pending.flatMap((message) =>
      message.delivery?.providerMessageId && message.delivery.state !== 'failed'
        ? [providerKey({ ...message, id: message.delivery.providerMessageId })]
        : [],
    ),
  )
  const consumed = new Set<string>()
  const retained: DeliveryMessage[] = []
  for (const local of pending) {
    if (local.delivery?.state === 'failed') {
      retained.push(local)
      continue
    }
    const excluded = new Set(local.delivery?.excludedProviderKeys)
    const provider = providers.find(
      (candidate) =>
        !consumed.has(candidate.key) &&
        !excluded.has(candidate.key) &&
        (!reserved.has(candidate.key) ||
          local.delivery?.providerMessageId === candidate.message.id) &&
        matchesProviderMessage(local, candidate.message),
    )
    if (provider) consumed.add(provider.key)
    else retained.push(local)
  }
  if (retained.length === pending.length) return pending
  return retained.map((local) => {
    const reused = providers.filter(
      (provider) =>
        consumed.has(provider.key) &&
        !local.delivery?.excludedProviderKeys?.includes(provider.key) &&
        matchesProviderMessage(local, provider.message),
    )
    if (reused.length === 0) return local
    return {
      ...local,
      delivery: {
        ...local.delivery,
        state: local.delivery?.state ?? 'pending',
        excludedProviderKeys: [
          ...(local.delivery?.excludedProviderKeys ?? []),
          ...reused.map((provider) => provider.key),
        ],
      },
    }
  })
}
