import { VKPLAY_DEV_API_BASE } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { PlatformStatusInfo } from '@twirchat/shared/types'
import { z } from 'zod'

import { AccountStore } from '../../store/account-store'
import { BasePlatformAdapter } from '../base-adapter'
import { VkPlayCentrifuge, type VkPlayPush } from './centrifuge'
import { normalizeVkPlayMessage, vkPlayPublicationSchema } from './normalize'

const log = logger('vkplay')

const streamIdSchema = z
  .union([z.string().min(1), z.number().int()])
  .transform((value) => String(value))
const channelSchema = z.object({
  data: z.object({
    channel: z.object({
      web_socket_channels: z.object({ chat: z.string().min(1) }),
    }),
    stream: z.object({ id: streamIdSchema }).optional(),
  }),
})
const websocketTokenSchema = z.object({
  data: z.object({ token: z.string().min(1) }),
})
const subscriptionTokenSchema = z.object({
  data: z.object({
    channel_tokens: z.array(z.object({ channel: z.string(), token: z.string().min(1) })).optional(),
  }),
})

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Origin: 'https://live.vkvideo.ru',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  }
}

async function requestJson(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${VKPLAY_DEV_API_BASE}${path}`, {
    ...init,
    headers: {
      ...requestHeaders(token),
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.text().catch(() => '')
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : {}
  } catch {
    parsed = {}
  }
  const error = z
    .object({ error: z.string().optional(), error_description: z.string().optional() })
    .safeParse(parsed)
  if (error.success && error.data.error) {
    throw new Error(
      error.data.error_description
        ? `VK Play Live: ${error.data.error_description}`
        : `VK Play Live: ${error.data.error}`,
    )
  }
  if (!response.ok) {
    throw new Error(`VK Play Live request failed (HTTP ${response.status})`)
  }
  return parsed
}

export class VkPlayAdapter extends BasePlatformAdapter {
  readonly platform = 'vkplay'
  private channelSlug = ''
  private chatChannel = ''
  private streamId: string | null = null
  private accountId: string | null = null
  private generation = 0
  private shouldReconnect = false
  private realtime: VkPlayCentrifuge | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private failures = 0

  async connect(channelSlug: string): Promise<void> {
    const slug = channelSlug.trim().replace(/^#/, '').replace(/^@/, '').toLowerCase()
    const generation = ++this.generation
    this.clearReconnect()
    this.centrifugeClose()
    this.channelSlug = slug
    this.chatChannel = ''
    this.streamId = null
    this.accountId = AccountStore.findByPlatform('vkplay')?.id ?? null
    this.shouldReconnect = false
    this.failures = 0
    this.emitStatus('connecting')
    if (!this.accountId) {
      this.emitStatus('error', 'Sign in to VK Play Live to read chat.')
      return
    }
    this.shouldReconnect = true
    try {
      await this.startAttempt(generation)
    } catch (error) {
      if (generation !== this.generation) return
      const message = error instanceof Error ? error.message : String(error)
      log.warn('VK Play Live connection attempt failed', {
        channel: this.channelSlug,
        error: message,
      })
      this.emitStatus('error', message)
      if (!isAuthFailure(message)) this.scheduleReconnect(generation)
    }
  }

  async disconnect(): Promise<void> {
    this.generation++
    this.shouldReconnect = false
    this.clearReconnect()
    this.centrifugeClose()
    this.accountId = null
    this.channelSlug = ''
    this.chatChannel = ''
    this.streamId = null
    this.emitStatus('disconnected')
  }

  async sendMessage(channelId: string, text: string): Promise<{ channelId: string }> {
    const accountId = this.accountId
    if (!accountId) throw new Error('Sign in to VK Play Live before sending messages.')
    if (!text.trim()) throw new Error('A message cannot be empty.')
    const slug = this.channelSlug || channelId
    const token = this.readToken(accountId)
    const streamId = this.streamId ?? (await this.loadChannel(slug, token)).streamId
    if (!streamId) throw new Error('VK Play Live chat is available only while a stream exists.')
    const url = new URL(`${VKPLAY_DEV_API_BASE}/v1/chat/message/send`)
    url.search = new URLSearchParams({ channel_url: slug, stream_id: streamId }).toString()
    const response = await fetch(url, {
      body: JSON.stringify({ parts: [{ text: { content: text } }] }),
      headers: { ...requestHeaders(token), 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('The VK Play Live session expired or was rejected. Sign in again.')
      }
      const body = await response.text().catch(() => '')
      throw new Error(
        `VK Play Live send failed (HTTP ${response.status})${body ? `: ${body}` : ''}`,
      )
    }
    return { channelId: slug }
  }

  private emitStatus(status: PlatformStatusInfo['status'], error?: string): void {
    this.emit('status', {
      ...(this.channelSlug ? { channelLogin: this.channelSlug } : {}),
      mode: this.accountId ? 'authenticated' : 'anonymous',
      platform: 'vkplay',
      status,
      ...(error ? { error } : {}),
    })
  }

  private readToken(accountId: string): string {
    if (AccountStore.findByPlatform('vkplay')?.id !== accountId) {
      throw new Error('The VK Play Live account changed.')
    }
    const tokens = AccountStore.getTokens(accountId)
    if (!tokens?.accessToken) throw new Error('Sign in to VK Play Live again.')
    if (tokens.expiresAt !== undefined && tokens.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new Error('The VK Play Live session expired. Sign in again.')
    }
    return tokens.accessToken
  }

  private async startAttempt(generation: number): Promise<void> {
    const accountId = this.accountId
    if (!accountId) throw new Error('Sign in to VK Play Live to read chat.')
    const token = this.readToken(accountId)
    const channel = await this.loadChannel(this.channelSlug, token)
    if (generation !== this.generation) return
    this.chatChannel = channel.chatChannel
    this.streamId = channel.streamId

    const connection = websocketTokenSchema.parse(await requestJson('/v1/websocket/token', token))
    const subscription = subscriptionTokenSchema.parse(
      await requestJson(
        `/v1/websocket/subscription_token?channels=${encodeURIComponent(this.chatChannel)}`,
        token,
      ),
    )
    const subscriptionToken = subscription.data.channel_tokens?.find(
      (entry) => entry.channel === this.chatChannel,
    )?.token
    if (generation !== this.generation) return

    const realtime = new VkPlayCentrifuge({
      onClose: (reason) => this.onRealtimeClose(generation, reason),
      onPush: (push) => {
        if (generation === this.generation) this.onPush(push)
      },
    })
    this.realtime = realtime
    await realtime.connect(connection.data.token)
    if (generation !== this.generation) {
      realtime.close()
      return
    }
    await realtime.subscribe(this.chatChannel, subscriptionToken)
    if (generation !== this.generation) return
    this.failures = 0
    log.info('VK Play Live chat connected', {
      channel: this.channelSlug,
      chatChannel: this.chatChannel,
    })
    this.emitStatus('connected')
  }

  private async loadChannel(
    channelSlug: string,
    token: string,
  ): Promise<{ chatChannel: string; streamId: string | null }> {
    const value = channelSchema.parse(
      await requestJson(`/v1/channel?channel_url=${encodeURIComponent(channelSlug)}`, token),
    )
    return {
      chatChannel: value.data.channel.web_socket_channels.chat,
      streamId: value.data.stream?.id ?? null,
    }
  }

  private onPush(push: VkPlayPush['push']): void {
    const publication = vkPlayPublicationSchema.safeParse(push.pub.data)
    if (!publication.success) {
      const kind = z.object({ type: z.string() }).safeParse(push.pub.data)
      log.debug('Ignored VK Play Live publication', {
        channel: this.channelSlug,
        type: kind.success ? kind.data.type : 'unknown',
      })
      return
    }
    this.emit(
      'message',
      normalizeVkPlayMessage(publication.data.data.chat_message, this.channelSlug),
    )
  }

  private onRealtimeClose(generation: number, reason: string): void {
    if (generation !== this.generation || !this.shouldReconnect) return
    log.info('VK Play Live chat disconnected', { channel: this.channelSlug, reason })
    this.realtime = null
    this.scheduleReconnect(generation)
  }

  private scheduleReconnect(generation: number): void {
    if (!this.shouldReconnect || generation !== this.generation) return
    this.clearReconnect()
    this.failures += 1
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(this.failures - 1, 4))
    this.emitStatus('connecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.shouldReconnect || generation !== this.generation) return
      this.startAttempt(generation).catch((error: unknown) => {
        if (generation !== this.generation) return
        const message = error instanceof Error ? error.message : String(error)
        log.warn('VK Play Live reconnect failed', { channel: this.channelSlug, error: message })
        this.emitStatus('error', message)
        if (!isAuthFailure(message)) this.scheduleReconnect(generation)
      })
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private centrifugeClose(): void {
    this.realtime?.close()
    this.realtime = null
  }
}

function isAuthFailure(message: string): boolean {
  return message.includes('Sign in') || message.includes('session expired')
}
