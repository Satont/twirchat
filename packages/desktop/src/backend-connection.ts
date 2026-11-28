declare const WebSocket: typeof globalThis.WebSocket & {
  new (url: string | URL, options: Bun.WebSocketOptions): WebSocket
}
import type { BackendToDesktopMessage, DesktopToBackendMessage } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'

import { getBackendWsUrl } from './runtime-config'
import { backendToDesktopMessageSchema } from './services/persisted-schemas'
import { sevenTVService } from './seventv'

const log = logger('backend-connection')

type MessageHandler = (msg: BackendToDesktopMessage) => void

type SystemMessageHandler = (
  msg: Extract<BackendToDesktopMessage, { type: 'seventv_system_message' }>,
) => void

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Manages the persistent WebSocket connection from desktop to backend.
 * Automatically reconnects with exponential backoff on disconnect.
 */
export class BackendConnection {
  private ws: WebSocket | null = null
  private handlers: MessageHandler[] = []
  private connectionHandlers = new Set<(connected: boolean) => void>()
  private systemMessageHandlers: SystemMessageHandler[] = []
  private reconnectDelay = RECONNECT_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private socketListeners: AbortController | null = null
  private stopped = true

  constructor(private readonly clientSecret: string) {}

  connect(): void {
    if (!this.stopped) return
    this._connect()
    this.stopped = false
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, HEARTBEAT_INTERVAL_MS)
  }

  disconnect(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    this.ws = null
    // Detach EventTarget callbacks before closing the socket (avoids Bun teardown races).
    this.socketListeners?.abort()
    this.socketListeners = null
    ws?.close()
    this.notifyConnectionStatus(false)
  }

  send(msg: DesktopToBackendMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      log.warn('Cannot send — not connected')
    }
  }

  onConnectionStatus(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler)
    return () => {
      this.connectionHandlers.delete(handler)
    }
  }

  private notifyConnectionStatus(connected: boolean): void {
    for (const handler of this.connectionHandlers) handler(connected)
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  onSystemMessage(handler: SystemMessageHandler): () => void {
    this.systemMessageHandlers.push(handler)
    return () => {
      this.systemMessageHandlers = this.systemMessageHandlers.filter((h) => h !== handler)
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private _connect(): void {
    const backendWsUrl = getBackendWsUrl()
    log.info('Connecting to backend')

    const ws = new WebSocket(backendWsUrl, {
      headers: {
        'X-Client-Secret': this.clientSecret,
      },
    })
    const listeners = new AbortController()
    const options = { signal: listeners.signal }
    this.socketListeners = listeners
    const handleOpen = () => {
      if (this.ws !== ws || this.stopped) return
      this.notifyConnectionStatus(true)
      log.info('Connected')
      this.reconnectDelay = RECONNECT_DELAY_MS

      const channels = sevenTVService.getSubscribedChannels()
      if (channels.length > 0) {
        log.info(`Resubscribing to ${channels.length} 7TV channels`)
        sevenTVService.resubscribeToChannels(channels).catch((error) => {
          log.error('Failed to resubscribe to 7TV', { error: String(error) })
        })
      }
    }

    const handleMessage = (evt: WebSocketEventMap['message']) => {
      if (this.ws !== ws || this.stopped) return
      try {
        if (typeof evt.data !== 'string') return
        const msg = backendToDesktopMessageSchema.parse(JSON.parse(evt.data))

        if ('channelId' in msg) {
          const sevenTVMessage = msg
          log.info('Received WebSocket message', {
            channelId: sevenTVMessage.channelId,
            platform: sevenTVMessage.platform,
            type: msg.type,
          })
        }

        switch (msg.type) {
          case 'seventv_emote_set': {
            sevenTVService.handleEmoteSet(msg.platform, msg.channelId, msg.emotes)
            break
          }
          case 'seventv_emote_added': {
            sevenTVService.handleEmoteAdded(msg.platform, msg.channelId, msg.emote)
            break
          }
          case 'seventv_emote_removed': {
            sevenTVService.handleEmoteRemoved(msg.platform, msg.channelId, msg.emoteId)
            break
          }
          case 'seventv_emote_updated': {
            sevenTVService.handleEmoteUpdated(msg.platform, msg.channelId, msg.emoteId, msg.alias)
            break
          }
          case 'seventv_system_message': {
            log.info('7TV system message received - HANDLING', {
              platform: msg.platform,
              channelId: msg.channelId,
              action: msg.action,
              emoteAlias:
                msg.action === 'added' || msg.action === 'removed' || msg.action === 'updated'
                  ? msg.emote.alias
                  : undefined,
              handlerCount: this.systemMessageHandlers.length,
            })
            for (const handler of this.systemMessageHandlers) {
              try {
                handler(msg)
              } catch (err) {
                log.error('Error in system message handler', { error: String(err) })
              }
            }
            break
          }
        }

        for (const handler of this.handlers) {
          handler(msg)
        }
      } catch (error) {
        log.error('Failed to parse message', { error: String(error) })
      }
    }

    const handleClose = () => {
      if (this.ws !== ws) return
      listeners.abort()
      this.socketListeners = null
      this.ws = null
      if (!this.stopped) {
        log.info(`Disconnected. Reconnecting in ${this.reconnectDelay}ms...`)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          if (this.stopped) return
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
          this._connect()
        }, this.reconnectDelay)
      }
      this.notifyConnectionStatus(false)
    }

    const handleError = (evt: WebSocketEventMap['error']) => {
      log.error('WebSocket error', { event: JSON.stringify(evt) })
    }

    ws.addEventListener('open', handleOpen, options)
    ws.addEventListener('message', handleMessage, options)
    ws.addEventListener('close', handleClose, options)
    ws.addEventListener('error', handleError, options)
    this.ws = ws
  }
}
