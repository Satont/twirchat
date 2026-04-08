/**
 * Twitch Platform Adapter — powered by Twurple (@twurple/chat + @twurple/auth)
 *
 * Connects to Twitch Chat using the official Twurple ChatClient.
 *
 * - Anonymous mode: no auth, read-only
 * - Authenticated: uses stored access token via StaticAuthProvider
 *
 * Token refresh is handled by calling the backend API when needed,
 * keeping client secrets server-side for security.
 */

import { BasePlatformAdapter } from '../base-adapter'
import type { Badge, NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import { StaticAuthProvider } from '@twurple/auth'
import { ChatClient } from '@twurple/chat'
import type { ChatMessage, UserNotice } from '@twurple/chat'
import { LogLevel } from '@twurple/chat'
import { getBackendUrl } from '../../runtime-config'
import { AccountStore } from '../../store/account-store'
import { refreshTwitchToken } from '../../auth/twitch'
import type { TwitchBadgesResponse } from '@twirchat/shared/types'
import { logger } from '@twirchat/shared/logger'

const log = logger('twitch')

// ============================================================
// TwitchAdapter
// ============================================================

export class TwitchAdapter extends BasePlatformAdapter {
  readonly platform = 'twitch' as const

  private chatClient: ChatClient | null = null
  private badgeRefreshInterval: ReturnType<typeof setInterval> | null = null
  private channelName = ''
  private shouldReconnect = true
  private isConnected = false

  /** "setId/version" → imageUrl_1x, populated from backend /api/twitch/badges */
  private badgeCache = new Map<string, string>()

  private anonymous = true
  private accessToken: string | null = null
  private accountId: string | null = null
  private displayName: string | null = null
  private login: string | null = null

  async connect(channelName: string): Promise<void> {
    this.channelName = channelName.toLowerCase()
    this.shouldReconnect = true
    this.isConnected = false

    // Check for stored account
    const account = AccountStore.findByPlatform('twitch')
    if (account) {
      const tokens = AccountStore.getTokens(account.id)
      if (tokens?.accessToken) {
        this.anonymous = false
        this.accessToken = tokens.accessToken
        this.accountId = account.id
        this.displayName = account.displayName
        this.login = account.username

        // Check if token needs refresh before connecting
        const now = Math.floor(Date.now() / 1000)
        if (tokens.expiresAt && tokens.expiresAt < now + 300) {
          log.info('[Twitch] Token expired or expiring soon, refreshing...')
          try {
            this.accessToken = await refreshTwitchToken(account.id)
            log.info('[Twitch] Token refreshed successfully')
          } catch (error) {
            log.error('[Twitch] Failed to refresh token', { error: String(error) })
            // Continue with existing token, will retry on 401
          }
        }
      }
    }

    if (this.anonymous) {
      this.accessToken = null
      log.info(`[Twitch] Connecting anonymously to #${this.channelName}`)
    } else {
      log.info(`[Twitch] Connecting as @${this.login} to #${this.channelName}`)
    }

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'connecting',
    })

    // Initial badge fetch + schedule refresh every 5 minutes
    await this.fetchBadges()
    this.badgeRefreshInterval = setInterval(() => void this.fetchBadges(), 5 * 60 * 1000)

    await this.connectChatClient()
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.clearTimers()

    if (this.chatClient) {
      await this.chatClient.quit()
      this.chatClient = null
    }

    this.isConnected = false

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'disconnected',
    })
  }

  async sendMessage(channelId: string, text: string, replyToMessageId?: string): Promise<void> {
    if (this.anonymous) {
      throw new Error('Cannot send messages in anonymous mode. Please log in to Twitch.')
    }
    if (!this.chatClient) {
      throw new Error('Twitch chat client not initialized')
    }
    if (!this.isConnected) {
      throw new Error('Twitch chat not connected')
    }

    // Ensure token is fresh before sending
    await this.refreshTokenIfNeeded()

    try {
      await this.chatClient.say(
        channelId,
        text,
        replyToMessageId ? { replyTo: replyToMessageId } : undefined,
      )
    } catch (error) {
      // If we get an auth error, try to refresh and retry once
      if (this.isAuthError(error)) {
        log.info('[Twitch] Auth error on send, attempting refresh...')
        const refreshed = await this.refreshTokenIfNeeded()
        if (refreshed && this.chatClient) {
          // Reconnect with new token
          await this.reconnectWithNewToken()
          await this.chatClient.say(
            channelId,
            text,
            replyToMessageId ? { replyTo: replyToMessageId } : undefined,
          )
          return
        }
      }
      throw error
    }
  }

  // ============================================================
  // Private
  // ============================================================

  private async connectChatClient(): Promise<void> {
    try {
      if (this.chatClient) {
        try {
          await this.chatClient.quit()
        } catch {
          // ignore errors from already-closed client
        }
        this.chatClient = null
      }

      let authProvider: StaticAuthProvider | undefined

      if (!this.anonymous && this.accessToken) {
        // For authenticated mode, we need a client ID
        // We'll use a placeholder since StaticAuthProvider requires it
        // The actual validation is done server-side
        authProvider = new StaticAuthProvider(
          'twirchat-desktop', // Placeholder client ID - actual validation on backend
          this.accessToken,
          ['chat:read', 'chat:edit'],
        )
      }

      this.chatClient = new ChatClient({
        authProvider,
        channels: [this.channelName],
        isAlwaysMod: false,
        logger: {
          custom: (level, message) => {
            if (level === LogLevel.ERROR) {
              log.error(`[Twurple] ${message}`)
            } else if (level === LogLevel.WARNING) {
              log.warn(`[Twurple] ${message}`)
            }
            // INFO and DEBUG suppressed — avoids raw IRC message spam
          },
        },
      })

      this.setupEventHandlers()

      await this.chatClient.connect()
    } catch (error) {
      log.error('[Twitch] Failed to connect', { error: String(error) })
      this.handleDisconnect()
    }
  }

  private setupEventHandlers(): void {
    if (!this.chatClient) {
      return
    }

    // Connection successful
    this.chatClient.onConnect(() => {
      log.info(`[Twitch] Connected to chat`)
    })

    // Joined channel
    this.chatClient.onJoin((channel, user) => {
      if (user === this.login) {
        log.info(`[Twitch] Joined ${channel}`)
        this.isConnected = true
        this.emit('status', {
          channelLogin: this.channelName,
          mode: this.anonymous ? 'anonymous' : 'authenticated',
          platform: 'twitch',
          status: 'connected',
        })
      }
    })

    // Disconnected
    this.chatClient.onDisconnect((manually, reason) => {
      log.warn(`[Twitch] Disconnected${reason ? `: ${reason}` : ''}`)
      this.isConnected = false
      this.handleDisconnect()
    })

    // Authentication failure
    this.chatClient.onAuthenticationFailure((text, retryCount) => {
      log.error(`[Twitch] Authentication failure: ${text} (retry ${retryCount})`)

      // Try to refresh token on auth failure
      if (!this.anonymous && retryCount === 0) {
        void this.handleAuthFailure()
      }
    })

    // Messages (also handles bits/cheers — msg.bits > 0 means a cheer)
    this.chatClient.onMessage((channel, user, text, msg) => {
      this.handleChatMessage(msg)
      if (msg.bits > 0) {
        this.handleCheerEvent(msg)
      }
    })

    // Actions (/me)
    this.chatClient.onAction((channel, user, text, msg) => {
      this.handleChatMessage(msg, true)
    })

    // Subscriptions
    this.chatClient.onSub((channel, user, subInfo, msg) => {
      this.handleSubEvent(msg, 'sub', subInfo)
    })

    // Resubscriptions
    this.chatClient.onResub((channel, user, subInfo, msg) => {
      this.handleSubEvent(msg, 'resub', subInfo)
    })

    // Sub gifts
    this.chatClient.onSubGift((channel, user, subInfo, msg) => {
      this.handleSubGiftEvent(msg, user, subInfo)
    })

    // Raids
    this.chatClient.onRaid((channel, user, raidInfo, msg) => {
      this.handleRaidEvent(msg, raidInfo)
    })

    // Ban/timeout events (optional, for moderation features)
    this.chatClient.onBan((channel, user, _msg) => {
      log.info(`[Twitch] ${user} was banned from ${channel}`)
    })

    this.chatClient.onTimeout((channel, user, duration, _msg) => {
      log.info(`[Twitch] ${user} was timed out for ${duration}s from ${channel}`)
    })
  }

  private handleDisconnect(): void {
    this.isConnected = false

    this.emit('status', {
      channelLogin: this.channelName,
      mode: this.anonymous ? 'anonymous' : 'authenticated',
      platform: 'twitch',
      status: 'disconnected',
    })

    if (this.shouldReconnect) {
      log.info('[Twitch] Reconnecting in 5s...')
      setTimeout(() => {
        void this.connectChatClient()
      }, 5000)
    }
  }

  private async handleAuthFailure(): Promise<void> {
    if (!this.accountId) {
      return
    }

    try {
      log.info('[Twitch] Attempting token refresh after auth failure...')
      this.accessToken = await refreshTwitchToken(this.accountId)
      log.info('[Twitch] Token refreshed, reconnecting...')
      await this.reconnectWithNewToken()
    } catch (error) {
      log.error('[Twitch] Token refresh failed', { error: String(error) })
    }
  }

  private async reconnectWithNewToken(): Promise<void> {
    if (!this.accessToken) {
      return
    }

    // Disconnect current client
    if (this.chatClient) {
      await this.chatClient.quit()
      this.chatClient = null
    }

    // Reconnect with new token
    await this.connectChatClient()
  }

  private async refreshTokenIfNeeded(): Promise<boolean> {
    if (this.anonymous || !this.accountId) {
      return false
    }

    const tokens = AccountStore.getTokens(this.accountId)
    if (!tokens?.refreshToken) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (tokens.expiresAt && tokens.expiresAt < now + 300) {
      log.info('[Twitch] Token expired or expiring soon, refreshing...')
      try {
        this.accessToken = await refreshTwitchToken(this.accountId)
        log.info('[Twitch] Token refreshed successfully')
        return true
      } catch (error) {
        log.error('[Twitch] Failed to refresh token', { error: String(error) })
        return false
      }
    }
    return false
  }

  private isAuthError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      return (
        msg.includes('401') ||
        msg.includes('authentication') ||
        msg.includes('auth') ||
        msg.includes('token') ||
        msg.includes('unauthorized')
      )
    }
    return false
  }

  private handleChatMessage(msg: ChatMessage, isAction = false): void {
    const channel = msg.target
    const { text } = msg
    const { tags } = msg

    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? msg.userInfo.userName
    const color = tags.get('color') || undefined
    const msgId = tags.get('id') ?? `${Date.now()}`
    const timestamp = msg.date

    const replyParentMsgId = tags.get('reply-parent-msg-id')
    const replyParentMsgBody = tags.get('reply-parent-msg-body')
    const replyParentUserLogin = tags.get('reply-parent-user-login')
    const replyParentDisplayName = tags.get('reply-parent-display-name') ?? replyParentUserLogin
    const replyParentUserId = tags.get('reply-parent-user-id')

    // Parse emotes from the parsed message
    const emotes: NormalizedChatMessage['emotes'] = []
    if (msg.emoteOffsets) {
      for (const [emoteId, offsets] of msg.emoteOffsets) {
        const positions = offsets.map((offset: string) => {
          const [start, end] = offset.split('-').map(Number)
          return { end: end ?? 0, start: start ?? 0 }
        })

        // Get emote name from first position
        const firstPos = positions[0]
        const emoteName = firstPos ? text.slice(firstPos.start, (firstPos.end ?? 0) + 1) : ''

        emotes.push({
          id: emoteId,
          imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/1.0`,
          name: emoteName,
          positions,
        })
      }
    }

    // Parse badges
    const badges: Badge[] = []
    const badgesTag = tags.get('badges')
    if (badgesTag) {
      for (const badge of badgesTag.split(',')) {
        const [badgeId, version] = badge.split('/')
        if (badgeId) {
          const cacheKey = `${badgeId}/${version ?? '1'}`
          badges.push({
            id: cacheKey,
            imageUrl: this.badgeCache.get(cacheKey),
            text: badgeId,
            type: badgeId,
          })
        }
      }
    }

    const normalized: NormalizedChatMessage = {
      author: {
        badges,
        color,
        displayName,
        id: userId,
        username: msg.userInfo.userName,
      },
      channelId: channel.replace('#', ''),
      emotes,
      id: msgId,
      platform: 'twitch',
      text,
      timestamp,
      type: isAction ? 'action' : 'message',
      ...(replyParentMsgId && replyParentMsgBody && replyParentUserId
        ? {
            reply: {
              parentAuthor: {
                displayName: replyParentDisplayName ?? replyParentUserLogin ?? '',
                id: replyParentUserId,
                username: replyParentUserLogin ?? '',
              },
              parentMessageId: replyParentMsgId,
              parentMessageText: replyParentMsgBody,
            },
          }
        : {}),
    }

    this.emit('message', normalized)
  }

  private handleSubEvent(
    msg: UserNotice,
    type: 'sub' | 'resub',
    subInfo: { months: number; plan?: string },
  ): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? 'unknown'
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        months: subInfo.months,
        subPlan: tags.get('msg-param-sub-plan'),
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
      },
      id: `twitch:${type}:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type,
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
  }

  private handleSubGiftEvent(
    msg: UserNotice,
    recipient: string,
    subInfo: { months: number; plan?: string },
  ): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? 'unknown'
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        months: subInfo.months,
        recipientDisplayName: recipient,
        recipientId: tags.get('msg-param-recipient-id'),
        subPlan: tags.get('msg-param-sub-plan'),
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
      },
      id: `twitch:subgift:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'gift_sub',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
  }

  private handleRaidEvent(msg: UserNotice, raidInfo: { viewerCount: number }): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? 'unknown'
    const channelId = msg.channelId ?? ''

    const event: NormalizedEvent = {
      data: {
        channelId,
        systemMsg: tags.get('system-msg')?.replace(/\\s/g, ' '),
        viewerCount: raidInfo.viewerCount,
      },
      id: `twitch:raid:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'raid',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
  }

  private handleCheerEvent(msg: ChatMessage): void {
    const { tags } = msg
    const userId = tags.get('user-id') ?? ''
    const displayName = tags.get('display-name') ?? msg.userInfo.userName
    const bits = parseInt(tags.get('bits') ?? '0', 10)

    const event: NormalizedEvent = {
      data: {
        bits,
        channelId: msg.channelId ?? '',
        message: msg.text,
      },
      id: `twitch:bits:${userId}:${Date.now()}`,
      platform: 'twitch',
      timestamp: new Date(),
      type: 'bits',
      user: {
        displayName,
        id: userId,
      },
    }

    this.emit('event', event)
  }

  private async fetchBadges(): Promise<void> {
    const url = new URL(`${getBackendUrl()}/api/twitch/badges`)
    if (this.channelName) {
      url.searchParams.set('broadcasterLogin', this.channelName)
    }

    try {
      const res = await fetch(url.toString())
      if (!res.ok) {
        log.warn(`[Twitch] Badge fetch failed: ${res.status}`)
        return
      }
      const data = (await res.json()) as TwitchBadgesResponse
      this.badgeCache = new Map(Object.entries(data.badges))
      log.info(`[Twitch] Badge cache updated: ${this.badgeCache.size} entries`)
    } catch (error) {
      log.warn('[Twitch] Badge fetch error', { error: String(error) })
    }
  }

  private clearTimers(): void {
    if (this.badgeRefreshInterval) {
      clearInterval(this.badgeRefreshInterval)
      this.badgeRefreshInterval = null
    }
  }
}
