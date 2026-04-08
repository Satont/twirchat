import type { BackendToDesktopMessage, DesktopToBackendMessage } from '@twirchat/shared'
import { getBackendWsUrl } from './runtime-config'
import { logger } from '@twirchat/shared/logger'
import { sevenTVService } from './seventv'

const log = logger('backend-connection')

type MessageHandler = (msg: BackendToDesktopMessage) => void
type SevenTVBackendMessage = Extract<BackendToDesktopMessage, { channelId: string }>
type SystemMessageHandler = (
  msg: Extract<BackendToDesktopMessage, { type: 'seventv_system_message' }>,
) => void

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 30_000

/**
 * Manages the persistent WebSocket connection from desktop to backend.
 * Automatically reconnects with exponential backoff on disconnect.
 */
export class BackendConnection {
  private ws: WebSocket | null = null
  private handlers: MessageHandler[] = []
  private systemMessageHandlers: SystemMessageHandler[] = []
  private reconnectDelay = RECONNECT_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(private readonly clientSecret: string) {}

  connect(): void {
    this.stopped = false
    this._connect()
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  send(msg: DesktopToBackendMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      log.warn('Cannot send — not connected')
    }
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
    log.info(`Connecting to ${backendWsUrl}...`)

    const ws = new WebSocket(backendWsUrl, {
      headers: {
        'X-Client-Secret': this.clientSecret,
      },
      // Bun WebSocket constructor accepts { headers } but TS types expect string[] — cast required
    } as unknown as string[])
    ws.addEventListener('open', () => {
      log.info('Connected')
      this.reconnectDelay = RECONNECT_DELAY_MS

      const channels = sevenTVService.getSubscribedChannels()
      if (channels.length > 0) {
        log.info(`Resubscribing to ${channels.length} 7TV channels`)
        for (const { platform, channelId } of channels) {
          sevenTVService.subscribeToChannel(platform, channelId).catch((error) => {
            log.error('Failed to resubscribe to 7TV', {
              platform,
              channelId,
              error: String(error),
            })
          })
        }
      }
    })

    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as BackendToDesktopMessage

        if (msg.type.startsWith('seventv')) {
          const sevenTVMessage = msg as SevenTVBackendMessage
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
    })

    ws.addEventListener('close', () => {
      this.ws = null
      if (!this.stopped) {
        log.info(`Disconnected. Reconnecting in ${this.reconnectDelay}ms...`)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
          this._connect()
        }, this.reconnectDelay)
      }
    })

    ws.addEventListener('error', (evt) => {
      log.error('WebSocket error', { event: JSON.stringify(evt) })
    })

    this.ws = ws
  }
}
