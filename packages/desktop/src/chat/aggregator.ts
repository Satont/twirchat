import type {
  Emote,
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
} from '@twirchat/shared/types'
import type { IPlatformAdapter } from '../platforms/base-adapter'
import type { Platform } from '@twirchat/shared/types'
import { parseMessageWithEmotes } from '../platforms/7tv/emote-parser'

type AggregatorEventHandler<T> = (data: T) => void

export class ChatAggregator {
  private adapters = new Map<Platform, IPlatformAdapter>()
  private messageBuffer: NormalizedChatMessage[] = []
  private readonly bufferSize: number

  private onMessageHandlers = new Set<AggregatorEventHandler<NormalizedChatMessage>>()
  private onEventHandlers = new Set<AggregatorEventHandler<NormalizedEvent>>()
  private onStatusHandlers = new Set<AggregatorEventHandler<PlatformStatusInfo>>()

  private seenIds = new Set<string>()

  constructor(bufferSize = 500) {
    this.bufferSize = bufferSize
  }

  registerAdapter(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)

    adapter.on('message', (msg) => {
      if (this.seenIds.has(msg.id)) {
        return
      }
      this.seenIds.add(msg.id)

      // Parse 7TV emotes and merge with platform emotes
      const parsed = parseMessageWithEmotes(msg.text, msg.platform, msg.channelId)
      const sevenTVEmotes: Emote[] = parsed.emotes.map((e) => ({
        aspectRatio: e.aspectRatio,
        id: e.id,
        imageUrl: e.imageUrl,
        name: e.name,
        positions: [{ start: e.start, end: e.end }],
      }))

      const sevenTVEmoteMap = new Map<string, Emote>()
      for (const emote of sevenTVEmotes) {
        const existing = sevenTVEmoteMap.get(emote.id)
        if (existing) {
          existing.positions.push(...emote.positions)
        } else {
          sevenTVEmoteMap.set(emote.id, { ...emote, positions: [...emote.positions] })
        }
      }

      const existingIds = new Set(msg.emotes.map((e) => e.id))
      const mergedEmotes = [...msg.emotes]
      for (const emote of sevenTVEmoteMap.values()) {
        if (!existingIds.has(emote.id)) {
          mergedEmotes.push(emote)
          existingIds.add(emote.id)
        }
      }

      const enrichedMsg: NormalizedChatMessage = {
        ...msg,
        emotes: mergedEmotes,
      }

      // Кольцевой буфер
      this.messageBuffer.push(enrichedMsg)
      if (this.messageBuffer.length > this.bufferSize) {
        const removed = this.messageBuffer.shift()
        if (removed) {
          this.seenIds.delete(removed.id)
        }
      }

      for (const handler of this.onMessageHandlers) {
        try {
          handler(enrichedMsg)
        } catch (error) {
          console.error('[Aggregator] message handler error:', error)
        }
      }
    })

    adapter.on('event', (event) => {
      for (const handler of this.onEventHandlers) {
        try {
          handler(event)
        } catch (error) {
          console.error('[Aggregator] event handler error:', error)
        }
      }
    })

    adapter.on('status', (status) => {
      for (const handler of this.onStatusHandlers) {
        try {
          handler(status)
        } catch (error) {
          console.error('[Aggregator] status handler error:', error)
        }
      }
    })
  }

  getAdapter(platform: Platform): IPlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  getRecentMessages(): NormalizedChatMessage[] {
    return [...this.messageBuffer]
  }

  onMessage(handler: AggregatorEventHandler<NormalizedChatMessage>): () => void {
    this.onMessageHandlers.add(handler)
    return () => this.onMessageHandlers.delete(handler)
  }

  onEvent(handler: AggregatorEventHandler<NormalizedEvent>): () => void {
    this.onEventHandlers.add(handler)
    return () => this.onEventHandlers.delete(handler)
  }

  onStatus(handler: AggregatorEventHandler<PlatformStatusInfo>): () => void {
    this.onStatusHandlers.add(handler)
    return () => this.onStatusHandlers.delete(handler)
  }

  async connectAll(channels: Partial<Record<Platform, string>>): Promise<void> {
    const promises = Object.entries(channels).map(([platform, slug]) => {
      const adapter = this.adapters.get(platform as Platform)
      if (adapter && slug) {
        return adapter.connect(slug).catch((error) => {
          console.error(`[Aggregator] Failed to connect ${platform}:`, error)
        })
      }
      return Promise.resolve()
    })
    await Promise.all(promises)
  }

  async disconnectAll(): Promise<void> {
    const promises = [...this.adapters.values()].map((a) =>
      a.disconnect().catch((error) => console.error(`[Aggregator] Disconnect error:`, error)),
    )
    await Promise.all(promises)
  }

  /** Inject a message directly (e.g. from backend WebSocket) */
  injectMessage(msg: NormalizedChatMessage): void {
    if (this.seenIds.has(msg.id)) {
      return
    }
    this.seenIds.add(msg.id)

    // Parse 7TV emotes and merge with platform emotes
    const parsed = parseMessageWithEmotes(msg.text, msg.platform, msg.channelId)
    const sevenTVEmotes: Emote[] = parsed.emotes.map((e) => ({
      aspectRatio: e.aspectRatio,
      id: e.id,
      imageUrl: e.imageUrl,
      name: e.name,
      positions: [{ start: e.start, end: e.end }],
    }))

    const sevenTVEmoteMap = new Map<string, Emote>()
    for (const emote of sevenTVEmotes) {
      const existing = sevenTVEmoteMap.get(emote.id)
      if (existing) {
        existing.positions.push(...emote.positions)
      } else {
        sevenTVEmoteMap.set(emote.id, { ...emote, positions: [...emote.positions] })
      }
    }

    const existingIds = new Set(msg.emotes.map((e) => e.id))
    const mergedEmotes = [...msg.emotes]
    for (const emote of sevenTVEmoteMap.values()) {
      if (!existingIds.has(emote.id)) {
        mergedEmotes.push(emote)
        existingIds.add(emote.id)
      }
    }

    const enrichedMsg: NormalizedChatMessage = {
      ...msg,
      emotes: mergedEmotes,
    }

    this.messageBuffer.push(enrichedMsg)
    if (this.messageBuffer.length > this.bufferSize) {
      const removed = this.messageBuffer.shift()
      if (removed) {
        this.seenIds.delete(removed.id)
      }
    }

    for (const handler of this.onMessageHandlers) {
      try {
        handler(enrichedMsg)
      } catch (error) {
        console.error('[Aggregator] message handler error:', error)
      }
    }
  }

  /** Inject an event directly (e.g. from backend WebSocket) */
  injectEvent(event: NormalizedEvent): void {
    for (const handler of this.onEventHandlers) {
      try {
        handler(event)
      } catch (error) {
        console.error('[Aggregator] event handler error:', error)
      }
    }
  }

  /** Inject a status update directly (e.g. from backend WebSocket) */
  injectStatus(status: PlatformStatusInfo): void {
    for (const handler of this.onStatusHandlers) {
      try {
        handler(status)
      } catch (error) {
        console.error('[Aggregator] status handler error:', error)
      }
    }
  }
}
