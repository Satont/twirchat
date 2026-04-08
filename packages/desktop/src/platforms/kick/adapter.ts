import { BasePlatformAdapter } from '../base-adapter'
import type { Badge, Emote, NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import { KICK_API_BASE, KICK_PUSHER_WS } from '@twirchat/shared/constants'
import { getBackendUrl } from '../../runtime-config'
import { AccountStore } from '../../store/account-store'
import { refreshKickToken } from '../../auth/kick'
import { getKickBadgeSvg } from './badges'
import { logger } from '@twirchat/shared/logger'

const log = logger('kick')

// ============================================================
// Типы Kick Pusher events
// ============================================================

interface KickChatMessage {
  id: string
  chatroom_id: number
  content: string
  type: 'message' | 'reply'
  created_at: string
  sender: {
    id: number
    username: string
    slug: string
    identity: {
      color: string
      badges: {
        type: string
        text: string
        count?: number
      }[]
    }
    profile_picture?: string
  }
  metadata?: {
    original_sender: {
      id: string
      username: string
    }
    original_message: {
      id: string
      content: string
    }
  }
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

// Pusher protocol envelope
interface PusherEvent {
  event: string
  channel?: string
  data: string | Record<string, unknown>
}

// ============================================================
// Kick адаптер
//
// Подключается к Kick через Pusher WebSocket в анонимном режиме
// (без токенов). Входящие сообщения чата и события (подписки,
// Фолловы) приходят через Pusher. Отправка сообщений делегируется
// Вовне — должна идти через backend WS (send_message).
// ============================================================

export class KickAdapter extends BasePlatformAdapter {
  readonly platform = 'kick' as const

  private ws: WebSocket | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private channelSlug = ''
  private chatroomId: number | null = null
  private broadcasterUserId: number | null = null
  private isConnected = false
  private shouldReconnect = true

  private anonymous = true
  private accessToken: string | null = null
  private accountId: string | null = null
  private platformUserId: string | null = null

  async connect(channelSlug: string): Promise<void> {
    this.channelSlug = channelSlug
    this.shouldReconnect = true

    // Check for stored account
    const account = AccountStore.findByPlatform('kick')
    if (account) {
      const tokens = AccountStore.getTokens(account.id)
      if (tokens) {
        this.anonymous = false
        this.accessToken = tokens.accessToken
        this.accountId = account.id
        this.platformUserId = account.platformUserId

        // Check if token needs refresh
        const now = Math.floor(Date.now() / 1000)
        if (tokens.expiresAt && tokens.expiresAt < now + 300) {
          log.info('[Kick] Token expired or expiring soon, refreshing...')
          try {
            this.accessToken = await refreshKickToken(account.id)
            log.info('[Kick] Token refreshed successfully')
          } catch (error) {
            log.error('[Kick] Failed to refresh token', { error: String(error) })
          }
        }
      }
    }

    if (this.anonymous) {
      this.accessToken = null
    }

    this.emit('status', {
      channelLogin: channelSlug,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'kick',
      status: 'connecting',
    })

    const info = await this.fetchChatroomId(channelSlug)
    this.chatroomId = info.chatroomId
    this.broadcasterUserId = info.broadcasterUserId
    await this.connectPusher()
  }

  getBroadcasterUserId(): number | null {
    return this.broadcasterUserId
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.isConnected = false

    this.emit('status', {
      channelLogin: this.channelSlug,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'kick',
      status: 'disconnected',
    })
  }

  async sendMessage(_channelId: string, text: string, replyToMessageId?: string): Promise<void> {
    if (this.anonymous) {
      throw new Error('Cannot send messages in anonymous mode. Please log in to Kick.')
    }
    if (!this.accessToken) {
      throw new Error('Kick access token not available')
    }
    if (!this.accountId) {
      throw new Error('Kick account ID not available')
    }

    // Check if token needs refresh before sending
    await this.refreshTokenIfNeeded()

    const body: {
      broadcaster_user_id: number
      content: string
      type: string
      reply_to_message_id?: string
    } = {
      broadcaster_user_id: this.broadcasterUserId ?? Number(this.platformUserId),
      content: text,
      type: 'user',
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }

    const url = `${KICK_API_BASE}/chat`
    let res = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    // If 401, try to refresh token and retry once
    if (res.status === 401) {
      log.info('[Kick] Got 401, attempting token refresh...')
      const refreshed = await this.refreshTokenIfNeeded()
      if (refreshed) {
        res = await fetch(url, {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
      }
    }

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '')
      throw new Error(
        `Failed to send Kick message ${JSON.stringify(body)}: ${res.status} ${responseBody}`,
      )
    }
  }

  private async refreshTokenIfNeeded(): Promise<boolean> {
    if (!this.accountId) {
      return false
    }

    const tokens = AccountStore.getTokens(this.accountId)
    if (!tokens?.refreshToken) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (tokens.expiresAt && tokens.expiresAt < now + 300) {
      log.info('[Kick] Token expired or expiring soon, refreshing...')
      try {
        this.accessToken = await refreshKickToken(this.accountId)
        log.info('[Kick] Token refreshed successfully')
        return true
      } catch (error) {
        log.error('[Kick] Failed to refresh token', { error: String(error) })
        return false
      }
    }
    return false
  }

  // ============================================================
  // Private
  // ============================================================

  private async fetchChatroomId(
    channelSlug: string,
  ): Promise<{ chatroomId: number; broadcasterUserId: number }> {
    const url = `${getBackendUrl()}/api/kick/chatroom?slug=${encodeURIComponent(channelSlug)}`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Cannot fetch Kick chatroom for "${channelSlug}": ${res.status} ${body}`)
    }

    const data = (await res.json()) as {
      chatroomId?: number
      broadcasterUserId?: number
      error?: string
    }
    if (data.error) {
      throw new Error(`Kick chatroom error for "${channelSlug}": ${data.error}`)
    }

    const { chatroomId } = data
    const { broadcasterUserId } = data
    if (!chatroomId) {
      throw new Error(`Kick chatroom ID not found for channel "${channelSlug}"`)
    }
    if (!broadcasterUserId) {
      throw new Error(`Kick broadcaster user ID not found for channel "${channelSlug}"`)
    }

    log.info(
      `[Kick] Channel "${channelSlug}" → chatroom_id=${chatroomId}, broadcaster_user_id=${broadcasterUserId}`,
    )
    return { broadcasterUserId, chatroomId }
  }

  private async connectPusher(): Promise<void> {
    if (!this.chatroomId) {
      throw new Error('chatroomId not set')
    }

    const wsUrl = `${KICK_PUSHER_WS}?protocol=7&client=js&version=8.4.0&flash=false`
    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.addEventListener('open', () => {
      log.info(`[Kick] Pusher connected (${this.anonymous ? 'anonymous' : 'authenticated'})`)
    })

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as PusherEvent
        this.handlePusherEvent(msg)
      } catch (error) {
        log.error('[Kick] Failed to parse Pusher event', { error: String(error) })
      }
    })

    ws.addEventListener('close', (event) => {
      log.warn(`[Kick] Pusher disconnected: ${event.code} ${event.reason}`)
      this.isConnected = false
      this.clearTimers()

      this.emit('status', {
        channelLogin: this.channelSlug,
        mode: this.anonymous ? 'anonymous' : 'authenticated',
        platform: 'kick',
        status: 'disconnected',
      })

      if (this.shouldReconnect) {
        log.info('[Kick] Reconnecting in 5s...')
        this.reconnectTimeout = setTimeout(() => void this.connectPusher(), 5000)
      }
    })

    ws.addEventListener('error', (err) => {
      log.error('[Kick] Pusher WebSocket error', { error: String(err) })
    })
  }

  private handlePusherEvent(event: PusherEvent): void {
    switch (event.event) {
      case 'pusher:connection_established': {
        this.subscribeToChatroom()
        break
      }

      case 'pusher:ping': {
        this.ws?.send(JSON.stringify({ data: {}, event: 'pusher:pong' }))
        break
      }

      case 'pusher_internal:subscription_succeeded': {
        log.info(`[Kick] Subscribed to chatroom ${this.chatroomId}`)
        this.isConnected = true
        this.emit('status', {
          channelLogin: this.channelSlug,
          mode: this.anonymous ? 'anonymous' : 'authenticated',
          platform: 'kick',
          status: 'connected',
        })
        break
      }

      case String.raw`App\Events\ChatMessageEvent`: {
        const data =
          typeof event.data === 'string'
            ? (JSON.parse(event.data) as KickChatMessage)
            : (event.data as unknown as KickChatMessage)
        this.handleChatMessage(data)
        break
      }

      case String.raw`App\Events\FollowersUpdated`: {
        const data =
          typeof event.data === 'string'
            ? (JSON.parse(event.data) as KickFollowEvent)
            : (event.data as unknown as KickFollowEvent)
        this.handleFollowEvent(data)
        break
      }

      case String.raw`App\Events\SubscriptionEvent`: {
        const data =
          typeof event.data === 'string'
            ? (JSON.parse(event.data) as KickSubscriptionEvent)
            : (event.data as unknown as KickSubscriptionEvent)
        this.handleSubscriptionEvent(data)
        break
      }

      default: {
        if (!event.event.startsWith('pusher')) {
          log.info(`[Kick] Unhandled Pusher event: ${event.event}`)
        }
        break
      }
    }
  }

  private subscribeToChatroom(): void {
    if (!this.chatroomId || !this.ws) {
      return
    }

    this.ws.send(
      JSON.stringify({
        data: {
          auth: '',
          channel: `chatrooms.${this.chatroomId}.v2`,
        },
        event: 'pusher:subscribe',
      }),
    )
  }

  private handleChatMessage(msg: KickChatMessage): void {
    const badges: Badge[] = msg.sender.identity.badges.map((b) => ({
      id: b.type,
      imageUrl: getKickBadgeSvg(b.type) || undefined,
      text: b.text,
      type: b.type,
    }))

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

    const normalized: NormalizedChatMessage = {
      author: {
        avatarUrl: msg.sender.profile_picture ?? undefined,
        badges,
        color: msg.sender.identity.color || undefined,
        displayName: msg.sender.username,
        id: String(msg.sender.id),
        username: msg.sender.username,
      },
      channelId: String(this.broadcasterUserId ?? msg.chatroom_id),
      emotes,
      id: msg.id,
      platform: 'kick',
      text: cleanText,
      timestamp: new Date(msg.created_at),
      type: 'message',
      ...(msg.type === 'reply' && msg.metadata
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }
}
