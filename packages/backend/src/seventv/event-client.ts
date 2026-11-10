import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import * as schemas from './event-schemas'
import { sevenTVEventMessageSchema, sevenTVHelloSchema, sevenTVEventSchema } from './event-schemas'

const log = logger('seventv:event')

const SEVENTV_EVENT_API_URL = 'wss://events.7tv.io/v3'

export type SevenTVEventMessage = z.infer<typeof schemas.sevenTVEventMessageSchema>
export type SevenTVHello = z.infer<typeof schemas.sevenTVHelloSchema>
export type UserUpdateEventNestedField = z.infer<typeof schemas.userUpdateNestedFieldSchema>
export type UserUpdateEvent = z.infer<typeof schemas.userUpdateSchema>
export type SevenTVEventImageFile = z.infer<typeof schemas.eventImageFileSchema>
export type SevenTVEventEmoteData = z.infer<typeof schemas.sevenTVEventEmoteValueSchema.shape.data>
export type SevenTVEventEmoteValue = z.infer<typeof schemas.sevenTVEventEmoteValueSchema>
export type SevenTVEventEmoteInsert = z.infer<typeof schemas.emoteInsertSchema>
export type SevenTVEventEmoteRemove = z.infer<typeof schemas.emoteRemoveSchema>
export type SevenTVEventEmoteUpdate = z.infer<typeof schemas.emoteUpdateSchema>
export type SevenTVEventFieldUpdate = z.infer<typeof schemas.fieldUpdateSchema>
export type SevenTVEvent = z.infer<typeof schemas.sevenTVEventSchema>
export type EmoteSetUpdateEvent = z.infer<typeof schemas.emoteSetUpdateSchema>
export type EmoteSetDeleteEvent = z.infer<typeof schemas.emoteSetDeleteSchema>

export type SevenTVEventHandler = (event: SevenTVEvent) => void

export class SevenTVEventClient {
  private ws: WebSocket | null = null
  private heartbeatTimer: Timer | null = null
  private reconnectTimer: Timer | null = null
  private receivedHello = false
  private heartbeatInterval = 0
  private lastHeartbeat = 0
  private isConnecting = false
  private shouldReconnect = true
  private reconnectAttempts = 0
  private readonly maxReconnectDelay = 30_000
  private readonly baseReconnectDelay = 1000

  private subscriptions = new Map<string, { type: string; condition: Record<string, string> }>()

  onEvent: SevenTVEventHandler | null = null
  onConnected: (() => void) | null = null
  onDisconnected: (() => void) | null = null

  constructor(private readonly url = SEVENTV_EVENT_API_URL) {}

  async connect(): Promise<void> {
    if (this.isConnecting || this.ws) {
      return
    }

    this.isConnecting = true
    log.info('Connecting to 7TV EventAPI...')

    try {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        if (this.ws !== ws) return
        this.isConnecting = false
        log.info('WebSocket connected')
      }

      ws.onmessage = (event) => {
        if (this.ws === ws && typeof event.data === 'string') this.handleMessage(event.data)
      }

      ws.onclose = (event) => {
        if (this.ws !== ws) return
        log.info('WebSocket closed', { code: event.code, reason: event.reason })
        this.cleanup()

        if (this.shouldReconnect) {
          this.scheduleReconnect(event.code)
        }
      }

      ws.onerror = (error) => {
        if (this.ws !== ws) return
        log.error('WebSocket error', { error: error.type })
      }
    } catch (error) {
      log.error('Failed to connect', { error: String(error) })
      this.isConnecting = false
      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    log.info('Disconnecting from 7TV EventAPI...')
    this.shouldReconnect = false
    this.cleanup()
  }

  private cleanup(): void {
    this.isConnecting = false
    this.receivedHello = false

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // Cancel any pending reconnect so disconnect() is truly final
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        // Ignore
      }
    }

    this.onDisconnected?.()
  }

  private handleMessage(data: string): void {
    try {
      const message = sevenTVEventMessageSchema.parse(JSON.parse(data))

      if (message.op !== 2) {
        const dispatchType =
          typeof message.d === 'object' && message.d !== null && 'type' in message.d
            ? String(message.d.type)
            : undefined

        log.info('7TV EventAPI message received', {
          op: message.op,
          type: dispatchType,
        })
      }

      switch (message.op) {
        case 1: {
          // Hello
          this.handleHello(sevenTVHelloSchema.parse(message.d))
          break
        }
        case 0: {
          // Dispatch
          if (message.d) {
            const dispatch = sevenTVEventSchema.parse(message.d)
            log.debug('Dispatch event received', { type: dispatch.type, bodyId: dispatch.body.id })
            this.onEvent?.(dispatch)
          }
          break
        }
        case 2: {
          // Heartbeat — server-sent keep-alive; reset our watchdog timer
          this.lastHeartbeat = Date.now()
          break
        }
        case 4: {
          // Reconnect
          log.info('Server requested reconnect')
          this.reconnect()
          break
        }
        case 5: {
          // Ack — server acknowledged our last command
          const ack = z
            .object({ command: z.string(), data: z.unknown().optional() })
            .parse(message.d)
          log.info('Server ack', { command: ack.command })
          break
        }
        case 6: {
          // Error
          log.error('Server error', { data: message.d })
          break
        }
        case 7: {
          // End of Stream
          const eos = z.object({ code: z.number(), message: z.string() }).parse(message.d)
          log.info('End of stream', { code: eos.code, message: eos.message })
          break
        }
        default: {
          log.debug('Unknown opcode', { op: message.op })
        }
      }
    } catch (error) {
      log.error('Failed to parse message', { payloadLength: data.length, error: String(error) })
    }
  }

  private handleHello(hello: SevenTVHello): void {
    log.info('Received hello', {
      heartbeatInterval: hello.heartbeat_interval,
      sessionId: hello.session_id,
      subscriptionLimit: hello.subscription_limit,
    })

    this.receivedHello = true
    this.heartbeatInterval = hello.heartbeat_interval
    this.lastHeartbeat = Date.now()

    // Start heartbeat watchdog
    this.startHeartbeat()

    // 7TV v3 acknowledges RESUME but does not restore subscriptions.
    for (const { type, condition } of this.subscriptions.values()) {
      this.sendSubscribe(type, condition)
    }

    this.reconnectAttempts = 0
    this.onConnected?.()
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    // Check heartbeat every interval / 2
    const checkInterval = this.heartbeatInterval / 2

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - this.lastHeartbeat

      // If no heartbeat for 3 intervals, consider connection dead
      if (elapsed > this.heartbeatInterval * 3) {
        log.warn('Heartbeat timeout, reconnecting...')
        this.reconnect()
      }
    }, checkInterval)
  }

  subscribe(type: string, condition: Record<string, string>): void {
    const subId = `${type}:${JSON.stringify(condition)}`

    if (this.subscriptions.has(subId)) {
      return // Already subscribed
    }

    this.subscriptions.set(subId, { condition, type })

    if (this.receivedHello && this.isConnected) {
      this.sendSubscribe(type, condition)
    }
  }

  unsubscribe(type: string, condition: Record<string, string>): void {
    const subId = `${type}:${JSON.stringify(condition)}`
    if (!this.subscriptions.delete(subId)) return
    this.send({ op: 36, d: { condition, type } })
  }

  private sendSubscribe(type: string, condition: Record<string, string>): void {
    const payload = {
      d: { condition, type },
      op: 35,
    }
    log.info('Sending subscribe', { condition, payload: JSON.stringify(payload), type })
    this.send(payload)
  }

  private send(message: SevenTVEventMessage): void {
    if (this.receivedHello && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private reconnect(): void {
    this.cleanup()
    this.connect().catch((error: unknown) =>
      log.error('Connection failed', { error: String(error) }),
    )
  }

  private scheduleReconnect(closeCode?: number): void {
    // Clear any existing timer to avoid duplicate reconnects (e.g. onerror + onclose both firing)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (!this.shouldReconnect) {
      return
    }

    // Don't reconnect on certain close codes
    if (closeCode === 4001 || closeCode === 4002 || closeCode === 4003 || closeCode === 4004) {
      log.error('Fatal close code, not reconnecting', { code: closeCode })
      return
    }

    // Add ±50% jitter to spread reconnect storms
    const delay =
      Math.min(this.baseReconnectDelay * 2 ** this.reconnectAttempts, this.maxReconnectDelay) *
      (0.5 + Math.random() * 0.5)

    this.reconnectAttempts++

    log.info('Scheduling reconnect', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch((error: unknown) =>
        log.error('Connection failed', { error: String(error) }),
      )
    }, delay)
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }
}

export const sevenTVEventClient = new SevenTVEventClient()
