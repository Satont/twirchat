import type { ChatClear, RoomState } from '@twirchat/shared/channel-tools'
import { logger } from '@twirchat/shared/logger'
import type {
  ChatSendReceipt,
  ModerationOutcome,
  NormalizedChatMessage,
  NormalizedEvent,
  Platform,
} from '@twirchat/shared/types'
import type { PlatformStatusInfo } from '@twirchat/shared/types'

const log = logger('base-adapter')

export interface PlatformEventMap {
  message: NormalizedChatMessage
  notice: NormalizedChatMessage
  event: NormalizedEvent
  status: PlatformStatusInfo
  moderation: ModerationOutcome
  room_state: RoomState
  chat_clear: ChatClear
}

export type PlatformEventHandler<K extends keyof PlatformEventMap> = (
  data: PlatformEventMap[K],
) => void

export interface IPlatformAdapter {
  readonly platform: Platform

  connect(channelSlug: string): Promise<void>
  disconnect(): Promise<void>
  sendMessage(
    channelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void | ChatSendReceipt>
  getBroadcasterUserId?(): number | null
  getRoomState?(): RoomState | undefined

  on<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void
  off<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void
}

/**
 * Базовый класс с EventEmitter-подобным механизмом
 */
export abstract class BasePlatformAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform

  private listeners: { [K in keyof PlatformEventMap]: Set<PlatformEventHandler<K>> } = {
    message: new Set(),
    notice: new Set(),
    event: new Set(),
    status: new Set(),
    moderation: new Set(),
    room_state: new Set(),
    chat_clear: new Set(),
  }
  on<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void {
    this.listeners[event].add(handler)
  }
  off<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void {
    this.listeners[event].delete(handler)
  }

  protected emit<K extends keyof PlatformEventMap>(event: K, data: PlatformEventMap[K]): void {
    const handlers = this.listeners[event]
    if (!handlers) {
      return
    }
    for (const handler of handlers) {
      try {
        handler(data)
      } catch (error) {
        log.error(`[${this.platform}] Event handler error (${event})`, { error: String(error) })
      }
    }
  }

  abstract connect(channelSlug: string): Promise<void>
  abstract disconnect(): Promise<void>
  abstract sendMessage(
    channelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void | ChatSendReceipt>
}
