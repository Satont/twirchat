import type {
  TwitchActivityEvent,
  TwitchEventSubStatus,
  TwitchEventSubscription,
  TwitchWhisper,
} from '@twirchat/shared/twitch-activities'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { runInBackground } from './background-task'
import { deleteOldestEntry } from './bounded-cache'
import {
  buildTwitchAutoModSenderNotice,
  parseTwitchAutoModEvent,
  type TwitchAutoModEvent,
} from './twitch-automod'
import { buildTwitchModerationNotice } from './twitch-moderation-notice'

export interface EventSubSocket {
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close(code?: number, reason?: string): void
}

export interface TwitchEventSubDependencies {
  hasAccount(): boolean
  senderUserId?: string
  receiveWhispers?: boolean
  socket?(url: string): EventSubSocket
  subscribe(
    sessionId: string,
    channelSlug?: string,
  ): Promise<{ subscriptions: TwitchEventSubscription[]; errors: string[] }>
  unsubscribe(ids: string[]): Promise<void>
  activity(event: TwitchActivityEvent): void
  autoMod(event: TwitchAutoModEvent): void
  senderNotice?(message: NormalizedChatMessage): void
  moderationNotice?(message: NormalizedChatMessage): void
  whisper(event: TwitchWhisper): void
  status(status: TwitchEventSubStatus): void
  reconnectDelayMs?: number
}

const sessionSchema = z.object({
  id: z.string().optional(),
  keepalive_timeout_seconds: z.number().nullish(),
  reconnect_url: z.string().nullish(),
})

type Envelope = {
  metadata?: {
    message_type?: string
    message_id?: string
    message_timestamp?: string
    subscription_type?: string
  }
  payload?: {
    session?: z.infer<typeof sessionSchema>
    subscription?: { id?: string; type?: string; status?: string }
    event?: Record<string, unknown>
  }
}
const SOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws'

/** One connection per account. Server migrations retain subscriptions; ordinary disconnects rebuild them. */
export class TwitchEventSubClient {
  private socket: EventSubSocket | null = null
  private replacement: EventSubSocket | null = null
  private sessionId: string | null = null
  private channels = new Map<string, number>()
  private subscriptions = new Map<string, string[]>()
  private registering = new Map<string, symbol>()
  private unregistering = new Map<string, Promise<void>>()
  private seenMessages = new Set<string>()
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private keepaliveTimer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private stopped = true
  private reconnectAttempts = 0

  constructor(private readonly dependencies: TwitchEventSubDependencies) {}

  start(): void {
    if (!this.stopped) return
    if (!this.dependencies.hasAccount()) return
    this.stopped = false
    this.connect(SOCKET_URL)
  }

  restart(): void {
    this.stop()
    this.start()
  }

  stop(): void {
    this.stopped = true
    this.generation++
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.keepaliveTimer)
    this.reconnectTimer = undefined
    this.keepaliveTimer = undefined
    const sockets = [this.socket, this.replacement]
    this.socket = null
    this.replacement = null
    for (const socket of sockets) socket?.close()
    this.sessionId = null
    this.subscriptions.clear()
    this.registering.clear()
    this.unregistering.clear()
    this.seenMessages.clear()
    this.clearAutoMod()
    this.dependencies.status({ status: 'disconnected' })
  }

  async watch(channelSlug: string, watch: boolean): Promise<void> {
    const key = channelSlug.trim().replace(/^#/, '').toLowerCase()
    if (!key) return
    const count = this.channels.get(key) ?? 0
    if (watch) {
      this.channels.set(key, count + 1)
      this.start()
      if (this.sessionId && count === 0) await this.register(key)
    } else if (count > 1) this.channels.set(key, count - 1)
    else if (count > 0) {
      this.channels.delete(key)
      this.dependencies.autoMod({ type: 'clear', channelSlug: key })
      const ids = this.subscriptions.get(key) ?? []
      this.subscriptions.delete(key)
      await this.removeSubscriptions(key, ids)
    }
  }

  private async removeSubscriptions(key: string, ids: string[]): Promise<void> {
    if (!ids.length) return
    const generation = this.generation
    const removing = this.dependencies.unsubscribe(ids).catch(() => {
      if (generation === this.generation)
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.removeFailed'),
        })
    })
    this.unregistering.set(key, removing)
    try {
      await removing
    } finally {
      if (this.unregistering.get(key) === removing) this.unregistering.delete(key)
    }
  }

  private clearAutoMod(): void {
    for (const channelSlug of this.channels.keys())
      this.dependencies.autoMod({ type: 'clear', channelSlug })
  }

  private connect(url: string, migration = false): void {
    if (this.stopped) return
    const parsed = new URL(url)
    if (parsed.protocol !== 'wss:' || parsed.hostname !== 'eventsub.wss.twitch.tv') {
      this.dependencies.status({
        status: 'error',
        message: t('misc.twitchEventSub.invalidReconnectUrl'),
      })
      return
    }
    this.dependencies.status({ status: 'connecting' })
    const socket = (this.dependencies.socket ?? ((address) => new WebSocket(address)))(url)
    if (migration) this.replacement = socket
    else this.socket = socket
    socket.onmessage = (event) => {
      if (this.stopped || (socket !== this.socket && socket !== this.replacement)) return
      let envelope: Envelope
      try {
        envelope = z
          .object({
            metadata: z
              .object({
                message_type: z.string().optional(),
                message_id: z.string().optional(),
                message_timestamp: z.string().optional(),
                subscription_type: z.string().optional(),
              })
              .optional(),
            payload: z
              .object({
                session: sessionSchema.optional(),
                subscription: z
                  .object({
                    id: z.string().optional(),
                    type: z.string().optional(),
                    status: z.string().optional(),
                  })
                  .optional(),
                event: z.record(z.string(), z.unknown()).optional(),
              })
              .optional(),
          })
          .parse(JSON.parse(String(event.data)))
      } catch {
        return
      }
      const type = envelope.metadata?.message_type
      if (type === 'session_welcome') {
        const session = envelope.payload?.session
        if (!session?.id) return
        const migrating = socket === this.replacement
        if (migrating) {
          const previous = this.socket
          this.socket = socket
          this.replacement = null
          previous?.close()
        }
        this.sessionId = session.id
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = undefined
        this.reconnectAttempts = 0
        this.armKeepalive(session.keepalive_timeout_seconds ?? 10)
        this.dependencies.status({ status: 'connected' })
        if (!migrating) {
          this.subscriptions.clear()
          this.registering.clear()
          if (this.dependencies.receiveWhispers !== false)
            runInBackground(this.register(''), 'twitch-eventsub background operation failed')
          for (const channel of this.channels.keys())
            runInBackground(this.register(channel), 'twitch-eventsub background operation failed')
        }
        return
      }
      if (socket !== this.socket) return
      this.armKeepalive()
      const messageId = envelope.metadata?.message_id
      if (messageId) {
        if (this.seenMessages.has(messageId)) return
        this.seenMessages.add(messageId)
        if (this.seenMessages.size > 2000) deleteOldestEntry(this.seenMessages)
      }
      if (type === 'session_reconnect') {
        const next = envelope.payload?.session?.reconnect_url
        if (next && !this.replacement) this.connect(next, true)
      } else if (type === 'revocation') {
        const revoked = envelope.payload?.subscription
        if (revoked?.id) {
          for (const [key, ids] of this.subscriptions) {
            if (!ids.includes(revoked.id)) continue
            this.subscriptions.set(
              key,
              ids.filter((id) => id !== revoked.id),
            )
            if (revoked.type?.startsWith('automod.message.'))
              this.dependencies.autoMod({ type: 'clear', channelSlug: key })
          }
        }
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.revoked', {
            reason: revoked?.status ?? t('misc.twitchEventSub.unknownReason'),
          }),
        })
      } else if (type === 'notification') this.deliver(envelope)
    }
    socket.onclose = () => {
      if (this.stopped) return
      if (socket === this.replacement) {
        this.replacement = null
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.migrationFailed'),
        })
        return
      }
      if (socket !== this.socket) return
      this.socket = null
      this.sessionId = null
      this.generation++
      this.registering.clear()
      this.unregistering.clear()
      clearTimeout(this.keepaliveTimer)
      this.clearAutoMod()
      this.dependencies.status({ status: 'disconnected' })
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      if (!this.stopped && (socket === this.socket || socket === this.replacement))
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.connectionFailed'),
        })
    }
  }

  private keepaliveSeconds = 10
  private armKeepalive(seconds?: number): void {
    if (seconds !== undefined) this.keepaliveSeconds = Math.max(1, seconds)
    clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(
      () => {
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.timedOut'),
        })
        this.socket?.close()
      },
      (this.keepaliveSeconds + 2) * 1000,
    )
    this.keepaliveTimer.unref?.()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const delay =
      this.dependencies.reconnectDelayMs ??
      Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts++, 5))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.dependencies.hasAccount()) this.connect(SOCKET_URL)
      else this.stop()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private async register(key: string): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId || this.registering.has(key) || this.subscriptions.has(key)) return
    const registration = Symbol()
    this.registering.set(key, registration)
    const generation = this.generation
    try {
      const removing = this.unregistering.get(key)
      if (removing) {
        await removing
        if (generation !== this.generation || (key && !this.channels.has(key))) return
      }
      const result = await this.dependencies.subscribe(sessionId, key || undefined)
      const ids = result.subscriptions.map((subscription) => subscription.id)
      if (generation !== this.generation || sessionId !== this.sessionId) {
        if (ids.length) await this.dependencies.unsubscribe(ids)
        return
      }
      if (key && !this.channels.has(key)) {
        this.registering.delete(key)
        await this.removeSubscriptions(key, ids)
        return
      }
      this.subscriptions.set(key, ids)
      if (result.errors.length)
        this.dependencies.status({
          status: 'error',
          message: result.errors.join(' ').slice(0, 500),
        })
    } catch {
      if (generation === this.generation)
        this.dependencies.status({
          status: 'error',
          message: t('misc.twitchEventSub.subscribeFailed'),
        })
    } finally {
      if (this.registering.get(key) === registration) this.registering.delete(key)
    }
  }

  private deliver(envelope: Envelope): void {
    const data = envelope.payload?.event
    if (!data) return
    const eventType =
      envelope.payload?.subscription?.type ?? envelope.metadata?.subscription_type ?? ''
    if (eventType === 'automod.message.hold' || eventType === 'automod.message.update') {
      const event = parseTwitchAutoModEvent(eventType, data)
      if (event && this.channels.has(event.channelSlug)) this.dependencies.autoMod(event)
      return
    }
    if (
      eventType === 'channel.chat.user_message_hold' ||
      eventType === 'channel.chat.user_message_update'
    ) {
      const senderUserId = this.dependencies.senderUserId
      if (!senderUserId) return
      const notice = buildTwitchAutoModSenderNotice(
        eventType,
        data,
        senderUserId,
        envelope.metadata?.message_timestamp,
      )
      if (notice && this.channels.has(notice.channelId)) this.dependencies.senderNotice?.(notice)
      return
    }
    if (eventType === 'channel.moderate') {
      const notice = buildTwitchModerationNotice(
        data,
        envelope.metadata?.message_id,
        envelope.metadata?.message_timestamp,
      )
      if (notice && this.channels.has(notice.channelId))
        this.dependencies.moderationNotice?.(notice)
      return
    }
    if (eventType === 'user.whisper.message') {
      if (this.dependencies.receiveWhispers === false) return
      const whisper = z.object({ text: z.string().optional() }).optional().parse(data.whisper)
      this.dependencies.whisper({
        id: String(data.whisper_id ?? envelope.metadata?.message_id ?? ''),
        fromUserId: String(data.from_user_id ?? ''),
        fromLogin: String(data.from_user_login ?? ''),
        fromDisplayName: String(data.from_user_name ?? ''),
        toUserId: String(data.to_user_id ?? ''),
        text: whisper?.text ?? '',
        at: envelope.metadata?.message_timestamp ?? new Date().toISOString(),
      })
      return
    }
    const type = eventType.startsWith('stream.')
      ? 'stream'
      : eventType.includes('poll.')
        ? 'poll'
        : eventType.includes('prediction.')
          ? 'prediction'
          : eventType.includes('redemption.')
            ? 'redemption'
            : eventType.includes('custom_reward.')
              ? 'reward'
              : eventType === 'channel.follow'
                ? 'follow'
                : null
    if (type)
      this.dependencies.activity({
        type,
        channelId: String(data.broadcaster_user_id ?? ''),
        eventType,
        data,
      })
  }
}
