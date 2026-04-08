import { logger } from '@twirchat/shared/logger'

const log = logger('seventv:event')

const SEVENTV_EVENT_API_URL = 'wss://events.7tv.io/v3'

export interface SevenTVEventMessage {
  op: number
  t?: number
  d?: unknown
}

export interface SevenTVHello {
  heartbeat_interval: number
  session_id: string
  subscription_limit: number
}

export interface UserUpdateEventNestedField {
  key: string
  value: unknown
  old_value?: unknown
}

export interface UserUpdateEvent {
  id: string
  updated?: {
    key: string
    index?: number | null
    nested?: boolean
    type?: string
    // When nested === true, value is an array of UserUpdateEventNestedField.
    // Otherwise, value can be any scalar/object (string, null, object, etc.)
    value?: unknown
    old_value?: unknown
  }[]
}

export interface EmoteSetUpdateEvent {
  id: string
  actor?: {
    id: string
    display_name: string
  }
  pushed?: {
    key: string
    index: number
    type: 'emote'
    value: {
      id: string
      alias: string
      emote: {
        id: string
        defaultName: string
        flags: {
          animated: boolean
        }
        aspectRatio: number
        images: Array<{
          url: string
          mime: string
          size: number
          scale: number
          width: number
          height: number
          frameCount: number
        }>
      }
    }
  }[]
  pulled?: {
    key: string
    index: number
    type: 'emote'
    old_value: {
      id: string
      alias: string
      emote: {
        id: string
        defaultName: string
        flags: {
          animated: boolean
        }
        aspectRatio: number
        images: Array<{
          url: string
          mime: string
          size: number
          scale: number
          width: number
          height: number
          frameCount: number
        }>
      }
    }
  }[]
  updated?: {
    key: string
    index?: number
    type?: string
    old_value: unknown
    value: unknown
  }[]
}

export interface EmoteSetDeleteEvent {
  id: string
  actor?: {
    id: string
    display_name: string
  }
}

export type SevenTVEventHandler = (event: {
  type: string
  body: EmoteSetUpdateEvent | EmoteSetDeleteEvent | UserUpdateEvent
}) => void

export class SevenTVEventClient {
  private ws: WebSocket | null = null
  private heartbeatTimer: Timer | null = null
  private reconnectTimer: Timer | null = null
  private sessionId: string | null = null
  // Saved before cleanup so reconnect can attempt session resume (op 34)
  private previousSessionId: string | null = null
  // Set while waiting for server to ack a resume attempt; cleared on Ack/RESUME or Error
  private resumePending = false
  private subscriptionLimit = 0
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

  async connect(): Promise<void> {
    if (this.isConnecting || this.ws) {
      return
    }

    this.isConnecting = true
    log.info('Connecting to 7TV EventAPI...')

    try {
      this.ws = new WebSocket(SEVENTV_EVENT_API_URL)

      this.ws.onopen = () => {
        this.isConnecting = false
        log.info('WebSocket connected')
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string)
      }

      this.ws.onclose = (event) => {
        log.info('WebSocket closed', { code: event.code, reason: event.reason })
        this.cleanup()

        if (this.shouldReconnect) {
          this.scheduleReconnect(event.code)
        }
      }

      this.ws.onerror = (error) => {
        log.error('WebSocket error', { error: String(error) })
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
    this.resumePending = false

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // Cancel any pending reconnect so disconnect() is truly final
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore
      }
      this.ws = null
    }

    this.onDisconnected?.()
  }

  private handleMessage(data: string): void {
    try {
      const message: SevenTVEventMessage = JSON.parse(data)

      // Log ALL raw messages for debugging
      if (message.op === 0) {
        log.info('RAW DISPATCH MESSAGE', { raw: data })
      }

      if (message.op !== 2) {
        log.info('7TV EventAPI message received', {
          op: message.op,
          type: (message.d as any)?.type,
        })
      }

      switch (message.op) {
        case 1: {
          // Hello
          this.handleHello(message.d as SevenTVHello)
          break
        }
        case 0: {
          // Dispatch
          if (message.d) {
            const dispatch = message.d as {
              type: string
              body: EmoteSetUpdateEvent | UserUpdateEvent
            }
            log.info('DISPATCH EVENT RECEIVED', { type: dispatch.type, bodyId: dispatch.body?.id })
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
          // Reconnect — server wants us to reconnect (possibly resume)
          log.info('Server requested reconnect')
          this.reconnect()
          break
        }
        case 5: {
          // Ack — server acknowledged our last command
          const ack = message.d as { command: string; data?: unknown }
          log.info('Server ack', { command: ack.command })
          if (ack.command === 'RESUME') {
            log.info('Session resumed successfully — server will replay missed events')
            this.resumePending = false
          }
          break
        }
        case 6: {
          // Error
          log.error('Server error', { data: message.d })
          if (this.resumePending) {
            log.warn('Resume rejected by server, falling back to full resubscribe')
            this.resumePending = false
            for (const [, sub] of this.subscriptions) {
              this.sendSubscribe(sub.type, sub.condition)
            }
          }
          break
        }
        case 7: {
          // End of Stream
          const eos = message.d as { code: number; message: string }
          log.info('End of stream', { code: eos.code, message: eos.message })
          break
        }
        default: {
          log.debug('Unknown opcode', { op: message.op })
        }
      }
    } catch (error) {
      log.error('Failed to parse message', { data, error: String(error) })
    }
  }

  private handleHello(hello: SevenTVHello): void {
    log.info('Received hello', {
      heartbeatInterval: hello.heartbeat_interval,
      sessionId: hello.session_id,
      subscriptionLimit: hello.subscription_limit,
    })

    this.sessionId = hello.session_id
    this.subscriptionLimit = hello.subscription_limit
    this.heartbeatInterval = hello.heartbeat_interval
    this.lastHeartbeat = Date.now()

    // Start heartbeat watchdog
    this.startHeartbeat()

    // Attempt session resume if we have a previous session id;
    // otherwise resubscribe to all tracked subscriptions from scratch.
    if (this.previousSessionId) {
      this.sendResume(this.previousSessionId)
      this.previousSessionId = null
    } else {
      for (const [, sub] of this.subscriptions) {
        this.sendSubscribe(sub.type, sub.condition)
      }
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

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(type, condition)
    }
  }

  unsubscribe(type: string, condition?: Record<string, string>): void {
    const subId = condition ? `${type}:${JSON.stringify(condition)}` : `${type}:*`

    if (condition) {
      this.subscriptions.delete(subId)
    } else {
      // Unsubscribe all of this type
      for (const [id, sub] of this.subscriptions) {
        if (sub.type === type) {
          this.subscriptions.delete(id)
        }
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(type, condition)
    }
  }

  private sendSubscribe(type: string, condition: Record<string, string>): void {
    const payload = {
      d: { condition, type },
      op: 35,
    }
    log.info('Sending subscribe', { condition, payload: JSON.stringify(payload), type })
    this.send(payload)
  }

  private sendUnsubscribe(type: string, condition?: Record<string, string>): void {
    const payload: { op: number; d: { type: string; condition?: Record<string, string> } } = {
      d: { type },
      op: 36,
    }

    if (condition) {
      payload.d.condition = condition
    }

    this.send(payload)
  }

  private sendResume(sessionId: string): void {
    log.info('Attempting session resume', { sessionId })
    this.resumePending = true
    this.send({ op: 34, d: { session_id: sessionId } })
  }

  private send(message: SevenTVEventMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private reconnect(): void {
    // Save current session so handleHello can attempt resume
    this.previousSessionId = this.sessionId
    this.cleanup()
    this.connect()
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

    // Preserve session for resume attempt — scheduleReconnect is called after cleanup()
    // which has already nulled this.sessionId, so guard against double-save
    if (!this.previousSessionId) {
      this.previousSessionId = this.sessionId
    }

    // Add ±50% jitter to spread reconnect storms
    const delay =
      Math.min(this.baseReconnectDelay * 2 ** this.reconnectAttempts, this.maxReconnectDelay) *
      (0.5 + Math.random() * 0.5)

    this.reconnectAttempts++

    log.info('Scheduling reconnect', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
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
