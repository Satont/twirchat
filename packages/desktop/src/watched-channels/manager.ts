/**
 * WatchedChannelManager
 *
 * Manages a pool of platform adapters for "watched" (external) channels.
 * Each watched channel gets its own adapter instance and isolated message buffer.
 *
 * - On add: create adapter, start connect(), buffer messages, emit events
 * - On remove: disconnect adapter, clear buffer
 * - On sendMessage: route to correct adapter
 */

import { TwitchAdapter } from "../platforms/twitch/adapter";
import { KickAdapter } from "../platforms/kick/adapter";
import { YouTubeAdapter } from "../platforms/youtube/adapter";
import type { NormalizedChatMessage, PlatformStatusInfo, WatchedChannel } from "@twirchat/shared/types";
import { WatchedChannelStore } from "../store/watched-channels-store";
import { logger } from "@twirchat/shared/logger";
import { sevenTVService } from "../seventv";

const log = logger("watched-channels");

const MAX_BUFFER = 200;

export type WatchedChannelMessageHandler = (
  channelId: string,
  msg: NormalizedChatMessage,
) => void;

export type WatchedChannelStatusHandler = (
  channelId: string,
  status: PlatformStatusInfo,
) => void;

interface WatchedEntry {
  watchedChannel: WatchedChannel;
  adapter: TwitchAdapter | KickAdapter | YouTubeAdapter;
  messages: NormalizedChatMessage[];
  status: PlatformStatusInfo | null;
}

export class WatchedChannelManager {
  private entries = new Map<string, WatchedEntry>(); // keyed by WatchedChannel.id

  private messageHandlers = new Set<WatchedChannelMessageHandler>();
  private statusHandlers = new Set<WatchedChannelStatusHandler>();

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /** Restore all persisted watched channels on startup */
  async autoConnect(): Promise<void> {
    const channels = WatchedChannelStore.findAll();
    for (const ch of channels) {
      await this.startChannel(ch);
    }
  }

  /** Add a new watched channel (persists + connects) */
  async addChannel(
    platform: WatchedChannel["platform"],
    channelSlug: string,
    displayName?: string,
  ): Promise<WatchedChannel> {
    const slug = channelSlug.toLowerCase();
    const name = displayName ?? slug;
    const ch = WatchedChannelStore.upsert(platform, slug, name);

    // If already running, return existing
    if (!this.entries.has(ch.id)) {
      await this.startChannel(ch);
    }

    return ch;
  }

  /** Remove a watched channel (disconnects + removes from DB) */
  async removeChannel(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) {
      this.unbindAdapter(entry);
      // Unsubscribe from 7TV emotes for this channel
      sevenTVService.unsubscribeFromChannel(entry.watchedChannel.platform, entry.watchedChannel.channelSlug).catch((err) => {
        log.error("Failed to unsubscribe from 7TV for watched channel", {
          id,
          platform: entry.watchedChannel.platform,
          channelSlug: entry.watchedChannel.channelSlug,
          error: String(err),
          action: "7tv",
        });
      });
      await entry.adapter.disconnect().catch((err) => {
        log.error("Error disconnecting watched channel", { id, error: String(err) });
      });
      this.entries.delete(id);
    }
    WatchedChannelStore.remove(id);
  }

  /** Get all current watched channels */
  getAll(): WatchedChannel[] {
    return WatchedChannelStore.findAll();
  }

  /** Get buffered messages for a specific watched channel */
  getMessages(id: string): NormalizedChatMessage[] {
    return this.entries.get(id)?.messages ?? [];
  }

  /** Get current status for a specific watched channel */
  getStatus(id: string): PlatformStatusInfo | null {
    return this.entries.get(id)?.status ?? null;
  }

  /** Get current statuses for all watched channels */
  getAllStatuses(): Array<{ channelId: string; status: PlatformStatusInfo }> {
    const result: Array<{ channelId: string; status: PlatformStatusInfo }> = [];
    for (const [id, entry] of this.entries) {
      if (entry.status) {
        result.push({ channelId: id, status: entry.status });
      }
    }
    return result;
  }

  /**
   * Reconnect all watched channels for a given platform.
   * Called after login/logout so adapters pick up the new auth state.
   */
  async reconnectByPlatform(platform: string): Promise<void> {
    const matching = [...this.entries.values()].filter(
      (e) => e.watchedChannel.platform === platform,
    );

    await Promise.all(
      matching.map(async (entry) => {
        log.info("Reconnecting watched channel after auth change", {
          id: entry.watchedChannel.id,
          platform,
          slug: entry.watchedChannel.channelSlug,
        });
        try {
          this.unbindAdapter(entry);
          await entry.adapter.disconnect();
          this.bindAdapter(entry);
          await entry.adapter.connect(entry.watchedChannel.channelSlug);
        } catch (err) {
          log.error("Failed to reconnect watched channel", {
            id: entry.watchedChannel.id,
            error: String(err),
          });
        }
      }),
    );
  }

  /** Send a message via the watched channel's adapter */
  async sendMessage(id: string, text: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Watched channel ${id} not found`);
    await entry.adapter.sendMessage(entry.watchedChannel.channelSlug, text);
  }

  /** Register a handler for incoming messages */
  onMessage(handler: WatchedChannelMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  /** Register a handler for status changes */
  onStatus(handler: WatchedChannelStatusHandler): void {
    this.statusHandlers.add(handler);
  }

  // ----------------------------------------------------------------
  // Private
  // ----------------------------------------------------------------

  private async startChannel(ch: WatchedChannel): Promise<void> {
    const adapter = ch.platform === "twitch"
      ? new TwitchAdapter()
      : ch.platform === "youtube"
        ? new YouTubeAdapter()
        : new KickAdapter();

    const entry: WatchedEntry = {
      watchedChannel: ch,
      adapter,
      messages: [],
      status: null,
    };

    this.entries.set(ch.id, entry);
    this.bindAdapter(entry);

    log.info("Connecting watched channel", {
      id: ch.id,
      platform: ch.platform,
      slug: ch.channelSlug,
    });

    await adapter.connect(ch.channelSlug).catch((err) => {
      log.error("Failed to start watched channel adapter", {
        id: ch.id,
        error: String(err),
      });
    });

    // Subscribe to 7TV emotes for this channel
    // For Kick, use broadcasterUserId instead of slug
    let sevenTvChannelId = ch.channelSlug;
    if (ch.platform === "kick") {
      const kickAdapter = adapter as import("../platforms/kick/adapter").KickAdapter;
      const broadcasterUserId = kickAdapter.getBroadcasterUserId();
      if (broadcasterUserId) {
        sevenTvChannelId = String(broadcasterUserId);
      }
    }
    sevenTVService.subscribeToChannel(ch.platform, sevenTvChannelId).catch((err) => {
      log.error("Failed to subscribe to 7TV for watched channel", {
        id: ch.id,
        platform: ch.platform,
        channelSlug: sevenTvChannelId,
        error: String(err),
        action: "7tv",
      });
    });
  }

  private bindAdapter(entry: WatchedEntry): void {
    const { adapter, watchedChannel } = entry;

    const onMessage = (msg: NormalizedChatMessage) => {
      entry.messages = [msg, ...entry.messages].slice(0, MAX_BUFFER);
      for (const h of this.messageHandlers) h(watchedChannel.id, msg);
    };

    const onStatus = (status: PlatformStatusInfo) => {
      entry.status = status;
      for (const h of this.statusHandlers) h(watchedChannel.id, status);
    };

    adapter.on("message", onMessage);
    adapter.on("status", onStatus);

    // Store references for cleanup
    (entry as WatchedEntry & { _onMessage: typeof onMessage; _onStatus: typeof onStatus })._onMessage = onMessage;
    (entry as WatchedEntry & { _onMessage: typeof onMessage; _onStatus: typeof onStatus })._onStatus = onStatus;
  }

  private unbindAdapter(entry: WatchedEntry): void {
    const ext = entry as WatchedEntry & { _onMessage?: (msg: NormalizedChatMessage) => void; _onStatus?: (s: PlatformStatusInfo) => void };
    if (ext._onMessage) entry.adapter.off("message", ext._onMessage);
    if (ext._onStatus) entry.adapter.off("status", ext._onStatus);
  }
}
