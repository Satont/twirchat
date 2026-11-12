import { logger } from '@twirchat/shared/logger'
import type {
  YouTubeChatBatch,
  YouTubeChatRelayEvent,
  YouTubeChatCredentials,
} from '@twirchat/shared/youtube-chat'
import { resolveYouTubeLiveChat, YouTubeDiscoveryError } from '@twirchat/shared/youtube/discovery'
import { createYouTubeChatNormalizer } from '@twirchat/shared/youtube/normalizer'
import type { createYouTubeGrpcSession } from '@twirchat/shared/youtube/session'

import { AccountStore } from '../../store/account-store'
import { BasePlatformAdapter } from '../base-adapter'

const log = logger('youtube')
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
export interface YouTubeChatRelay {
  subscribe(
    options: { channelId: string; pageToken?: string },
    handler: (event: YouTubeChatRelayEvent) => void,
  ): () => void
}
let relay: YouTubeChatRelay | undefined
export function configureYouTubeChatRelay(value: YouTubeChatRelay): void {
  relay = value
}

/** Official server-streaming gRPC for OAuth, backend gRPC relay for anonymous viewing. */
export class YouTubeAdapter extends BasePlatformAdapter {
  constructor(
    private readonly transport: {
      resolveLiveChat?: typeof resolveYouTubeLiveChat
      createSession?: typeof createYouTubeGrpcSession
    } = {},
  ) {
    super()
  }

  readonly platform = 'youtube'
  private channelId = ''
  private liveChatId: string | null = null
  private accessToken: string | null = null
  private accountId: string | null = null
  private identityRevision = 0
  private session: ReturnType<typeof createYouTubeGrpcSession> | undefined
  private unsubscribe: (() => void) | undefined

  private emitStatus(
    status: 'connecting' | 'connected' | 'disconnected' | 'error',
    error?: string,
  ): void {
    this.emit('status', {
      platform: 'youtube',
      channelLogin: this.channelId,
      mode: this.accountId ? 'authenticated' : 'anonymous',
      status,
      ...(error ? { error } : {}),
    })
  }
  private deliver(batch: YouTubeChatBatch): void {
    for (const message of batch.messages)
      this.emit('message', {
        ...message,
        channelId: this.channelId,
        timestamp: new Date(message.timestamp),
      })
    for (const event of batch.events)
      this.emit('event', { ...event, timestamp: new Date(event.timestamp) })
    for (const moderation of batch.moderation)
      this.emit('moderation', { ...moderation, channelId: this.channelId })
  }
  async connect(channelId: string): Promise<void> {
    await this.disconnect()
    const revision = ++this.identityRevision
    const current = () =>
      revision === this.identityRevision &&
      (AccountStore.findByPlatform('youtube')?.id ?? null) === this.accountId
    this.channelId = channelId
    const account = AccountStore.findByPlatform('youtube')
    this.accountId = account?.id ?? null
    this.accessToken = account ? (AccountStore.getTokens(account.id)?.accessToken ?? null) : null
    this.emitStatus('connecting')
    try {
      if (!this.accountId) {
        if (!relay) throw new Error('YouTube anonymous chat requires a backend connection.')
        this.unsubscribe = relay.subscribe({ channelId }, (event) => {
          if (!current()) return
          if (event.type === 'ready') this.liveChatId = event.liveChatId
          else if (event.type === 'batch') this.deliver(event.batch)
          else this.emitStatus(event.status, event.error)
        })
        return
      }
      const getCredentials = async (forceRefresh = false): Promise<YouTubeChatCredentials> => {
        if (!current()) throw new Error('YouTube account changed.')
        await this.refreshTokenIfNeeded(forceRefresh)
        if (!current() || !this.accessToken)
          throw new Error('YouTube OAuth credentials unavailable. Sign in again.')
        return { accessToken: this.accessToken }
      }
      const discover = async (forceRefresh = false) =>
        (this.transport.resolveLiveChat ?? resolveYouTubeLiveChat)({
          channelId,
          credentials: await getCredentials(forceRefresh),
        })
      let resolved: Awaited<ReturnType<typeof resolveYouTubeLiveChat>>
      try {
        resolved = await discover()
      } catch (error) {
        if (!(error instanceof YouTubeDiscoveryError) || error.status !== 401 || !current())
          throw error
        resolved = await discover(true)
      }
      if (!current()) return
      const createSession =
        this.transport.createSession ??
        (await import('@twirchat/shared/youtube/session')).createYouTubeGrpcSession
      if (!current()) return
      this.liveChatId = resolved.liveChatId
      const normalizer = createYouTubeChatNormalizer({ channelId })
      this.session = createSession({
        liveChatId: resolved.liveChatId,
        getCredentials,
        onBatch: (batch) => {
          if (current()) this.deliver(normalizer.normalize(batch))
        },
        onStatus: (status, error) => {
          if (current()) this.emitStatus(status, error)
        },
      })
      await this.session.start()
    } catch (error) {
      if (current())
        this.emitStatus('error', error instanceof Error ? error.message : String(error))
    }
  }
  async disconnect(): Promise<void> {
    this.identityRevision++
    this.session?.stop()
    this.session = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.accountId = null
    this.accessToken = null
    this.liveChatId = null
    this.emitStatus('disconnected')
  }
  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const revision = this.identityRevision
    if (!this.accessToken || AccountStore.findByPlatform('youtube')?.id !== this.accountId) {
      throw new Error('No active YouTube account credentials')
    }

    const res = await fetch(url, {
      ...options,
      headers: {
        ...Object.fromEntries(new Headers(options.headers).entries()),
        Authorization: `Bearer ${this.accessToken}`,
      },
    })

    // If 401, try to refresh token and retry once
    if (res.status === 401 && this.accountId) {
      if (revision !== this.identityRevision)
        throw new Error('The YouTube account changed during this request.')
      log.info('[YouTube] Got 401, attempting token refresh...')
      const refreshed = await this.refreshTokenIfNeeded(true)
      if (revision !== this.identityRevision)
        throw new Error('The YouTube account changed while refreshing credentials.')
      if (refreshed) {
        return fetch(url, {
          ...options,
          headers: {
            ...Object.fromEntries(new Headers(options.headers).entries()),
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
  private async refreshTokenIfNeeded(force = false): Promise<boolean> {
    if (!this.accountId) {
      return false
    }

    const tokens = AccountStore.getTokens(this.accountId)
    if (!tokens?.refreshToken) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (force || (tokens.expiresAt && tokens.expiresAt < now + 300)) {
      log.info('[YouTube] Token expired or expiring soon, refreshing...')
      try {
        const { refreshYouTubeToken } = await import('../../auth/youtube.js')
        const accountId = this.accountId
        const token = await refreshYouTubeToken(accountId)
        if (
          this.accountId !== accountId ||
          AccountStore.findByPlatform('youtube')?.id !== accountId
        )
          return false
        this.accessToken = token
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

    log.info('[YouTube] Message sent')
  }
}
