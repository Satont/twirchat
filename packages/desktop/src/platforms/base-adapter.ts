import type { NormalizedChatMessage, NormalizedEvent, Platform } from '@twirchat/shared/types'
import type { PlatformStatusInfo } from '@twirchat/shared/types'
import { logger } from '@twirchat/shared/logger'

const log = logger('base-adapter')

export interface PlatformEventMap {
  message: NormalizedChatMessage
  event: NormalizedEvent
  status: PlatformStatusInfo
}

export type PlatformEventHandler<K extends keyof PlatformEventMap> = (
  data: PlatformEventMap[K],
) => void

export interface IPlatformAdapter {
  readonly platform: Platform

  connect(channelSlug: string): Promise<void>
  disconnect(): Promise<void>
  sendMessage(channelId: string, text: string, replyToMessageId?: string): Promise<void>

  on<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void
  off<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void
}

/**
 * Базовый класс с EventEmitter-подобным механизмом
 */
export abstract class BasePlatformAdapter implements IPlatformAdapter {
  abstract readonly platform: Platform

  private listeners = new Map<string, Set<PlatformEventHandler<keyof PlatformEventMap>>>()

  on<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as PlatformEventHandler<keyof PlatformEventMap>)
  }

  off<K extends keyof PlatformEventMap>(event: K, handler: PlatformEventHandler<K>): void {
    this.listeners.get(event)?.delete(handler as PlatformEventHandler<keyof PlatformEventMap>)
  }

  protected emit<K extends keyof PlatformEventMap>(event: K, data: PlatformEventMap[K]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) {
      return
    }
    for (const handler of handlers) {
      try {
        ;(handler as PlatformEventHandler<K>)(data)
      } catch (error) {
        log.error(`[${this.platform}] Event handler error (${event})`, { error: String(error) })
      }
    }
  }

  abstract connect(channelSlug: string): Promise<void>
  abstract disconnect(): Promise<void>
  abstract sendMessage(channelId: string, text: string, replyToMessageId?: string): Promise<void>
}
