import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import type { KickRetryClock } from './retry'

const log = logger('kick-realtime')

export interface KickSocketEvents {
  open: unknown
  message: { data: unknown }
  close: { code: number }
  error: unknown
}

export interface KickSocket {
  addEventListener<K extends keyof KickSocketEvents>(
    event: K,
    listener: (event: KickSocketEvents[K]) => void,
  ): void
  send(data: string): void
  close(): void
}

export interface KickRealtimeEvent {
  event: string
  data: unknown
}

export interface KickRealtimeDependencies {
  discover(clientId: string, signal: AbortSignal): Promise<string>
  token(clientId: string, signal: AbortSignal): Promise<string>
  socket(url: string): KickSocket
  clock: KickRetryClock
}

export class KickConnectionError extends Error {}

const realtimeUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'wss:' && url.hostname.endsWith('.platform.kick.com')
})
const discoverySchema = z.object({
  data: z.object({
    mode: z.literal('websocket'),
    connections: z.array(
      z.object({
        provider: z.string(),
        credentials: z.object({ url: realtimeUrlSchema }).optional(),
      }),
    ),
  }),
})
const tokenSchema = z.object({ data: z.object({ token: z.string().min(1) }) })

async function realtimeRequest(
  path: string,
  body: object,
  signal: AbortSignal,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const response = await fetchFn(`https://web.kick.com/api/v1/realtime${path}`, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://kick.com',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok)
    throw new KickConnectionError(`Kick realtime request failed (HTTP ${response.status}).`)
  return response.json()
}

export async function discoverKickRealtime(
  clientId: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = discoverySchema.parse(
    await realtimeRequest(
      '/connection',
      {
        client: { id: clientId, type: 'web' },
        capabilities: { accepted_providers: [{ provider: 'centrifugo' }] },
      },
      signal,
      fetchFn,
    ),
  )
  const connection = response.data.connections.find((item) => item.provider === 'centrifugo')
  if (!connection?.credentials)
    throw new KickConnectionError('Kick did not offer a supported realtime connection.')
  return connection.credentials.url
}

export async function requestKickRealtimeToken(
  clientId: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return tokenSchema.parse(
    await realtimeRequest('/auth/connection', { client_id: clientId }, signal, fetchFn),
  ).data.token
}

const errorSchema = z.object({ code: z.number(), message: z.string().optional() })
const lifetimeSchema = z.object({
  expires: z.boolean().optional(),
  ttl: z.number().int().positive().max(86400).optional(),
})
const replySchema = z.object({
  id: z.number().int().optional(),
  error: errorSchema.optional(),
  connect: lifetimeSchema
    .extend({ ping: z.number().int().nonnegative().max(3600).optional() })
    .optional(),
  subscribe: z.object({}).optional(),
  refresh: lifetimeSchema.optional(),
  push: z
    .object({
      channel: z.string().optional(),
      pub: z.object({ data: z.unknown() }).optional(),
      disconnect: errorSchema.optional(),
      unsubscribe: errorSchema.optional(),
    })
    .optional(),
})
const publicationSchema = z.object({ event: z.string(), data: z.unknown() })

export class KickRealtimeSession {
  readonly ready: Promise<void>
  private readonly completion = Promise.withResolvers<void>()
  private readonly controller = new AbortController()
  private socket?: KickSocket
  private closed = false
  private subscribed = false
  private cancelRefresh?: () => void
  private cancelRefreshDeadline?: () => void
  private cancelHeartbeat?: () => void
  private heartbeatMs = 0
  private nextId = 2
  private refreshId?: number

  constructor(
    private readonly options: {
      chatroomId: number
      signal: AbortSignal
      dependencies: KickRealtimeDependencies
      event(event: KickRealtimeEvent): void
      disconnected(error: KickConnectionError): void
    },
  ) {
    this.ready = this.completion.promise
    options.signal.addEventListener('abort', this.aborted, { once: true })
    if (options.signal.aborted) this.aborted()
    else this.open().catch((error: unknown) => this.fail(this.connectionError(error)))
  }

  close(): void {
    if (this.closed) return
    this.stop()
    if (!this.subscribed)
      this.completion.reject(new KickConnectionError('Kick connection cancelled.'))
  }

  private readonly aborted = () => {
    this.fail(this.connectionError(this.options.signal.reason))
  }

  private connectionError(error: unknown): KickConnectionError {
    return error instanceof KickConnectionError
      ? error
      : new KickConnectionError('Kick realtime connection failed. Check the network connection.')
  }

  private stop(): void {
    this.closed = true
    this.options.signal.removeEventListener('abort', this.aborted)
    this.controller.abort()
    this.cancelRefresh?.()
    this.cancelRefreshDeadline?.()
    this.cancelHeartbeat?.()
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  private fail(error: KickConnectionError): void {
    if (this.closed) return
    this.stop()
    if (this.subscribed) this.options.disconnected(error)
    else this.completion.reject(error)
  }

  private async open(): Promise<void> {
    const { dependencies } = this.options
    const clientId = crypto.randomUUID()
    const signal = AbortSignal.any([this.controller.signal, this.options.signal])
    const [url, token] = await Promise.all([
      dependencies.discover(clientId, signal),
      dependencies.token(clientId, signal),
    ])
    if (this.closed) return
    const socket = dependencies.socket(url)
    this.socket = socket
    socket.addEventListener('open', () => this.send({ id: 1, connect: { token, name: 'js' } }))
    socket.addEventListener('message', (event) => this.receive(event.data))
    socket.addEventListener('close', (event) =>
      this.fail(new KickConnectionError(`Kick chat disconnected (code ${event.code}).`)),
    )
    socket.addEventListener('error', () =>
      this.fail(new KickConnectionError('Kick chat WebSocket connection failed.')),
    )
    this.clientId = clientId
  }

  private clientId = ''

  private send(value: object): void {
    if (this.closed) return
    try {
      this.socket?.send(JSON.stringify(value))
    } catch {
      this.fail(new KickConnectionError('Kick chat WebSocket send failed.'))
    }
  }

  private receive(value: unknown): void {
    if (this.closed) return
    try {
      const lines = z.string().parse(value).split('\n')
      for (const line of lines) {
        if (this.closed) return
        if (!line.trim()) continue
        const raw: unknown = JSON.parse(line)
        const reply = replySchema.parse(raw)
        this.watchHeartbeat()
        if (reply.error) {
          this.fail(
            new KickConnectionError(`Kick realtime command rejected (code ${reply.error.code}).`),
          )
          return
        }
        if (reply.id === 1 && reply.connect && !this.subscribed) {
          this.heartbeatMs = (reply.connect.ping ?? 0) * 1000
          this.watchHeartbeat()
          this.scheduleRefresh(reply.connect)
          this.send({ id: 2, subscribe: { channel: this.channel } })
        } else if (reply.id === 2 && reply.subscribe && !this.subscribed) {
          this.subscribed = true
          this.completion.resolve()
        } else if (reply.id === this.refreshId && reply.refresh) {
          this.cancelRefreshDeadline?.()
          this.cancelRefreshDeadline = undefined
          this.refreshId = undefined
          this.scheduleRefresh(reply.refresh)
        } else if (reply.push?.disconnect || reply.push?.unsubscribe) {
          const error = reply.push.disconnect ?? reply.push.unsubscribe
          this.fail(
            new KickConnectionError(`Kick realtime subscription ended (code ${error?.code}).`),
          )
          return
        } else if (reply.push?.pub && reply.push.channel === this.channel && this.subscribed) {
          const publication = reply.push.pub.data
          let payload: unknown = publication
          if (typeof publication === 'string') {
            try {
              payload = JSON.parse(publication)
            } catch {
              payload = null
            }
          }
          const event = publicationSchema.safeParse(payload)
          if (event.success) this.options.event(event.data)
          else log.warn('Invalid Kick realtime publication', { channel: this.channel })
        } else if (z.object({}).strict().safeParse(raw).success) {
          this.send({})
        }
      }
    } catch {
      this.fail(new KickConnectionError('Kick realtime sent an invalid protocol message.'))
    }
  }

  private get channel(): string {
    return `chatrooms.${this.options.chatroomId}.v2`
  }

  private watchHeartbeat(): void {
    if (!this.heartbeatMs || this.closed) return
    this.cancelHeartbeat?.()
    this.cancelHeartbeat = this.options.dependencies.clock.schedule(
      () => this.fail(new KickConnectionError('Kick realtime heartbeat timed out.')),
      this.heartbeatMs + 10000,
    )
  }

  private scheduleRefresh(lifetime: z.infer<typeof lifetimeSchema>): void {
    this.cancelRefresh?.()
    this.cancelRefresh = undefined
    if (this.closed || !lifetime.expires) return
    if (!lifetime.ttl) {
      this.fail(new KickConnectionError('Kick realtime omitted its token expiry.'))
      return
    }
    this.cancelRefresh = this.options.dependencies.clock.schedule(() => {
      this.cancelRefresh = undefined
      this.refresh().catch((error: unknown) => this.fail(this.connectionError(error)))
    }, lifetime.ttl * 800)
  }

  private async refresh(): Promise<void> {
    if (this.closed) return
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)])
    const token = await this.options.dependencies.token(this.clientId, signal)
    if (this.closed) return
    const id = ++this.nextId
    this.refreshId = id
    this.cancelRefreshDeadline = this.options.dependencies.clock.schedule(
      () => this.fail(new KickConnectionError('Kick realtime token refresh timed out.')),
      15000,
    )
    this.send({ id, refresh: { token } })
  }
}
