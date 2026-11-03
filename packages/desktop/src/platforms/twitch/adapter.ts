import type { RoomState } from '@twirchat/shared/channel-tools'
import { logger } from '@twirchat/shared/logger'
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
import type { Badge, NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import { StaticAuthProvider } from '@twurple/auth'
import { ChatClient, UserState } from '@twurple/chat'
import type { ChatMessage, UserNotice } from '@twurple/chat'
import { LogLevel } from '@twurple/chat'
import { z } from 'zod'

import { refreshTwitchToken } from '../../auth/twitch'
import { getBackendUrl } from '../../runtime-config'
import { runInBackground } from '../../services/background-task'
import { AccountStore } from '../../store/account-store'
import { MessageStore } from '../../store/message-store'
import { BasePlatformAdapter } from '../base-adapter'
import { resolveTwitchAvatarUrl } from './avatar-cache'
import { normalizeTwitchChatMessage, twitchAuthorAppearance } from './normalize-message'

const log = logger('twitch')

interface LocalTwitchSentMessageParams {
  channelId: string
  text: string
  author: {
    avatarUrl?: string
    badges?: Badge[]
    color?: string
    displayName: string
    id: string
    username?: string
  }
  id?: string
  reply?: NormalizedChatMessage['reply']
  timestamp?: Date
}

export function createLocalTwitchSentMessage(
  params: LocalTwitchSentMessageParams,
): NormalizedChatMessage {
  const channelId = params.channelId.trim().replace(/^#/, '').toLowerCase()
  return {
    author: {
      avatarUrl: params.author.avatarUrl,
      badges: params.author.badges ?? [],
      color: params.author.color,
      displayName: params.author.displayName,
      id: params.author.id,
      username: params.author.username,
    },
    channelId,
    emotes: [],
    id: params.id ?? `local:twitch:${channelId}:${crypto.randomUUID()}`,
    platform: 'twitch',
    text: params.text,
    timestamp: params.timestamp ?? new Date(),
    type: 'message',
    ...(params.reply ? { reply: params.reply } : {}),
  }
}

export { twitchAuthorAppearance, twitchMessageMetadata } from './normalize-message'

// ============================================================
// TwitchAdapter
// ============================================================

export class TwitchAdapter extends BasePlatformAdapter {
  readonly platform = 'twitch'

  private chatClient: ChatClient | null = null
  private badgeRefreshInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private channelName = ''
  private shouldReconnect = true
  private isConnected = false
  private roomState: RoomState | undefined

  getRoomState(): RoomState | undefined {
    return this.roomState
  }

  private updateRoomState(channel: string, patch: Partial<RoomState>): void {
    const channelId = channel.replace(/^#/, '').toLowerCase()
    this.roomState = { ...this.roomState, platform: 'twitch', channelId, ...patch }
    this.emit('room_state', this.roomState)
  }

  /** "setId/version" → imageUrl_1x, populated from backend /api/twitch/badges */
  private badgeCache = new Map<string, string>()

  private anonymous = true
  private accessToken: string | null = null
  private accountId: string | null = null
  private displayName: string | null = null
  private login: string | null = null
  private platformUserId: string | null = null
  private selfTags: ReadonlyMap<string, string> = new Map()

  private identityRevision = 0

  async connect(channelName: string): Promise<void> {
    const revision = ++this.identityRevision
    this.channelName = channelName.trim().replace(/^#/, '').toLowerCase()
    this.selfTags = new Map()
    this.badgeCache = new Map()
    this.roomState = undefined
    this.shouldReconnect = true
    this.isConnected = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.anonymous = true
    this.accessToken = null
    this.accountId = null
    this.displayName = null
    this.login = null
    this.platformUserId = null

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
        this.platformUserId = account.platformUserId

        // Check if token needs refresh before connecting
        const now = Math.floor(Date.now() / 1000)
        if (tokens.expiresAt && tokens.expiresAt < now + 300) {
          log.info('[Twitch] Token expired or expiring soon, refreshing...')
          try {
            const token = await refreshTwitchToken(account.id)
            if (
              revision !== this.identityRevision ||
              AccountStore.findByPlatform('twitch')?.id !== account.id
            )
              return
            this.accessToken = token
            log.info('[Twitch] Token refreshed successfully')
          } catch (error) {
            log.error('[Twitch] Failed to refresh token', { error: String(error) })
            // Continue with existing token, will retry on 401
          }
        }
      }
    }

    if (revision !== this.identityRevision) return
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
    if (revision !== this.identityRevision) return
    this.badgeRefreshInterval = setInterval(
      () => runInBackground(this.fetchBadges(), 'adapter background operation failed'),
      5 * 60 * 1000,
    )

    await this.connectChatClient()
  }

  async disconnect(): Promise<void> {
    this.identityRevision++
    this.selfTags = new Map()
    this.accountId = null
    this.accessToken = null
    this.anonymous = true
    this.platformUserId = null
    this.shouldReconnect = false
    this.clearTimers()

    if (this.chatClient) {
      this.chatClient.quit()
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
    const revision = this.identityRevision
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
    if (revision !== this.identityRevision)
      throw new Error('The Twitch account changed before sending. Review the draft and send again.')

    try {
      await this.chatClient.say(
        channelId,
        text,
        replyToMessageId ? { replyTo: replyToMessageId } : undefined,
      )
      if (revision === this.identityRevision)
        this.emitLocalSentMessage(channelId, text, replyToMessageId)
    } catch (error) {
      // If we get an auth error, try to refresh and retry once
      if (this.isAuthError(error)) {
        log.info('[Twitch] Auth error on send, attempting refresh...')
        const refreshed = await this.refreshTokenIfNeeded()
        if (revision !== this.identityRevision)
          throw new Error(
            'The Twitch account changed while sending. Delivery could not be confirmed.',
            { cause: error },
          )
        if (refreshed && this.chatClient) {
          // Reconnect with new token
          await this.reconnectWithNewToken()
          if (revision !== this.identityRevision)
            throw new Error('The Twitch account changed while reconnecting.', { cause: error })
          await this.chatClient.say(
            channelId,
            text,
            replyToMessageId ? { replyTo: replyToMessageId } : undefined,
          )
          if (revision === this.identityRevision)
            this.emitLocalSentMessage(channelId, text, replyToMessageId)
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
    const revision = this.identityRevision
    this.selfTags = new Map()
    try {
      if (this.chatClient) {
        try {
          this.chatClient.quit()
        } catch {
          // ignore errors from already-closed client
        }
        if (revision !== this.identityRevision) return
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

      this.chatClient.connect()
    } catch (error) {
      if (revision !== this.identityRevision) return
      log.error('[Twitch] Failed to connect', { error: String(error) })
      this.handleDisconnect()
    }
  }

  private setupEventHandlers(): void {
    if (!this.chatClient) {
      return
    }

    const client = this.chatClient
    const revision = this.identityRevision
    const current = () => this.chatClient === client && this.identityRevision === revision

    client.irc.onTypedMessage(UserState, (message) => {
      if (
        current() &&
        !this.anonymous &&
        message.channel.replace(/^#/, '').toLowerCase() === this.channelName
      )
        this.selfTags = new Map(message.tags)
    })

    // Connection successful
    client.onConnect(() => {
      if (!current()) return
      log.info(`[Twitch] Connected to chat`)
    })

    // Joined channel
    client.onJoin((channel, user) => {
      if (!current()) return
      if (channel.replace('#', '').toLowerCase() !== this.channelName) {
        return
      }

      // Anonymous sessions connect as justinfan* and can't be matched by login,
      // so the first join in our own channel is ours.
      const isSelf = this.anonymous || user.toLowerCase() === (this.login ?? '').toLowerCase()
      if (!isSelf || this.isConnected) {
        return
      }

      log.info(`[Twitch] Joined ${channel}`)
      this.isConnected = true
      this.emit('status', {
        channelLogin: this.channelName,
        mode: this.anonymous ? 'anonymous' : 'authenticated',
        platform: 'twitch',
        status: 'connected',
      })
    })

    // Disconnected
    client.onDisconnect((manually, reason) => {
      if (!current()) return
      log.warn(`[Twitch] Disconnected${reason ? `: ${reason}` : ''}`)
      this.isConnected = false

      // Intentional quit (teardown in connectChatClient / reconnectWithNewToken /
      // disconnect()) — treating it as a real disconnect stacks reconnect timers
      // and loops "disconnected" status emissions forever.
      if (manually) {
        return
      }

      this.handleDisconnect()
    })

    // Authentication failure
    client.onAuthenticationFailure((text, retryCount) => {
      if (!current()) return
      log.error(`[Twitch] Authentication failure: ${text} (retry ${retryCount})`)

      // Try to refresh token on auth failure
      if (!this.anonymous && retryCount === 0) {
        runInBackground(this.handleAuthFailure(), 'adapter background operation failed')
      }
    })

    // Messages (also handles bits/cheers — msg.bits > 0 means a cheer)
    client.onMessage((channel, user, text, msg) => {
      if (!current()) return
      runInBackground(this.handleChatMessage(msg), 'adapter background operation failed')
      if (msg.bits > 0) {
        this.handleCheerEvent(msg)
      }
    })

    // Actions (/me)
    client.onAction((channel, user, text, msg) => {
      if (!current()) return
      runInBackground(this.handleChatMessage(msg, true), 'adapter background operation failed')
    })
    client.onAnnouncement((channel, user, info, msg) => {
      if (!current()) return
      const message = createLocalTwitchSentMessage({
        channelId: channel,
        text: msg.text ?? '',
        id: msg.tags.get('id'),
        timestamp: msg.date,
        author: {
          ...twitchAuthorAppearance(msg.tags, this.badgeCache),
          id: msg.tags.get('user-id') ?? '',
          username: user,
          displayName: msg.tags.get('display-name') ?? user,
        },
      })
      message.metadata = { announcement: info.color.toLowerCase() }
      this.emit('message', message)
    })

    // Subscriptions
    client.onSub((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubEvent(msg, 'sub', subInfo)
    })

    // Resubscriptions
    client.onResub((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubEvent(msg, 'resub', subInfo)
    })

    // Sub gifts
    client.onSubGift((channel, user, subInfo, msg) => {
      if (!current()) return
      this.handleSubGiftEvent(msg, user, subInfo)
    })

    // Raids
    client.onRaid((channel, user, raidInfo, msg) => {
      if (!current()) return
      this.handleRaidEvent(msg, raidInfo)
    })

    client.onBan((channel, user, msg) => {
      if (!current()) return
      this.emit('moderation', {
        platform: 'twitch',
        channelId: channel.replace(/^#/, '').toLowerCase(),
        action: 'ban',
        targetUserId: msg.tags.get('target-user-id'),
      })
    })

    client.onTimeout((channel, user, duration, msg) => {
      if (!current()) return
      this.emit('moderation', {
        platform: 'twitch',
        channelId: channel.replace(/^#/, '').toLowerCase(),
        action: 'timeout',
        targetUserId: msg.tags.get('target-user-id'),
        durationSeconds: duration,
      })
    })
    client.onMessageRemove((channel, messageId) => {
      if (!current()) return
      this.emit('moderation', {
        platform: 'twitch',
        channelId: channel.replace(/^#/, '').toLowerCase(),
        action: 'delete_message',
        messageId,
      })
    })
    client.onChatClear((channel) => {
      if (!current()) return
      this.emit('chat_clear', {
        platform: 'twitch',
        channelId: channel.replace(/^#/, '').toLowerCase(),
      })
    })
    client.onSlow((channel, enabled, delay) =>
      current()
        ? this.updateRoomState(channel, { slowSeconds: enabled ? (delay ?? 30) : 0 })
        : undefined,
    )
    client.onFollowersOnly((channel, enabled, delay) =>
      current()
        ? this.updateRoomState(channel, { followersOnlyMinutes: enabled ? (delay ?? 0) : null })
        : undefined,
    )
    client.onSubsOnly((channel, enabled) =>
      current() ? this.updateRoomState(channel, { subscribersOnly: enabled }) : undefined,
    )
    client.onEmoteOnly((channel, enabled) =>
      current() ? this.updateRoomState(channel, { emoteOnly: enabled }) : undefined,
    )
    client.onUniqueChat((channel, enabled) =>
      current() ? this.updateRoomState(channel, { uniqueChat: enabled }) : undefined,
    )
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
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
      }
      log.info('[Twitch] Reconnecting in 5s...')
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        // Twurple may have reconnected on its own while the timer was pending —
        // don't tear down a healthy client just to rebuild it.
        if (this.isConnected) {
          return
        }
        runInBackground(this.connectChatClient(), 'adapter background operation failed')
      }, 5000)
    }
  }

  private async handleAuthFailure(): Promise<void> {
    const accountId = this.accountId
    if (!accountId) {
      return
    }

    try {
      log.info('[Twitch] Attempting token refresh after auth failure...')
      const token = await refreshTwitchToken(accountId)
      if (this.accountId !== accountId || AccountStore.findByPlatform('twitch')?.id !== accountId)
        return
      this.accessToken = token
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
      this.chatClient.quit()
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
        const accountId = this.accountId
        const token = await refreshTwitchToken(accountId)
        if (this.accountId !== accountId || AccountStore.findByPlatform('twitch')?.id !== accountId)
          return false
        this.accessToken = token
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

  private emitLocalSentMessage(channelId: string, text: string, replyToMessageId?: string): void {
    try {
      const displayName = this.displayName ?? this.login
      if (!displayName) {
        log.warn(
          '[Twitch] Sent message succeeded but account identity is unavailable for local echo',
          {
            channelId,
          },
        )
        return
      }

      const reply = replyToMessageId
        ? this.findReplyContext(channelId, replyToMessageId)
        : undefined

      this.emit(
        'message',
        createLocalTwitchSentMessage({
          author: {
            ...twitchAuthorAppearance(
              this.selfTags,
              this.badgeCache,
              Boolean(this.login) &&
                this.login?.toLowerCase() === channelId.replace(/^#/, '').toLowerCase(),
            ),
            avatarUrl: AccountStore.findByPlatform('twitch')?.avatarUrl,
            displayName,
            id: this.platformUserId ?? this.accountId ?? this.login ?? 'twitch-self',
            username: this.login ?? undefined,
          },
          channelId,
          reply,
          text,
        }),
      )
    } catch (error) {
      log.error('[Twitch] Failed to emit local sent message', {
        channelId,
        error: String(error),
      })
    }
  }

  private findReplyContext(
    channelId: string,
    replyToMessageId: string,
  ): NormalizedChatMessage['reply'] | undefined {
    const replyTarget = MessageStore.getRecent(250).find(
      (message) =>
        message.platform === 'twitch' &&
        message.channelId === channelId.toLowerCase() &&
        message.id === replyToMessageId,
    )

    if (!replyTarget) {
      return undefined
    }

    return {
      parentAuthor: {
        displayName: replyTarget.author.displayName,
        id: replyTarget.author.id,
        username: replyTarget.author.username ?? '',
      },
      parentMessageId: replyTarget.id,
      parentMessageText: replyTarget.text,
    }
  }

  private async handleChatMessage(msg: ChatMessage, isAction = false): Promise<void> {
    // Messages only arrive after a successful join — recover the status if the
    // matching onJoin was missed (e.g. join fired before handlers attached).
    if (!this.isConnected) {
      this.isConnected = true
      this.emit('status', {
        channelLogin: this.channelName,
        mode: this.anonymous ? 'anonymous' : 'authenticated',
        platform: 'twitch',
        status: 'connected',
      })
    }

    const avatarUrl = await resolveTwitchAvatarUrl({ authorId: msg.tags.get('user-id') })
    const normalized = normalizeTwitchChatMessage(msg, this.badgeCache, { avatarUrl, isAction })

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
    const revision = this.identityRevision
    const channelName = this.channelName
    const url = new URL(`${getBackendUrl()}/api/twitch/badges`)
    if (channelName) {
      url.searchParams.set('broadcasterLogin', channelName)
    }

    try {
      const res = await fetch(url.toString())
      if (!res.ok) {
        log.warn(`[Twitch] Badge fetch failed: ${res.status}`)
        return
      }
      const data = z.object({ badges: z.record(z.string(), z.string()) }).parse(await res.json())
      if (revision !== this.identityRevision || channelName !== this.channelName) return
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }
}
