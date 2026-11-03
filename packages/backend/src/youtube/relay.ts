import {
  createYouTubeChatNormalizer,
  createYouTubeGrpcSession,
  resolveYouTubeLiveChat,
} from '@twirchat/shared/youtube'
import type { YouTubeChatRelayEvent } from '@twirchat/shared/youtube-chat'
import { z } from 'zod'

type SessionOptions = Parameters<typeof createYouTubeGrpcSession>[0]
type RawBatch = Parameters<SessionOptions['onBatch']>[0]
type ResolvedChat = Awaited<ReturnType<typeof resolveYouTubeLiveChat>>
type Request = { subscriptionId: string; channelId: string; videoId?: string; pageToken?: string }
type Subscriber = {
  client: string
  request: Request
  stream?: Stream
  normalize: (
    raw: RawBatch,
  ) => ReturnType<ReturnType<typeof createYouTubeChatNormalizer>['normalize']>
}
type Stream = {
  chat: ResolvedChat
  subscribers: Set<Subscriber>
  session: ReturnType<typeof createYouTubeGrpcSession>
  active: boolean
}

export interface YouTubeRelayOptions {
  apiKey?: string
  send(client: string, event: YouTubeChatRelayEvent): void
  resolve?: typeof resolveYouTubeLiveChat
  createSession?: typeof createYouTubeGrpcSession
  maxStreams?: number
  maxSubscriptions?: number
  maxSubscriptionsPerClient?: number
  now?: () => number
}

/** One public Google stream per live chat; clients never receive server credentials. */
export class YouTubeChatRelay {
  private clients = new Map<string, Map<string, Subscriber>>()
  private streams = new Map<string, Stream>()
  private resolutions = new Map<
    string,
    { expires: number; promise: Promise<ResolvedChat>; chat?: ResolvedChat }
  >()
  private subscriptions = 0
  private stopped = false

  constructor(private options: YouTubeRelayOptions) {}

  private send(sub: Subscriber, event: YouTubeChatRelayEvent): void {
    if (this.clients.get(sub.client)?.get(sub.request.subscriptionId) !== sub) return
    try {
      this.options.send(sub.client, event)
    } catch {
      this.unsubscribe(sub.client, sub.request.subscriptionId)
    }
  }

  private reject(client: string, subscriptionId: string, error: string): void {
    this.options.send(client, {
      type: 'status',
      subscriptionId,
      status: 'error',
      error,
      terminal: true,
    })
  }

  async subscribe(client: string, input: unknown): Promise<void> {
    const value = z
      .object({
        subscriptionId: z.string(),
        channelId: z.string(),
        videoId: z.string().optional(),
        pageToken: z.string().optional(),
      })
      .safeParse(input).data
    const subscriptionId = typeof value?.subscriptionId === 'string' ? value.subscriptionId : ''
    if (!/^[\w:.-]{1,128}$/.test(subscriptionId)) {
      this.reject(client, '', 'Invalid YouTube subscription ID')
      return
    }
    // A replacement invalidates pending resolution and all callbacks for the prior request.
    this.unsubscribe(client, subscriptionId)
    if (
      !value ||
      typeof value.channelId !== 'string' ||
      !/^[\p{L}\p{N}_@.-]{1,128}$/u.test(value.channelId) ||
      (value.videoId !== undefined &&
        (typeof value.videoId !== 'string' || !/^[\w-]{1,64}$/.test(value.videoId))) ||
      (value.pageToken !== undefined &&
        (typeof value.pageToken !== 'string' || value.pageToken.length > 4096))
    ) {
      this.reject(client, subscriptionId, 'Invalid YouTube subscription request')
      return
    }
    const apiKey = this.options.apiKey?.trim()
    if (this.stopped || !apiKey) {
      this.reject(client, subscriptionId, 'YouTube anonymous chat is unavailable on this server')
      return
    }
    const requests = this.clients.get(client) ?? new Map<string, Subscriber>()
    if (
      requests.size >= (this.options.maxSubscriptionsPerClient ?? 32) ||
      this.subscriptions >= (this.options.maxSubscriptions ?? 1024)
    ) {
      this.reject(client, subscriptionId, 'YouTube subscription limit reached')
      return
    }
    const request = value
    const normalizer = createYouTubeChatNormalizer({ channelId: request.channelId })
    const sub: Subscriber = { client, request, normalize: (raw) => normalizer.normalize(raw) }
    requests.set(subscriptionId, sub)
    this.clients.set(client, requests)
    this.subscriptions++
    this.send(sub, { type: 'status', subscriptionId, status: 'connecting' })
    try {
      const chat = await this.resolve(request)
      if (this.clients.get(client)?.get(subscriptionId) !== sub) return
      let stream = this.streams.get(chat.liveChatId)
      if (!stream) {
        if (this.streams.size >= (this.options.maxStreams ?? 128)) {
          throw new Error('stream_limit')
        }
        let next: Stream | undefined
        const session = (this.options.createSession ?? createYouTubeGrpcSession)({
          liveChatId: chat.liveChatId,
          // Resume belongs to the shared upstream stream, never to an arbitrary new subscriber.
          getCredentials: async () => ({ apiKey }),
          onBatch: (raw) => {
            if (next) this.onBatch(next, raw)
          },
          onStatus: (status, error, terminal) => {
            if (!next?.active) return
            for (const subscriber of [...next.subscribers]) {
              this.send(subscriber, {
                type: 'status',
                subscriptionId: subscriber.request.subscriptionId,
                status,
                error: error ? 'YouTube chat stream unavailable' : undefined,
                terminal,
              })
            }
            if (terminal) this.removeStream(next)
          },
        })
        next = { chat, subscribers: new Set(), active: true, session }
        stream = next
        this.streams.set(chat.liveChatId, stream)
      }
      sub.stream = stream
      stream.subscribers.add(sub)
      this.send(sub, { type: 'ready', subscriptionId, ...chat, channelId: request.channelId })
      if (stream.subscribers.size === 1) {
        void stream.session.start().catch(() => {
          if (!stream.active) return
          for (const subscriber of [...stream.subscribers]) {
            this.send(subscriber, {
              type: 'status',
              subscriptionId: subscriber.request.subscriptionId,
              status: 'error',
              error: 'YouTube chat stream unavailable',
              terminal: true,
            })
          }
          this.removeStream(stream)
        })
      }
    } catch {
      if (this.clients.get(client)?.get(subscriptionId) !== sub) return
      this.send(sub, {
        type: 'status',
        subscriptionId,
        status: 'error',
        error: 'Unable to resolve or subscribe to YouTube live chat',
        terminal: true,
      })
      this.unsubscribe(client, subscriptionId)
    }
  }

  private apiKey(): string {
    const key = this.options.apiKey?.trim()
    if (!key) throw new Error('YouTube anonymous chat is unavailable on this server')
    return key
  }

  private resolve(request: Request): Promise<ResolvedChat> {
    const key = JSON.stringify([request.channelId, request.videoId])
    const now = this.options.now?.() ?? Date.now()
    for (const [cacheKey, entry] of this.resolutions) {
      if (entry.expires <= now) this.resolutions.delete(cacheKey)
    }
    const cached = this.resolutions.get(key)
    if (cached) return cached.promise
    // Also bounds pending metadata requests, including disconnected clients.
    if (this.resolutions.size >= 128) return Promise.reject(new Error('resolution_limit'))
    const promise = (this.options.resolve ?? resolveYouTubeLiveChat)({
      channelId: request.channelId,
      videoId: request.videoId,
      credentials: { apiKey: this.apiKey() },
    })
    const entry: { expires: number; promise: Promise<ResolvedChat>; chat?: ResolvedChat } = {
      expires: Infinity,
      promise,
    }
    this.resolutions.set(key, entry)
    void promise.then(
      (chat) => {
        entry.chat = chat
        entry.expires = (this.options.now?.() ?? Date.now()) + 30_000
      },
      () => {},
    )
    void promise.catch(() => {
      if (this.resolutions.get(key) === entry) this.resolutions.delete(key)
    })
    return promise
  }

  private onBatch(stream: Stream, raw: RawBatch): void {
    if (!stream.active) return
    for (const sub of [...stream.subscribers]) {
      this.send(sub, {
        type: 'batch',
        subscriptionId: sub.request.subscriptionId,
        batch: sub.normalize(raw),
        nextPageToken: stream.session.getResumeToken(),
      })
    }
  }

  unsubscribe(client: string, subscriptionId: string): void {
    const requests = this.clients.get(client)
    const sub = requests?.get(subscriptionId)
    if (!sub || !requests) return
    requests.delete(subscriptionId)
    this.subscriptions--
    if (!requests.size) this.clients.delete(client)
    if (sub.stream) {
      sub.stream.subscribers.delete(sub)
      if (!sub.stream.subscribers.size) this.removeStream(sub.stream)
    }
  }

  private removeStream(stream: Stream): void {
    if (!stream.active) return
    stream.active = false
    this.streams.delete(stream.chat.liveChatId)
    stream.session.stop()
    // Ended chats must be resolved again only after an explicit subscription request.
    for (const [key, entry] of this.resolutions) {
      if (entry.chat?.liveChatId === stream.chat.liveChatId) this.resolutions.delete(key)
    }
    for (const sub of [...stream.subscribers])
      this.unsubscribe(sub.client, sub.request.subscriptionId)
  }

  cleanupClient(client: string): void {
    for (const id of [...(this.clients.get(client)?.keys() ?? [])]) this.unsubscribe(client, id)
  }

  stop(): void {
    this.stopped = true
    for (const client of [...this.clients.keys()]) this.cleanupClient(client)
    this.resolutions.clear()
  }
}
