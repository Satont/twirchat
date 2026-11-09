import { z } from 'zod'

export type CentrifugoProtocol = 'legacy' | 'modern'

interface Subscription {
  channel: string
  token?: string
}

interface CentrifugoConnection {
  protocol: CentrifugoProtocol
  socket: WebSocket
  signal: AbortSignal
  token: string
  subscribe: (client: string, signal: AbortSignal) => Promise<Subscription>
  onConnected: () => void
  onPublication: (payload: unknown) => void
}

const HANDSHAKE_TIMEOUT_MS = 20_000
const LEGACY_PING_INTERVAL_MS = 25_000
const PING_GRACE_MS = 10_000

const lifetime = z.object({
  expires: z.boolean().optional(),
  ttl: z.number().int().nonnegative().optional(),
})
const connectResult = lifetime.extend({
  client: z.string().min(1),
  ping: z.number().int().nonnegative().max(3600).optional(),
  pong: z.boolean().optional(),
})
const legacyPush = z.object({
  channel: z.string(),
  type: z.number().optional(),
  data: z.unknown().optional(),
})
const publication = z.object({ data: z.unknown() })
const emptyReply = z.object({}).strict()
const reply = z.object({
  id: z.number().int().nonnegative().optional(),
  error: z.object({ code: z.number().int() }).optional(),
  result: z.unknown().optional(),
  connect: z.unknown().optional(),
  subscribe: z.unknown().optional(),
  push: z
    .object({
      channel: z.string().optional(),
      pub: publication.optional(),
      disconnect: z.object({}).optional(),
      unsubscribe: z.object({}).optional(),
    })
    .optional(),
})

export async function runCentrifugo({
  protocol,
  socket,
  signal,
  token,
  subscribe,
  onConnected,
  onPublication,
}: CentrifugoConnection): Promise<void> {
  const legacy = protocol === 'legacy'
  const completion = Promise.withResolvers<void>()
  const pendingSubscription = new AbortController()
  let phase: 'connecting' | 'authorizing' | 'subscribing' | 'subscribed' = 'connecting'
  let channel: string | undefined
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  let expiresAt = Infinity
  let pingMs = 0
  let needsPong = false
  let pingId = 2
  let ended = false

  function finish(error?: unknown): void {
    if (ended) return
    ended = true
    if (error) completion.reject(error)
    else completion.resolve()
  }

  function send(command: object): void {
    if (ended) return
    try {
      socket.send(JSON.stringify(command))
    } catch {
      finish(new Error('Donation WebSocket send failed.'))
    }
  }

  function scheduleExpiry(value: z.infer<typeof lifetime>): void {
    if (!value.expires || !value.ttl) return
    const deadline = performance.now() + value.ttl * 1000
    if (expiresAt <= deadline) return
    expiresAt = deadline
    clearTimeout(expiry)
    expiry = setTimeout(
      () => finish(new Error('Donation WebSocket session expired.')),
      Math.min(value.ttl * 1000, 2_147_483_647),
    )
  }

  function expectHeartbeat(ms: number): void {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(() => finish(new Error('Donation WebSocket heartbeat timed out.')), ms)
  }

  function scheduleLegacyPing(): void {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(() => {
      send({ id: ++pingId, method: 7 })
      expectHeartbeat(PING_GRACE_MS)
    }, LEGACY_PING_INTERVAL_MS)
  }

  function open(): void {
    send(legacy ? { id: 1, params: { token } } : { id: 1, connect: { token } })
  }

  function close(): void {
    finish(new Error('Donation WebSocket disconnected.'))
  }

  function fail(): void {
    finish(new Error('Donation WebSocket connection failed.'))
  }

  function cancel(): void {
    finish()
  }

  async function startSubscription(client: string): Promise<void> {
    const params = await subscribe(client, pendingSubscription.signal)
    if (ended || signal.aborted) return
    channel = params.channel
    phase = 'subscribing'
    send(legacy ? { id: 2, method: 1, params } : { id: 2, subscribe: params })
  }

  function receive(raw: unknown): void {
    const value = reply.parse(raw)
    if (!legacy && pingMs) expectHeartbeat(pingMs + PING_GRACE_MS)
    if (value.error) {
      finish(new Error(`Donation WebSocket command rejected (code ${value.error.code}).`))
      return
    }
    if (phase === 'connecting' && value.id === 1) {
      const connected = connectResult.parse(legacy ? value.result : value.connect)
      phase = 'authorizing'
      pingMs = (connected.ping ?? 0) * 1000
      needsPong = connected.pong ?? false
      if (!legacy && pingMs) expectHeartbeat(pingMs + PING_GRACE_MS)
      scheduleExpiry(connected)
      startSubscription(connected.client).catch(finish)
      return
    }
    if (phase === 'subscribing' && value.id === 2) {
      scheduleExpiry(lifetime.parse(legacy ? value.result : value.subscribe))
      clearTimeout(handshake)
      phase = 'subscribed'
      if (legacy) scheduleLegacyPing()
      onConnected()
      return
    }
    if (!legacy && needsPong && emptyReply.safeParse(raw).success) {
      send({})
      return
    }
    if (phase !== 'subscribed') return
    if (legacy) {
      if (pingId > 2 && value.id === pingId) scheduleLegacyPing()
      if (value.id) return
      const push = legacyPush.safeParse(value.result)
      if (!push.success || push.data.channel !== channel) return
      if (push.data.type === 3) {
        finish(new Error('Donation WebSocket subscription ended.'))
      } else if (push.data.type === undefined || push.data.type === 0) {
        const published = publication.safeParse(push.data.data)
        if (published.success) onPublication(published.data.data)
      }
    } else {
      const push = value.push
      if (push?.disconnect || (push?.channel === channel && push?.unsubscribe))
        finish(new Error('Donation WebSocket subscription ended.'))
      else if (push?.channel === channel && push?.pub) onPublication(push.pub.data)
    }
  }

  function message(event: MessageEvent): void {
    try {
      const lines = z.string().max(1_048_576).parse(event.data).split('\n')
      for (const line of lines) {
        if (ended) break
        if (line.trim()) receive(JSON.parse(line))
      }
    } catch {
      finish(new Error('Donation WebSocket returned an invalid message.'))
    }
  }

  const handshake = setTimeout(
    () => finish(new Error('Donation WebSocket handshake timed out.')),
    HANDSHAKE_TIMEOUT_MS,
  )
  socket.addEventListener('open', open)
  socket.addEventListener('close', close)
  socket.addEventListener('error', fail)
  socket.addEventListener('message', message)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()

  try {
    await completion.promise
  } finally {
    pendingSubscription.abort()
    clearTimeout(handshake)
    clearTimeout(heartbeat)
    clearTimeout(expiry)
    signal.removeEventListener('abort', cancel)
    socket.removeEventListener('open', open)
    socket.removeEventListener('close', close)
    socket.removeEventListener('error', fail)
    socket.removeEventListener('message', message)
    socket.close()
  }
}
