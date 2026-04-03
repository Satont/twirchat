import type {
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
  Emote,
} from "@twirchat/shared/types";
import type { IPlatformAdapter } from "../platforms/base-adapter";
import type { Platform } from "@twirchat/shared/types";
import { parseMessageWithEmotes } from "../platforms/7tv/emote-parser";

type AggregatorEventHandler<T> = (data: T) => void;

export class ChatAggregator {
  private adapters = new Map<Platform, IPlatformAdapter>();
  private messageBuffer: NormalizedChatMessage[] = [];
  private readonly bufferSize: number;

  private onMessageHandlers: Set<
    AggregatorEventHandler<NormalizedChatMessage>
  > = new Set();
  private onEventHandlers: Set<AggregatorEventHandler<NormalizedEvent>> =
    new Set();
  private onStatusHandlers: Set<AggregatorEventHandler<PlatformStatusInfo>> =
    new Set();

  private seenIds = new Set<string>();

  constructor(bufferSize = 500) {
    this.bufferSize = bufferSize;
  }

  registerAdapter(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);

    adapter.on("message", (msg) => {
      if (this.seenIds.has(msg.id)) return;
      this.seenIds.add(msg.id);

      // Parse 7TV emotes and merge with platform emotes
      const parsed = parseMessageWithEmotes(msg.text, msg.platform, msg.channelId);
      const sevenTVEmotes: Emote[] = parsed.emotes.map((e) => ({
        id: e.id,
        name: e.name,
        imageUrl: e.imageUrl,
        positions: [{ start: e.start, end: e.end }],
        aspectRatio: e.aspectRatio,
      }));

      // Merge emotes, avoiding duplicates
      const existingIds = new Set(msg.emotes.map((e) => e.id));
      const mergedEmotes = [...msg.emotes];
      for (const emote of sevenTVEmotes) {
        if (!existingIds.has(emote.id)) {
          mergedEmotes.push(emote);
          existingIds.add(emote.id);
        }
      }

      const enrichedMsg: NormalizedChatMessage = {
        ...msg,
        emotes: mergedEmotes,
      };

      // Кольцевой буфер
      this.messageBuffer.push(enrichedMsg);
      if (this.messageBuffer.length > this.bufferSize) {
        const removed = this.messageBuffer.shift();
        if (removed) this.seenIds.delete(removed.id);
      }

      for (const handler of this.onMessageHandlers) {
        try {
          handler(enrichedMsg);
        } catch (e) {
          console.error("[Aggregator] message handler error:", e);
        }
      }
    });

    adapter.on("event", (event) => {
      for (const handler of this.onEventHandlers) {
        try {
          handler(event);
        } catch (e) {
          console.error("[Aggregator] event handler error:", e);
        }
      }
    });

    adapter.on("status", (status) => {
      for (const handler of this.onStatusHandlers) {
        try {
          handler(status);
        } catch (e) {
          console.error("[Aggregator] status handler error:", e);
        }
      }
    });
  }

  getAdapter(platform: Platform): IPlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  getRecentMessages(): NormalizedChatMessage[] {
    return [...this.messageBuffer];
  }

  onMessage(
    handler: AggregatorEventHandler<NormalizedChatMessage>,
  ): () => void {
    this.onMessageHandlers.add(handler);
    return () => this.onMessageHandlers.delete(handler);
  }

  onEvent(handler: AggregatorEventHandler<NormalizedEvent>): () => void {
    this.onEventHandlers.add(handler);
    return () => this.onEventHandlers.delete(handler);
  }

  onStatus(handler: AggregatorEventHandler<PlatformStatusInfo>): () => void {
    this.onStatusHandlers.add(handler);
    return () => this.onStatusHandlers.delete(handler);
  }

  async connectAll(channels: Partial<Record<Platform, string>>): Promise<void> {
    const promises = Object.entries(channels).map(([platform, slug]) => {
      const adapter = this.adapters.get(platform as Platform);
      if (adapter && slug) {
        return adapter.connect(slug).catch((err) => {
          console.error(`[Aggregator] Failed to connect ${platform}:`, err);
        });
      }
      return Promise.resolve();
    });
    await Promise.all(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = [...this.adapters.values()].map((a) =>
      a
        .disconnect()
        .catch((err) => console.error(`[Aggregator] Disconnect error:`, err)),
    );
    await Promise.all(promises);
  }

  /** Inject a message directly (e.g. from backend WebSocket) */
  injectMessage(msg: NormalizedChatMessage): void {
    if (this.seenIds.has(msg.id)) return;
    this.seenIds.add(msg.id);

    // Parse 7TV emotes and merge with platform emotes
    const parsed = parseMessageWithEmotes(msg.text, msg.platform, msg.channelId);
    const sevenTVEmotes: Emote[] = parsed.emotes.map((e) => ({
      id: e.id,
      name: e.name,
      imageUrl: e.imageUrl,
      positions: [{ start: e.start, end: e.end }],
      aspectRatio: e.aspectRatio,
    }));

    // Merge emotes, avoiding duplicates
    const existingIds = new Set(msg.emotes.map((e) => e.id));
    const mergedEmotes = [...msg.emotes];
    for (const emote of sevenTVEmotes) {
      if (!existingIds.has(emote.id)) {
        mergedEmotes.push(emote);
        existingIds.add(emote.id);
      }
    }

    const enrichedMsg: NormalizedChatMessage = {
      ...msg,
      emotes: mergedEmotes,
    };

    this.messageBuffer.push(enrichedMsg);
    if (this.messageBuffer.length > this.bufferSize) {
      const removed = this.messageBuffer.shift();
      if (removed) this.seenIds.delete(removed.id);
    }

    for (const handler of this.onMessageHandlers) {
      try {
        handler(enrichedMsg);
      } catch (e) {
        console.error("[Aggregator] message handler error:", e);
      }
    }
  }

  /** Inject an event directly (e.g. from backend WebSocket) */
  injectEvent(event: NormalizedEvent): void {
    for (const handler of this.onEventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error("[Aggregator] event handler error:", e);
      }
    }
  }

  /** Inject a status update directly (e.g. from backend WebSocket) */
  injectStatus(status: PlatformStatusInfo): void {
    for (const handler of this.onStatusHandlers) {
      try {
        handler(status);
      } catch (e) {
        console.error("[Aggregator] status handler error:", e);
      }
    }
  }
}
