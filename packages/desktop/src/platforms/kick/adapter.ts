import { KICK_API_BASE } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type {
  Account,
  ChatSendReceipt,
  Emote,
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import { z } from 'zod'

import { refreshKickToken } from '../../auth/kick'
import { t } from '../../gpuix/i18n'
import { backendFetch } from '../../runtime-config'
import { AccountStore } from '../../store/account-store'
import { BasePlatformAdapter, type ChatReplyTarget } from '../base-adapter'
import { resolveKickAvatarUrl, type KickAvatarResolver } from './avatar-cache'
import { kickBadgeCatalog } from './badge-catalog'
import {
  kickBadgeIdentitySchema,
  normalizeKickBadges,
  type KickBadgeIdentity,
  type KickSubscriberBadge,
} from './badge-data'
import {
  discoverKickRealtime,
  requestKickRealtimeToken,
  KickRealtimeSession,
  KickConnectionError,
  type KickRealtimeEvent,
  type KickRealtimeDependencies,
} from './realtime'
import { createKickSocket } from './socket.js'
export type { KickSocket, KickSocketEvents } from './realtime'
import {
  kickBackendFailure,
  kickReconnectDelay,
  kickRetryClock,
  type KickRetryClock,
} from './retry'

const log = logger('kick')

// ============================================================
// Kick realtime events
// ============================================================

export interface KickChatMessage {
  id: string
  chatroom_id: number
  content: string
  type: 'message' | 'reply'
  created_at: string
  sender: {
    id: number
    username: string
    slug: string
    identity: KickBadgeIdentity & {
      color: string
    }
    profile_picture?: string
  }
  metadata?: z.output<typeof kickMessageMetadataSchema>
}

interface KickFollowEvent {
  channel_id: number
  user_id: number
  username: string
  display_name: string
  avatar_url?: string
  followed_at: string
}

interface KickSubscriptionEvent {
  channel_id: number
  user_id: number
  username: string
  display_name: string
  avatar_url?: string
  gifted_by?: string
  duration?: number
  created_at: string
}

export interface KickSendBody {
  broadcaster_user_id: number
  content: string
  type: 'user'
  reply_to_message_id?: string
}
export interface KickAdapterDependencies extends KickRealtimeDependencies {
  account(): Pick<Account, 'id'> | null
  tokens: typeof AccountStore.getTokens
  refreshToken: typeof refreshKickToken
  chatroom(
    channel: string,
    signal: AbortSignal,
  ): Promise<{
    chatroomId: number
    broadcasterUserId: number
    subscriberBadges?: KickSubscriberBadge[]
  }>
  send(body: KickSendBody, token: string, signal: AbortSignal): Promise<Response>
  clock: KickRetryClock
}

const kickSendAcknowledgementSchema = z.object({
  data: z.object({ is_sent: z.boolean().optional(), message_id: z.string().min(1).optional() }),
})

function kickSendBody(
  broadcasterUserId: number,
  text: string,
  replyTo?: ChatReplyTarget,
): KickSendBody {
  const replyToMessageId = typeof replyTo === 'string' ? replyTo : replyTo?.parentMessageId
  return {
    broadcaster_user_id: broadcasterUserId,
    content: text,
    type: 'user',
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  }
}

function kickSendReceipt(payload: unknown, body: KickSendBody): ChatSendReceipt {
  const acknowledgement = kickSendAcknowledgementSchema.safeParse(payload)
  if (!acknowledgement.success) throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
  if (acknowledgement.data.data.is_sent === false) throw new Error(t('misc.kickAdapter.notSent'))
  if (acknowledgement.data.data.is_sent !== true && !acknowledgement.data.data.message_id)
    throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
  return {
    channelId: String(body.broadcaster_user_id),
    messageId: acknowledgement.data.data.message_id,
  }
}

const defaultDependencies: KickAdapterDependencies = {
  account: () => AccountStore.findByPlatform('kick'),
  tokens: (id) => AccountStore.getTokens(id),
  refreshToken: refreshKickToken,
  async chatroom(channel, signal) {
    const [response, subscriberBadges] = await Promise.all([
      backendFetch(`/api/kick/chatroom?slug=${encodeURIComponent(channel)}`, { signal }),
      kickBadgeCatalog.load(channel),
    ])
    if (!response.ok)
      throw new KickConnectionError(t('misc.kickAdapter.chatroomHttp', { status: response.status }))
    const parsed = z
      .object({
        chatroomId: z.number().int().positive().optional(),
        broadcasterUserId: z.number().int().positive().optional(),
        error: z.string().optional(),
      })
      .safeParse(await response.json())
    if (
      !parsed.success ||
      parsed.data.error ||
      !parsed.data.chatroomId ||
      !parsed.data.broadcasterUserId
    )
      throw new KickConnectionError(t('misc.kickAdapter.chatroomInvalid'))
    return {
      chatroomId: parsed.data.chatroomId,
      broadcasterUserId: parsed.data.broadcasterUserId,
      subscriberBadges,
    }
  },
  discover: discoverKickRealtime,
  token: requestKickRealtimeToken,
  socket: createKickSocket,
  send: (body, token, signal) =>
    fetch(`${KICK_API_BASE}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }),
  clock: kickRetryClock,
}

export class KickAdapter extends BasePlatformAdapter {
  readonly platform = 'kick'
  private realtime: KickRealtimeSession | null = null
  private cancelTimer?: () => void
  private timerGeneration = 0
  private channelSlug = ''
  private broadcasterUserId: number | null = null
  private subscriberBadges: KickSubscriberBadge[] = []
  private isConnected = false
  private shouldReconnect = false
  private accessToken: string | null = null
  private expiresAt?: number
  private rejectedToken?: { accountId: string; accessToken: string }
  private accountId: string | null = null
  private messageQueue: Promise<void> = Promise.resolve()
  private identityRevision = 0
  private identityAbort = new AbortController()
  private connectionAttempt?: Promise<void>
  private failures = 0
  private retryIdentity = ''
  private connectionStatus: PlatformStatusInfo['status'] = 'disconnected'
  private connectionError?: string
  private authenticationError?: string

  constructor(private readonly dependencies: KickAdapterDependencies = defaultDependencies) {
    super()
  }

  connect(channelSlug: string): Promise<void> {
    channelSlug = channelSlug.trim().replace(/^#/, '').toLowerCase()
    const account = this.dependencies.account()
    const accountId = account?.id ?? null
    if (this.connectionAttempt && this.channelSlug === channelSlug && this.accountId === accountId)
      return this.connectionAttempt
    const revision = ++this.identityRevision
    this.identityAbort.abort()
    this.identityAbort = new AbortController()
    this.clearTimers()
    this.closeSocket()
    this.shouldReconnect = true
    this.channelSlug = channelSlug
    this.accountId = accountId
    this.broadcasterUserId = null
    this.subscriberBadges = []
    this.isConnected = false
    this.accessToken = null
    this.expiresAt = undefined
    this.connectionError = undefined
    this.authenticationError = undefined
    this.messageQueue = Promise.resolve()
    const retryIdentity = JSON.stringify([channelSlug, accountId])
    if (retryIdentity !== this.retryIdentity) {
      this.failures = 0
      this.retryIdentity = retryIdentity
    }
    this.connectionStatus = 'connecting'
    if (accountId) {
      const tokens = this.dependencies.tokens(accountId)
      this.applyTokens(tokens)
      if (tokens && (this.expiring(tokens) || !this.usable(tokens)))
        this.refreshAuthentication(revision, true)
    }
    return this.startAttempt(revision)
  }

  getBroadcasterUserId(): number | null {
    return this.broadcasterUserId
  }

  async disconnect(): Promise<void> {
    this.identityRevision++
    this.shouldReconnect = false
    this.identityAbort.abort()
    this.clearTimers()
    this.closeSocket()
    this.accountId = null
    this.accessToken = null
    this.expiresAt = undefined
    this.authenticationError = undefined
    this.connectionError = undefined
    this.isConnected = false
    this.connectionAttempt = undefined
    this.publishStatus('disconnected')
  }

  private current(revision: number): boolean {
    return revision === this.identityRevision && this.shouldReconnect
  }
  private selected(): boolean {
    return (this.dependencies.account()?.id ?? null) === this.accountId
  }
  private assertIdentity(revision: number, delivered = false): void {
    if (!this.current(revision) || !this.selected())
      throw new Error(
        delivered
          ? t('misc.kickAdapter.accountChangedDelivered')
          : t('misc.kickAdapter.accountChanged'),
      )
  }
  private usable(tokens: { accessToken: string; expiresAt?: number } | null): boolean {
    return (
      Boolean(tokens?.accessToken) &&
      !(
        this.rejectedToken?.accountId === this.accountId &&
        this.rejectedToken?.accessToken === tokens?.accessToken
      ) &&
      (tokens?.expiresAt === undefined ||
        tokens.expiresAt > Math.floor(this.dependencies.clock.now() / 1000))
    )
  }
  private expiring(tokens: { expiresAt?: number }): boolean {
    return (
      tokens.expiresAt !== undefined &&
      tokens.expiresAt <= Math.floor(this.dependencies.clock.now() / 1000) + 300
    )
  }
  private applyTokens(tokens: { accessToken: string; expiresAt?: number } | null): void {
    this.accessToken = this.usable(tokens) && tokens ? tokens.accessToken : null
    this.expiresAt = tokens?.expiresAt
  }
  private publishStatus(status: PlatformStatusInfo['status'] = this.connectionStatus): void {
    this.connectionStatus = status
    this.emit('status', {
      channelLogin: this.channelSlug,
      channelId: this.broadcasterUserId ? String(this.broadcasterUserId) : undefined,
      platform: 'kick',
      status,
      mode: this.usable(
        this.accessToken ? { accessToken: this.accessToken, expiresAt: this.expiresAt } : null,
      )
        ? 'authenticated'
        : 'anonymous',
      error: this.connectionError ?? this.authenticationError,
    })
  }
  private refreshAuthentication(revision: number, manual: boolean): void {
    const accountId = this.accountId
    if (!accountId) return
    this.dependencies
      .refreshToken(accountId, { channelSlug: this.channelSlug, manual })
      .then(() => {
        if (!this.current(revision) || !this.selected()) return
        const tokens = this.dependencies.tokens(accountId)
        if (!this.usable(tokens)) throw new Error(t('misc.kickAdapter.credentialsAfterRefresh'))
        this.applyTokens(tokens)
        this.authenticationError = undefined
        this.publishStatus()
      })
      .catch((error: unknown) => {
        if (!this.current(revision) || !this.selected()) return
        this.applyTokens(this.dependencies.tokens(accountId))
        this.authenticationError =
          error instanceof Error ? error.message : t('misc.kickAdapter.authUnavailableSignIn')
        this.publishStatus()
      })
  }
  private async sendToken(revision: number, force: boolean): Promise<string> {
    this.assertIdentity(revision)
    const accountId = this.accountId
    if (!accountId) throw new Error(t('misc.kickAdapter.signInBeforeSending'))
    let tokens = this.dependencies.tokens(accountId)
    if (!force && this.usable(tokens) && tokens && !this.expiring(tokens)) {
      this.applyTokens(tokens)
      return tokens.accessToken
    }
    try {
      await this.dependencies.refreshToken(accountId, { channelSlug: this.channelSlug })
      this.assertIdentity(revision)
      tokens = this.dependencies.tokens(accountId)
      if (!this.usable(tokens) || !tokens)
        throw new Error(t('misc.kickAdapter.credentialsUnavailable'))
      this.applyTokens(tokens)
      this.authenticationError = undefined
      this.publishStatus()
      return tokens.accessToken
    } catch (error) {
      this.assertIdentity(revision)
      tokens = this.dependencies.tokens(accountId)
      this.applyTokens(tokens)
      this.authenticationError =
        error instanceof Error ? error.message : t('misc.kickAdapter.authUnavailable')
      this.publishStatus()
      if (!force && tokens && this.usable(tokens)) return tokens.accessToken
      throw error
    }
  }

  private rejectToken(token: string): void {
    if (this.accountId) this.rejectedToken = { accountId: this.accountId, accessToken: token }
    this.accessToken = null
    this.authenticationError = t('misc.kickAdapter.credentialsRejected')
    this.publishStatus()
  }

  private async deliver(body: KickSendBody, token: string, revision: number): Promise<Response> {
    const signal = AbortSignal.any([this.identityAbort.signal, AbortSignal.timeout(15000)])
    try {
      return await this.dependencies.send(body, token, signal)
    } catch {
      this.assertIdentity(revision, true)
      throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
    }
  }

  async sendMessage(
    _channelId: string,
    text: string,
    replyTo?: ChatReplyTarget,
  ): Promise<ChatSendReceipt> {
    const revision = this.identityRevision
    if (!this.broadcasterUserId) throw new Error(t('misc.kickAdapter.channelNotReady'))
    const body = kickSendBody(this.broadcasterUserId, text, replyTo)
    let token = await this.sendToken(revision, false)
    this.assertIdentity(revision)
    let response = await this.deliver(body, token, revision)
    this.assertIdentity(revision, true)
    if (response.status === 401) {
      this.rejectToken(token)
      token = await this.sendToken(revision, true)
      this.assertIdentity(revision)
      response = await this.deliver(body, token, revision)
      this.assertIdentity(revision, true)
    }
    if (response.status === 401) this.rejectToken(token)
    if (!response.ok)
      throw new Error(t('misc.kickAdapter.messageRejectedHttp', { status: response.status }))
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      this.assertIdentity(revision, true)
      throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
    }
    this.assertIdentity(revision, true)
    return kickSendReceipt(payload, body)
  }

  /**
   * Sends with another saved Kick account while this chat keeps reading with its own identity.
   * Kick broadcasts the message back over the chat's socket like any other viewer's message.
   */
  async sendMessageAs(
    account: Pick<Account, 'id' | 'username'>,
    text: string,
    replyTo?: ChatReplyTarget,
  ): Promise<ChatSendReceipt> {
    if (!this.broadcasterUserId) throw new Error(t('misc.kickAdapter.channelNotReady'))
    const body = kickSendBody(this.broadcasterUserId, text, replyTo)
    const deliver = async (refresh: boolean): Promise<Response> => {
      let tokens = this.dependencies.tokens(account.id)
      if (refresh || !tokens?.accessToken || this.expiring(tokens)) {
        await this.dependencies.refreshToken(account.id, { channelSlug: this.channelSlug })
        tokens = this.dependencies.tokens(account.id)
      }
      if (!tokens?.accessToken)
        throw new Error(t('misc.kickAdapter.signInAsAgain', { name: account.username }))
      try {
        return await this.dependencies.send(body, tokens.accessToken, AbortSignal.timeout(15000))
      } catch {
        throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
      }
    }
    let response = await deliver(false)
    if (response.status === 401) response = await deliver(true)
    if (!response.ok)
      throw new Error(
        t('misc.kickAdapter.messageRejectedFrom', {
          name: account.username,
          status: response.status,
        }),
      )
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(t('misc.kickAdapter.deliveryUnconfirmed'))
    }
    return kickSendReceipt(payload, body)
  }

  private closeSocket(): void {
    const session = this.realtime
    this.realtime = null
    session?.close()
  }
  private startAttempt(revision: number): Promise<void> {
    const controller = new AbortController()
    const signal = AbortSignal.any([this.identityAbort.signal, controller.signal])
    this.scheduleTimer(revision, 15000, () => {
      controller.abort(new KickConnectionError('Kick connection timed out.'))
    })
    const attempt = Promise.resolve()
      .then(() => this.runAttempt(revision, signal))
      .finally(() => {
        if (this.connectionAttempt === attempt) this.connectionAttempt = undefined
      })
    this.connectionAttempt = attempt
    return attempt
  }
  private async runAttempt(revision: number, signal: AbortSignal): Promise<void> {
    if (!this.current(revision) || !this.selected()) return
    this.connectionError = undefined
    this.publishStatus('connecting')
    if (!this.current(revision) || !this.selected()) return
    try {
      const info = await this.dependencies.chatroom(this.channelSlug, signal)
      if (!this.current(revision) || !this.selected()) return
      if (signal.aborted) throw signal.reason
      this.broadcasterUserId = info.broadcasterUserId
      this.subscriberBadges = info.subscriberBadges ?? []
      const session = new KickRealtimeSession({
        chatroomId: info.chatroomId,
        signal,
        dependencies: this.dependencies,
        event: (event) => {
          if (!this.current(revision) || !this.selected()) return
          try {
            this.handleRealtimeEvent(event)
          } catch {
            log.warn('Invalid Kick chat event', { channel: this.channelSlug, event: event.event })
          }
        },
        disconnected: (error) => {
          if (this.current(revision) && this.selected())
            this.connectionFailed(error.message, revision)
        },
      })
      this.realtime = session
      await session.ready
      if (this.current(revision) && this.selected() && this.realtime === session)
        this.emitConnected()
    } catch (error) {
      if (!this.current(revision) || !this.selected()) return
      this.connectionFailed(
        error instanceof KickConnectionError ? error.message : kickBackendFailure(error),
        revision,
      )
    }
  }

  private handleRealtimeEvent(event: KickRealtimeEvent): void {
    switch (event.event) {
      case String.raw`App\Events\ChatMessageEvent`: {
        const data = kickPayload1Schema.parse(
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
        )
        const revision = this.identityRevision
        this.messageQueue = this.messageQueue
          .then(() => this.handleChatMessage(data, revision))
          .catch(() => {
            if (this.current(revision))
              log.warn('Kick message processing failed', { channel: this.channelSlug })
          })
        break
      }

      case String.raw`App\Events\FollowersUpdated`: {
        const data = kickPayload2Schema.parse(
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
        )
        this.handleFollowEvent(data)
        break
      }

      case String.raw`App\Events\SubscriptionEvent`: {
        const data = kickPayload3Schema.parse(
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
        )
        this.handleSubscriptionEvent(data)
        break
      }

      default: {
        break
      }
    }
  }

  private async handleChatMessage(msg: KickChatMessage, revision: number): Promise<void> {
    if (!this.current(revision)) return
    const normalized = await normalizeKickChatMessage(
      msg,
      this.broadcasterUserId,
      resolveKickAvatarUrl,
      this.subscriberBadges,
    )
    if (!this.current(revision)) return
    this.emit('message', normalized)
  }

  private handleFollowEvent(event: KickFollowEvent): void {
    const normalized: NormalizedEvent = {
      data: { channelId: event.channel_id },
      id: `kick:follow:${event.user_id}:${event.followed_at}`,
      platform: 'kick',
      timestamp: new Date(event.followed_at),
      type: 'follow',
      user: {
        avatarUrl: event.avatar_url,
        displayName: event.display_name || event.username,
        id: String(event.user_id),
      },
    }

    this.emit('event', normalized)
  }

  private handleSubscriptionEvent(event: KickSubscriptionEvent): void {
    const isGift = Boolean(event.gifted_by)

    const normalized: NormalizedEvent = {
      data: {
        channelId: event.channel_id,
        duration: event.duration,
        giftedBy: event.gifted_by,
      },
      id: `kick:sub:${event.user_id}:${event.created_at}`,
      platform: 'kick',
      timestamp: new Date(event.created_at),
      type: isGift ? 'gift_sub' : 'sub',
      user: {
        avatarUrl: event.avatar_url,
        displayName: event.display_name || event.username,
        id: String(event.user_id),
      },
    }

    this.emit('event', normalized)
  }

  private clearTimers(): void {
    this.timerGeneration++
    const cancel = this.cancelTimer
    this.cancelTimer = undefined
    cancel?.()
  }

  private scheduleTimer(revision: number, delay: number, callback: () => void): void {
    if (!this.current(revision)) return
    this.clearTimers()
    const generation = this.timerGeneration
    this.cancelTimer = this.dependencies.clock.schedule(() => {
      if (generation !== this.timerGeneration || !this.current(revision)) return
      this.cancelTimer = undefined
      callback()
    }, delay)
  }

  private connectionFailed(message: string, revision: number): void {
    if (!this.current(revision) || !this.selected()) return
    this.clearTimers()
    this.closeSocket()
    this.isConnected = false
    this.connectionError = message
    this.publishStatus('error')
    if (!this.current(revision) || !this.selected()) return
    this.failures = Math.min(this.failures + 1, 5)
    const retryMs = kickReconnectDelay(this.failures)
    log.warn('Kick connection attempt failed', {
      channel: this.channelSlug,
      error: message,
      retryMs,
    })
    this.scheduleTimer(revision, retryMs, () => {
      if (!this.selected()) return
      if (this.accountId) {
        const tokens = this.dependencies.tokens(this.accountId)
        this.applyTokens(tokens)
        if (tokens && (this.expiring(tokens) || !this.usable(tokens)))
          this.refreshAuthentication(revision, false)
      }
      this.startAttempt(revision).catch((error: unknown) => {
        if (this.current(revision)) this.connectionFailed(kickBackendFailure(error), revision)
      })
    })
  }

  private emitConnected(): void {
    this.isConnected = true
    this.failures = 0
    this.connectionError = undefined
    this.clearTimers()
    this.publishStatus('connected')
  }
}

export async function normalizeKickChatMessage(
  msg: KickChatMessage,
  broadcasterUserId: number | null,
  resolveAvatar: KickAvatarResolver = resolveKickAvatarUrl,
  subscriberBadges: readonly KickSubscriberBadge[] = [],
): Promise<NormalizedChatMessage> {
  const badges = normalizeKickBadges(msg.sender.identity, subscriberBadges)

  // Parse Kick emotes from content
  // Format: [emote:37232:PeepoClap]
  const emotes: Emote[] = []
  const emoteRegex = /\[emote:(\d+):([^\]]+)\]/g
  let match
  let cleanText = msg.content
  let offsetDelta = 0

  while ((match = emoteRegex.exec(msg.content)) !== null) {
    const [fullMatch, emoteId, emoteName] = match
    if (!emoteId || !emoteName) {
      continue
    }
    const originalStart = match.index
    // Calculate position in clean text (after removing emote tags)
    const cleanStart = originalStart - offsetDelta
    const cleanEnd = cleanStart + emoteName.length - 1

    emotes.push({
      id: emoteId,
      imageUrl: `https://files.kick.com/emotes/${emoteId}/fullsize`,
      name: emoteName,
      positions: [{ start: cleanStart, end: cleanEnd }],
    })

    // Update offset for next matches
    offsetDelta += fullMatch.length - emoteName.length
  }

  // Remove emote tags from text, leaving just the name
  cleanText = msg.content.replace(/\[emote:\d+:([^\]]+)\]/g, '$1')

  const avatarUrl = await resolveAvatar({
    authorId: String(msg.sender.id),
    lookupSource: msg.sender.slug ? 'slug' : 'username',
    profilePicture: msg.sender.profile_picture,
    slugOrUsername: msg.sender.slug || msg.sender.username,
  })

  return {
    author: {
      avatarUrl,
      badges,
      color: msg.sender.identity.color || undefined,
      displayName: msg.sender.username,
      id: String(msg.sender.id),
      username: msg.sender.username,
    },
    channelId: String(broadcasterUserId ?? msg.chatroom_id),
    emotes,
    id: msg.id,
    platform: 'kick',
    text: cleanText,
    timestamp: new Date(msg.created_at),
    type: 'message',
    ...(msg.type === 'reply' && msg.metadata?.original_sender && msg.metadata.original_message
      ? {
          reply: {
            parentAuthor: {
              displayName: msg.metadata.original_sender.username,
              id: msg.metadata.original_sender.id,
              username: msg.metadata.original_sender.username,
            },
            parentMessageId: msg.metadata.original_message.id,
            parentMessageText: msg.metadata.original_message.content,
          },
        }
      : {}),
  }
}

const kickReplySenderIdSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String)

const kickMessageMetadataSchema = z.preprocess(
  (value: unknown) => {
    if (typeof value !== 'string') return value
    try {
      const decoded: unknown = JSON.parse(value)
      return decoded
    } catch {
      return null
    }
  },
  z.object({
    message_ref: z.string().optional(),
    original_sender: z.object({ id: kickReplySenderIdSchema, username: z.string() }).optional(),
    original_message: z.object({ id: z.string(), content: z.string() }).optional(),
  }),
)

const kickPayload1Schema = z.object({
  id: z.string(),
  chatroom_id: z.number(),
  content: z.string(),
  type: z.union([z.literal('message'), z.literal('reply')]),
  created_at: z.string(),
  sender: z.object({
    id: z.number(),
    username: z.string(),
    slug: z.string(),
    identity: kickBadgeIdentitySchema,
    profile_picture: z.string().optional(),
  }),
  metadata: kickMessageMetadataSchema.optional(),
})
const kickPayload2Schema = z.object({
  channel_id: z.number(),
  user_id: z.number(),
  username: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  followed_at: z.string(),
})
const kickPayload3Schema = z.object({
  channel_id: z.number(),
  user_id: z.number(),
  username: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  gifted_by: z.string().optional(),
  duration: z.number().optional(),
  created_at: z.string(),
})
