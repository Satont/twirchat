/**
 * YouTube Platform Adapter (Unofficial API via youtubei.js)
 *
 * Connects to YouTube Live Chat using the unofficial Innertube API via youtubei.js.
 * This does NOT require OAuth for reading chat and does NOT consume YouTube API quota.
 *
 * Flow:
 *   1. Get the channel's live streams using Innertube
 *   2. Get video info and live chat continuation
 *   3. Start polling for chat messages via EventEmitter
 *   4. Normalize incoming messages and emit them
 *
 * Auth: Not required for reading. OAuth only needed for sending messages.
 */

import type { YT, YTNodes } from 'youtubei.js'
import { Innertube, UniversalCache } from 'youtubei.js'

import { BasePlatformAdapter } from '../base-adapter.js'
import { AccountStore } from '../../store/account-store.js'
import { getBackendUrl } from '../../runtime-config.js'
import type { Badge, NormalizedChatMessage, NormalizedEvent } from '@twirchat/shared/types'
import { logger } from '@twirchat/shared/logger'

const log = logger('youtube')

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

// Extract types from youtubei.js YT namespace
type LiveChatInstance = InstanceType<typeof YT.LiveChat>

// ChatAction union type based on youtubei.js YTNodes action types
type ChatAction =
  | InstanceType<typeof YTNodes.AddChatItemAction>
  | InstanceType<typeof YTNodes.AddBannerToLiveChatCommand>
  | InstanceType<typeof YTNodes.AddLiveChatTickerItemAction>
  | InstanceType<typeof YTNodes.MarkChatItemAsDeletedAction>
  | InstanceType<typeof YTNodes.MarkChatItemsByAuthorAsDeletedAction>
  | InstanceType<typeof YTNodes.ReplaceChatItemAction>
  | InstanceType<typeof YTNodes.ReplayChatItemAction>
  | InstanceType<typeof YTNodes.ShowLiveChatActionPanelAction>

type AddChatItemActionType = InstanceType<typeof YTNodes.AddChatItemAction>
type LiveChatTextMessage = InstanceType<typeof YTNodes.LiveChatTextMessage>
type LiveChatPaidMessage = InstanceType<typeof YTNodes.LiveChatPaidMessage>
type LiveChatMembershipItem = InstanceType<typeof YTNodes.LiveChatMembershipItem>
type LiveChatPaidSticker = InstanceType<typeof YTNodes.LiveChatPaidSticker>

export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = 'youtube' as const

  private channelId = ''
  private resolvedChannelId: string | null = null
  private shouldReconnect = true
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_DELAY = 60_000
  private readonly BASE_RECONNECT_DELAY = 5000

  private innertube: Awaited<ReturnType<typeof Innertube.create>> | null = null
  private liveChat: LiveChatInstance | null = null
  private isAuthenticated = false

  // For sending messages via official API
  private liveChatId: string | null = null
  private accessToken: string | null = null
  private accountId: string | null = null

  async connect(channelIdOrHandle: string): Promise<void> {
    this.channelId = channelIdOrHandle
    this.shouldReconnect = true
    this.reconnectAttempts = 0

    // Check if user is authenticated with YouTube
    const account = AccountStore.findByPlatform('youtube')
    this.isAuthenticated = Boolean(account)

    if (account) {
      this.accountId = account.id
      const tokens = AccountStore.getTokens(account.id)
      if (tokens) {
        this.accessToken = tokens.accessToken
      }
    }

    this.emitStatus('connecting')

    // Resolve channel ID from handle if needed
    try {
      this.resolvedChannelId = await this.resolveChannelId(channelIdOrHandle)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[YouTube] Failed to resolve channel: ${errorMessage}`)

      this.emitStatus('error', errorMessage)
      return
    }

    await this.tryConnect()
  }

  private emitStatus(
    status: 'connecting' | 'connected' | 'disconnected' | 'error',
    error?: string,
  ): void {
    this.emit('status', {
      channelLogin: this.channelId,
      mode: this.isAuthenticated ? 'authenticated' : 'anonymous',
      platform: 'youtube',
      status,
      ...(error && { error }),
    })
  }

  /**
   * Resolves a channel ID from handle/username.
   * - If input starts with UC, uses it directly as channel ID
   * - If starts with @, checks authenticated account first, then falls back to backend resolve
   * - Otherwise treats as username and tries to resolve
   */
  private async resolveChannelId(input: string): Promise<string> {
    const cleanInput = input.trim()

    // If already a channel ID (starts with UC), use directly
    if (/^UC/i.test(cleanInput)) {
      log.info(`[YouTube] Using channel ID directly: ${cleanInput}`)
      return cleanInput
    }

    // Strip @ prefix for handle lookup
    const handle = cleanInput.startsWith('@') ? cleanInput : `@${cleanInput}`
    const handleWithoutAt = handle.slice(1)

    // First, check if we have an authenticated account with matching username
    const account = AccountStore.findByPlatform('youtube')
    if (account) {
      // Check if username matches (with or without @)
      if (account.username === handle || account.username === handleWithoutAt) {
        log.info(`[YouTube] Found channel ID from authenticated account: ${account.platformUserId}`)
        return account.platformUserId
      }

      // If input matches platformUserId directly
      if (account.platformUserId === cleanInput) {
        return account.platformUserId
      }
    }

    // Fall back to backend resolve
    log.info(`[YouTube] Resolving handle via backend: ${handle}`)
    const resolvedId = await this.resolveHandleViaBackend(handleWithoutAt)
    if (resolvedId) {
      return resolvedId
    }

    throw new Error(
      `Could not resolve "${input}" to a YouTube channel ID. Make sure the handle is correct.`,
    )
  }

  /**
   * Calls the backend /api/youtube/resolve endpoint to get a channel ID.
   * The backend caches results and uses a server-side API key.
   */
  private async resolveHandleViaBackend(handle: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${getBackendUrl()}/api/youtube/resolve?handle=${encodeURIComponent(handle)}`,
      )
      if (res.ok) {
        const body = (await res.json()) as { channelId?: string; error?: string }
        if (body.channelId) {
          log.info(`[YouTube] Backend resolved handle to channel: ${body.channelId}`)
          return body.channelId
        }
        log.warn(`[YouTube] Backend resolve returned no channelId`, { body })
      } else {
        const body = await res.text()
        log.warn(`[YouTube] Backend resolve failed: ${res.status}`, { body: body.slice(0, 300) })
      }
    } catch (error) {
      log.warn(`[YouTube] Backend resolve request failed`, { error: String(error) })
    }
    return null
  }

  private currentVideoId: string | null = null

  private async tryConnect(): Promise<void> {
    if (!this.shouldReconnect) {
      return
    }

    const channelIdToUse = this.resolvedChannelId || this.channelId

    try {
      // Create Innertube instance
      if (!this.innertube) {
        log.info('[YouTube] Creating Innertube instance...')
        this.innertube = await Innertube.create({
          cache: new UniversalCache(false),
        })
      }

      // Get channel
      log.info(`[YouTube] Looking up channel: ${channelIdToUse}`)
      const channel = await this.innertube.getChannel(channelIdToUse)

      // Get live streams
      const liveStreams = await channel.getLiveStreams()

      if (!liveStreams.videos || liveStreams.videos.length === 0) {
        log.info('[YouTube] No active live stream found')
        this.emitStatus('connecting', 'Waiting for live stream to start...')

        this.scheduleReconnect()
        return
      }

      const liveVideo = liveStreams.videos[0]

      // Check if liveVideo has the required properties
      if (!liveVideo || typeof liveVideo !== 'object') {
        throw new Error('Invalid live video data')
      }

      // Type guard for Video type which has id and title
      const videoId = (liveVideo as { id?: string }).id
      const videoTitle = (liveVideo as { title?: string }).title

      if (!videoId) {
        throw new Error('Live video has no ID')
      }

      // Save videoId for later use (to get liveChatId when sending messages)
      this.currentVideoId = videoId

      log.info(`[YouTube] Found live stream: ${videoTitle || 'Unknown'} (${videoId})`)

      // Get video info
      const videoInfo = await this.innertube.getInfo(videoId)

      // Get live chat
      this.liveChat = videoInfo.getLiveChat()

      if (!this.liveChat) {
        throw new Error('Live chat not available for this video')
      }

      // Set up event handlers
      this.setupLiveChatHandlers()

      // Start live chat
      this.liveChat.start()

      this.reconnectAttempts = 0

      this.emitStatus('connected')

      log.info('[YouTube] Connected to live chat')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[YouTube] Connection error: ${errorMessage}`)

      this.emitStatus('error', errorMessage)

      this.scheduleReconnect()
    }
  }

  private setupLiveChatHandlers(): void {
    if (!this.liveChat) {
      return
    }

    this.liveChat.on('start', () => {
      log.info('[YouTube] Live chat started')
    })

    this.liveChat.on('chat-update', (action: unknown) => {
      this.handleChatAction(action as ChatAction)
    })

    this.liveChat.on('end', () => {
      log.info('[YouTube] Live chat ended')
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    })

    this.liveChat.on('error', (err: Error) => {
      log.error(`[YouTube] Live chat error: ${err.message}`)
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    })
  }

  private handleChatAction(action: ChatAction): void {
    if (action.type !== 'AddChatItemAction') {
      return
    }

    const { item } = action as AddChatItemActionType
    if (!item) {
      return
    }

    // Handle text messages
    if (item.type === 'LiveChatTextMessage') {
      this.handleTextMessage(item as LiveChatTextMessage)
      return
    }

    // Handle super chat (paid messages)
    if (item.type === 'LiveChatPaidMessage') {
      this.handleSuperChat(item as LiveChatPaidMessage)
      return
    }

    // Handle membership
    if (item.type === 'LiveChatMembershipItem') {
      this.handleMembership(item as LiveChatMembershipItem)
      return
    }

    // Handle paid stickers
    if (item.type === 'LiveChatPaidSticker') {
      this.handlePaidSticker(item as LiveChatPaidSticker)
      return
    }
  }

  private handleTextMessage(item: LiveChatTextMessage): void {
    const { author } = item
    if (!author) {
      return
    }

    const text = this.extractTextFromRuns(item.message)
    if (!text) {
      return
    }

    const badges = this.extractBadges(author)
    const avatarUrl = author.best_thumbnail?.url

    const normalized: NormalizedChatMessage = {
      author: {
        avatarUrl,
        badges,
        displayName: author.name,
        id: author.id,
      },
      channelId: this.channelId,
      emotes: [],
      id: item.id,
      platform: 'youtube',
      text,
      timestamp: new Date(item.timestamp),
      type: 'message',
    }

    this.emit('message', normalized)
  }

  private handleSuperChat(item: LiveChatPaidMessage): void {
    const { author } = item
    if (!author) {
      return
    }

    const text = this.extractTextFromRuns(item.message)
    const avatarUrl = author.best_thumbnail?.url

    const event: NormalizedEvent = {
      data: {
        amount: item.purchase_amount,
        comment: text,
        currency: this.extractCurrency(item.purchase_amount),
      },
      id: item.id,
      platform: 'youtube',
      timestamp: new Date(item.timestamp),
      type: 'superchat',
      user: {
        avatarUrl,
        displayName: author.name,
        id: author.id,
      },
    }

    this.emit('event', event)
  }

  private handleMembership(item: LiveChatMembershipItem): void {
    const { author } = item
    if (!author) {
      return
    }

    const avatarUrl = author.best_thumbnail?.url
    const headerText = item.header_primary_text
      ? this.extractTextFromRuns(item.header_primary_text)
      : undefined
    const subtext = item.header_subtext ? this.extractTextFromRuns(item.header_subtext) : undefined

    const event: NormalizedEvent = {
      data: {
        headerText,
        message: item.message ? this.extractTextFromRuns(item.message) : undefined,
        subtext,
      },
      id: item.id,
      platform: 'youtube',
      timestamp: new Date(item.timestamp),
      type: 'membership',
      user: {
        avatarUrl,
        displayName: author.name,
        id: author.id,
      },
    }

    this.emit('event', event)
  }

  private handlePaidSticker(item: LiveChatPaidSticker): void {
    const { author } = item
    if (!author) {
      return
    }

    const avatarUrl = author.best_thumbnail?.url

    const event: NormalizedEvent = {
      data: {
        amount: item.purchase_amount,
        currency: this.extractCurrency(item.purchase_amount),
        sticker: true,
      },
      id: item.id,
      platform: 'youtube',
      timestamp: new Date(),
      type: 'superchat',
      user: {
        avatarUrl,
        displayName: author.name,
        id: author.id,
      },
    }

    this.emit('event', event)
  }

  private extractTextFromRuns(textObj: unknown): string {
    if (!textObj || typeof textObj !== 'object') {
      return ''
    }

    // Handle Text objects from youtubei.js
    const obj = textObj as {
      runs?: {
        text?: string
        emoji?: {
          emoji_id?: string
          shortcuts?: string[]
          image?: { url?: string }
        }
      }[]
      text?: string
    }

    if (obj.text) {
      return obj.text
    }

    if (obj.runs && Array.isArray(obj.runs)) {
      return obj.runs
        .map((run) => {
          if (run.text) {
            return run.text
          }
          if (run.emoji) {
            // Return emoji shortcut if available, otherwise empty
            return run.emoji.shortcuts?.[0] || ''
          }
          return ''
        })
        .join('')
    }

    return ''
  }

  private extractBadges(author: {
    badges?: { type?: string; icon_type?: string }[]
    is_moderator?: boolean
  }): Badge[] {
    const badges: Badge[] = []

    if (author.is_moderator) {
      badges.push({ id: 'mod', text: 'Moderator', type: 'moderator' })
    }

    if (author.badges && Array.isArray(author.badges)) {
      for (const badge of author.badges) {
        if (badge.icon_type === 'OWNER') {
          badges.push({ id: 'owner', text: 'Owner', type: 'broadcaster' })
        } else if (badge.icon_type === 'VERIFIED') {
          badges.push({ id: 'verified', text: 'Verified', type: 'staff' })
        } else if (badge.type?.includes('MEMBER')) {
          badges.push({ id: 'member', text: 'Member', type: 'subscriber' })
        }
      }
    }

    return badges
  }

  private extractCurrency(amountStr: string): string {
    // Extract currency from amount string like "$10.00" or "€5.00"
    const match = amountStr.match(/^[^\d\s,.]+/)
    return match ? match[0] : 'USD'
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.liveChat) {
      this.liveChat.stop()
      this.liveChat = null
    }

    this.innertube = null

    this.emitStatus('disconnected')

    log.info('[YouTube] Disconnected')
  }

  /**
   * Fetches the liveChatId using the official YouTube API.
   * Uses the videoId we already got from Innertube (no extra search request).
   */
  private async fetchLiveChatId(): Promise<string | null> {
    if (!this.accessToken) {
      log.warn('[YouTube] Cannot fetch liveChatId: no access token')
      return null
    }

    if (!this.currentVideoId) {
      log.warn('[YouTube] Cannot fetch liveChatId: no videoId')
      return null
    }

    try {
      // Get liveChatId from video details (only 1 API call)
      const videoRes = await this.fetchWithAuth(
        `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(this.currentVideoId)}`,
      )

      if (!videoRes.ok) {
        const body = await videoRes.text()
        log.warn(`[YouTube] Video details failed: ${videoRes.status}`, { body: body.slice(0, 300) })
        return null
      }

      const videoBody = (await videoRes.json()) as {
        items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[]
      }
      const liveChatId = videoBody.items?.[0]?.liveStreamingDetails?.activeLiveChatId

      if (liveChatId) {
        log.info(`[YouTube] Found liveChatId: ${liveChatId}`)
      }

      return liveChatId ?? null
    } catch (error) {
      log.error(`[YouTube] Failed to fetch liveChatId`, { error: String(error) })
      return null
    }
  }

  /**
   * Makes an authenticated request to YouTube API.
   * Automatically refreshes token on 401.
   */
  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) {
      throw new Error('No access token')
    }

    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    })

    // If 401, try to refresh token and retry once
    if (res.status === 401 && this.accountId) {
      log.info('[YouTube] Got 401, attempting token refresh...')
      const refreshed = await this.refreshTokenIfNeeded()
      if (refreshed) {
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        })
      }
    }

    return res
  }

  /**
   * Refreshes the access token if needed.
   */
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
      log.info('[YouTube] Token expired or expiring soon, refreshing...')
      try {
        const { refreshYouTubeToken } = await import('../../auth/youtube.js')
        this.accessToken = await refreshYouTubeToken(this.accountId)
        log.info('[YouTube] Token refreshed successfully')
        return true
      } catch (error) {
        log.error('[YouTube] Failed to refresh token', { error: String(error) })
        return false
      }
    }
    return false
  }

  async sendMessage(_channelId: string, text: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('YouTubeAdapter.sendMessage: not authenticated')
    }

    // Get liveChatId if we don't have it yet (lazy load - only when sending)
    if (!this.liveChatId) {
      this.liveChatId = await this.fetchLiveChatId()
    }

    if (!this.liveChatId) {
      throw new Error('YouTubeAdapter.sendMessage: no active live chat')
    }

    const res = await this.fetchWithAuth(`${YOUTUBE_API_BASE}/liveChat/messages?part=snippet`, {
      body: JSON.stringify({
        snippet: {
          liveChatId: this.liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: {
            messageText: text,
          },
        },
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`YouTube sendMessage failed: ${res.status} ${body}`)
    }

    log.info(`[YouTube] Message sent: ${text.slice(0, 50)}...`)
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Clean up current connection
    if (this.liveChat) {
      this.liveChat.stop()
      this.liveChat = null
    }

    // Calculate exponential backoff with jitter
    const baseDelay = Math.min(
      this.BASE_RECONNECT_DELAY * 2 ** this.reconnectAttempts,
      this.MAX_RECONNECT_DELAY,
    )
    const jitter = Math.random() * 2000
    const delay = baseDelay + jitter

    this.reconnectAttempts++
    log.info(
      `[YouTube] Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts})`,
    )

    this.emitStatus('connecting', `Reconnecting in ${Math.round(delay / 1000)}s...`)

    this.reconnectTimeout = setTimeout(() => {
      this.tryConnect()
    }, delay)
  }
}
