import { VKPLAY_API_BASE, VKPLAY_DEV_API_BASE } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { NormalizedEvent, PlatformStatusInfo } from '@twirchat/shared/types'
import { z } from 'zod'

import { refreshVkPlayToken } from '../../auth/vkplay'
import { AccountStore } from '../../store/account-store'
import { BasePlatformAdapter } from '../base-adapter'
import { VkPlayCentrifuge, type VkPlayPush } from './centrifuge'
import { normalizeVkPlayMessage, vkPlayMessageSchema, vkPlayUserSchema } from './normalize'

const log = logger('vkplay')

const blogSchema = z.object({
  blogUrl: z.string(),
  hasChat: z.boolean().optional(),
  publicWebSocketChannel: z.string().min(1),
})

const publicVideoStreamSchema = z.object({
  count: z.object({ viewers: z.number().int().nonnegative().optional() }).optional(),
  id: z.string().min(1),
  isOnline: z.boolean().optional(),
  wsChatChannel: z.string().optional(),
  wsStreamChannel: z.string().optional(),
})

const websocketTokenSchema = z.object({ token: z.string().min(1) })
const pushDataSchema = z.object({ type: z.string() }).passthrough()
const messagePushSchema = z.object({
  data: vkPlayMessageSchema,
  type: z.literal('message'),
})
const followPushSchema = z.object({
  data: z.object({
    follower: vkPlayUserSchema,
    type: z.literal('following'),
  }),
  type: z.literal('actions_journal_new_event'),
})
const rewardPushSchema = z.object({
  data: z.object({
    reward: z.object({ name: z.string(), price: z.number().int().optional() }),
    user: vkPlayUserSchema,
  }),
  type: z.literal('cp_reward_demand'),
})

function requestHeaders(token?: string): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Origin: 'https://live.vkvideo.ru',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  }
}

async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...requestHeaders(),
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `VK Play Live request failed (HTTP ${response.status})${body ? `: ${body}` : ''}`,
    )
  }
  return response.json()
}

export class VkPlayAdapter extends BasePlatformAdapter {
  readonly platform = 'vkplay'
  private channelSlug = ''
  private chatChannels: string[] = []
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
    this.chatChannels = []
    this.streamId = null
    this.accountId = AccountStore.findByPlatform('vkplay')?.id ?? null
    this.failures = 0
    this.shouldReconnect = true
    this.emitStatus('connecting')
    try {
      await this.startAttempt(generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.emitStatus('error', error instanceof Error ? error.message : String(error))
      this.scheduleReconnect(generation)
    }
  }

  async disconnect(): Promise<void> {
    this.generation++
    this.shouldReconnect = false
    this.clearReconnect()
    this.centrifugeClose()
    this.accountId = null
    this.channelSlug = ''
    this.chatChannels = []
    this.streamId = null
    this.emitStatus('disconnected')
  }

  async sendMessage(channelId: string, text: string): Promise<{ channelId: string }> {
    const accountId = this.accountId
    if (!accountId) throw new Error('Sign in to VK Play Live before sending messages.')
    if (!text.trim()) throw new Error('A message cannot be empty.')
    const slug = this.channelSlug || channelId
    const streamId = this.streamId ?? (await this.loadStreamId(slug))
    if (!streamId) throw new Error('VK Play Live chat is available only while a stream exists.')
    const url = new URL(`${VKPLAY_DEV_API_BASE}/chat/message/send`)
    url.search = new URLSearchParams({
      channel_url: slug,
      stream_id: streamId,
    }).toString()
    const send = (token: string) =>
      fetch(url, {
        body: JSON.stringify({ parts: [{ text: { content: text } }] }),
        headers: {
          ...requestHeaders(token),
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      })
    let token = await this.sendToken(accountId, false)
    let response = await send(token)
    if (response.status === 401 || response.status === 403) {
      token = await this.sendToken(accountId, true)
      response = await send(token)
    }
    if (!response.ok) {
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

  private async startAttempt(generation: number): Promise<void> {
    const slug = this.channelSlug
    const blog = blogSchema.parse(
      await requestJson(`${VKPLAY_API_BASE}/blog/${encodeURIComponent(slug)}`),
    )
    if (generation !== this.generation) return
    if (blog.hasChat === false) throw new Error('This VK Play Live channel has chat disabled.')

    const stream = await this.loadStream(slug).catch((error: unknown) => {
      log.info('Channel stream lookup failed', { channel: slug, error: String(error) })
      return null
    })
    if (generation !== this.generation) return
    this.streamId = stream?.id ?? null
    const publicId = blog.publicWebSocketChannel.split(':').at(-1) ?? blog.publicWebSocketChannel
    this.chatChannels = [
      ...new Set(
        [stream?.wsChatChannel, `public-chat:${publicId}`].filter((channel): channel is string =>
          Boolean(channel),
        ),
      ),
    ]

    const token = websocketTokenSchema.parse(
      await requestJson(`${VKPLAY_API_BASE}/ws/connect`, { headers: requestHeaders() }),
    ).token
    if (generation !== this.generation) return
    const realtime = new VkPlayCentrifuge({
      onClose: (reason) => this.onRealtimeClose(generation, reason),
      onPush: (push) => {
        if (generation === this.generation) this.onPush(push)
      },
    })
    this.realtime = realtime
    await realtime.connect(token)
    if (generation !== this.generation) {
      realtime.close()
      return
    }
    await Promise.all(this.chatChannels.map((channel) => realtime.subscribe(channel)))
    if (generation !== this.generation) return
    if (stream?.wsStreamChannel) {
      await realtime.subscribe(stream.wsStreamChannel).catch((error: unknown) => {
        log.info('Stream info subscription failed', { error: String(error) })
      })
    }
    if (generation !== this.generation) return
    this.failures = 0
    this.emitStatus('connected')
  }

  private async loadStream(
    channelSlug: string,
  ): Promise<z.infer<typeof publicVideoStreamSchema> | null> {
    const data = await requestJson(
      `${VKPLAY_API_BASE}/blog/${encodeURIComponent(channelSlug)}/public_video_stream`,
    )
    if (!data || typeof data !== 'object') return null
    return publicVideoStreamSchema.parse(data)
  }

  private async loadStreamId(channelSlug: string): Promise<string | null> {
    const stream = await this.loadStream(channelSlug)
    this.streamId = stream?.id ?? null
    return this.streamId
  }

  private async sendToken(accountId: string, force: boolean): Promise<string> {
    if (AccountStore.findByPlatform('vkplay')?.id !== accountId) {
      throw new Error('The VK Play Live account changed.')
    }
    let tokens = AccountStore.getTokens(accountId)
    if (force || !tokens?.accessToken || this.expiring(tokens.expiresAt)) {
      await refreshVkPlayToken(accountId)
      if (AccountStore.findByPlatform('vkplay')?.id !== accountId) {
        throw new Error('The VK Play Live account changed while refreshing credentials.')
      }
      tokens = AccountStore.getTokens(accountId)
    }
    if (!tokens?.accessToken) throw new Error('VK Play Live credentials are unavailable.')
    return tokens.accessToken
  }

  private expiring(expiresAt: number | undefined): boolean {
    return expiresAt !== undefined && expiresAt <= Math.floor(Date.now() / 1000) + 300
  }

  private onPush(push: VkPlayPush['push']): void {
    const data = pushDataSchema.safeParse(push.pub.data)
    if (!data.success) return
    if (data.data.type === 'message') {
      const message = messagePushSchema.safeParse(push.pub.data)
      if (message.success)
        this.emit('message', normalizeVkPlayMessage(message.data.data, this.channelSlug))
      return
    }
    if (data.data.type === 'actions_journal_new_event') {
      const follow = followPushSchema.safeParse(push.pub.data)
      if (follow.success) this.emit('event', this.followEvent(follow.data.data.follower))
      return
    }
    if (data.data.type === 'cp_reward_demand') {
      const reward = rewardPushSchema.safeParse(push.pub.data)
      if (reward.success)
        this.emit('event', this.rewardEvent(reward.data.data.reward, reward.data.data.user))
    }
  }

  private followEvent(user: z.infer<typeof vkPlayUserSchema>): NormalizedEvent {
    return {
      data: {},
      id: `vkplay:follow:${user.id}:${Date.now()}`,
      platform: 'vkplay',
      timestamp: new Date(),
      type: 'follow',
      user: {
        avatarUrl: user.hasAvatar === false ? undefined : user.avatarUrl,
        displayName: user.displayName ?? user.nick,
        id: String(user.id),
      },
    }
  }

  private rewardEvent(
    reward: { name: string; price?: number },
    user: z.infer<typeof vkPlayUserSchema>,
  ): NormalizedEvent {
    return {
      data: { rewardCost: reward.price, rewardTitle: reward.name },
      id: `vkplay:reward:${user.id}:${Date.now()}`,
      platform: 'vkplay',
      timestamp: new Date(),
      type: 'bits',
      user: {
        avatarUrl: user.hasAvatar === false ? undefined : user.avatarUrl,
        displayName: user.displayName ?? user.nick,
        id: String(user.id),
      },
    }
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
        this.emitStatus('error', error instanceof Error ? error.message : String(error))
        this.scheduleReconnect(generation)
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
