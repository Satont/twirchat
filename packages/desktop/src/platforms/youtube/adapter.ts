/**
 * YouTube Platform Adapter (Unofficial API via youtubei.js)
 *
 * Connects to YouTube Live Chat using the unofficial Innertube API via youtubei.js.
 * This does NOT require OAuth for reading chat and does NOT consume YouTube API quota.
 *
 * Flow:
 *   1. Get the channel's live streams using Innertube
 *   2. Get video info and live chat continuation
 *   3. Start polling for chat messages via EventEmitter
 *   4. Normalize incoming messages and emit them
 *
 * Auth: Not required for reading. OAuth only needed for sending messages.
 */

import { Innertube, UniversalCache, YT, YTNodes } from "youtubei.js";

import { BasePlatformAdapter } from "../base-adapter.js";
import { AccountStore } from "../../store/account-store.js";
import { getBackendUrl } from "../../runtime-config.js";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import { logger } from "@twirchat/shared/logger";

const log = logger("youtube");

// Extract types from youtubei.js YT namespace
type LiveChatInstance = InstanceType<typeof YT.LiveChat>;

// ChatAction union type based on youtubei.js YTNodes action types
type ChatAction =
  | InstanceType<typeof YTNodes.AddChatItemAction>
  | InstanceType<typeof YTNodes.AddBannerToLiveChatCommand>
  | InstanceType<typeof YTNodes.AddLiveChatTickerItemAction>
  | InstanceType<typeof YTNodes.MarkChatItemAsDeletedAction>
  | InstanceType<typeof YTNodes.MarkChatItemsByAuthorAsDeletedAction>
  | InstanceType<typeof YTNodes.ReplaceChatItemAction>
  | InstanceType<typeof YTNodes.ReplayChatItemAction>
  | InstanceType<typeof YTNodes.ShowLiveChatActionPanelAction>;

type AddChatItemActionType = InstanceType<typeof YTNodes.AddChatItemAction>;
type LiveChatTextMessage = InstanceType<typeof YTNodes.LiveChatTextMessage>;
type LiveChatPaidMessage = InstanceType<typeof YTNodes.LiveChatPaidMessage>;
type LiveChatMembershipItem = InstanceType<
  typeof YTNodes.LiveChatMembershipItem
>;
type LiveChatPaidSticker = InstanceType<typeof YTNodes.LiveChatPaidSticker>;

export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = "youtube" as const;

  private channelId = "";
  private resolvedChannelId: string | null = null;
  private shouldReconnect = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY = 60000;
  private readonly BASE_RECONNECT_DELAY = 5000;

  private innertube: Awaited<ReturnType<typeof Innertube.create>> | null = null;
  private liveChat: LiveChatInstance | null = null;

  async connect(channelIdOrHandle: string): Promise<void> {
    this.channelId = channelIdOrHandle;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    this.emit("status", {
      platform: "youtube",
      status: "connecting",
      mode: "anonymous",
      channelLogin: this.channelId,
    });

    // Resolve channel ID from handle if needed
    try {
      this.resolvedChannelId = await this.resolveChannelId(channelIdOrHandle);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error(`[YouTube] Failed to resolve channel: ${errorMessage}`);
      
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "anonymous",
        error: errorMessage,
        channelLogin: this.channelId,
      });
      return;
    }

    await this.tryConnect();
  }

  /**
   * Resolves a channel ID from handle/username.
   * - If input starts with UC, uses it directly as channel ID
   * - If starts with @, checks authenticated account first, then falls back to backend resolve
   * - Otherwise treats as username and tries to resolve
   */
  private async resolveChannelId(input: string): Promise<string> {
    const cleanInput = input.trim();

    // If already a channel ID (starts with UC), use directly
    if (/^UC/i.test(cleanInput)) {
      log.info(`[YouTube] Using channel ID directly: ${cleanInput}`);
      return cleanInput;
    }

    // Strip @ prefix for handle lookup
    const handle = cleanInput.startsWith("@") ? cleanInput : `@${cleanInput}`;
    const handleWithoutAt = handle.slice(1);

    // First, check if we have an authenticated account with matching username
    const account = AccountStore.findByPlatform("youtube");
    if (account) {
      // Check if username matches (with or without @)
      if (account.username === handle || account.username === handleWithoutAt) {
        log.info(`[YouTube] Found channel ID from authenticated account: ${account.platformUserId}`);
        return account.platformUserId;
      }
      
      // If input matches platformUserId directly
      if (account.platformUserId === cleanInput) {
        return account.platformUserId;
      }
    }

    // Fall back to backend resolve
    log.info(`[YouTube] Resolving handle via backend: ${handle}`);
    const resolvedId = await this.resolveHandleViaBackend(handleWithoutAt);
    if (resolvedId) {
      return resolvedId;
    }

    throw new Error(`Could not resolve "${input}" to a YouTube channel ID. Make sure the handle is correct.`);
  }

  /**
   * Calls the backend /api/youtube/resolve endpoint to get a channel ID.
   * The backend caches results and uses a server-side API key.
   */
  private async resolveHandleViaBackend(handle: string): Promise<string | null> {
    try {
      const res = await fetch(
        `${getBackendUrl()}/api/youtube/resolve?handle=${encodeURIComponent(handle)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { channelId?: string; error?: string };
        if (body.channelId) {
          log.info(`[YouTube] Backend resolved handle to channel: ${body.channelId}`);
          return body.channelId;
        }
        log.warn(`[YouTube] Backend resolve returned no channelId`, { body });
      } else {
        const body = await res.text();
        log.warn(`[YouTube] Backend resolve failed: ${res.status}`, { body: body.slice(0, 300) });
      }
    } catch (err) {
      log.warn(`[YouTube] Backend resolve request failed`, { error: String(err) });
    }
    return null;
  }

  private async tryConnect(): Promise<void> {
    if (!this.shouldReconnect) return;

    const channelIdToUse = this.resolvedChannelId || this.channelId;

    try {
      // Create Innertube instance
      if (!this.innertube) {
        log.info("[YouTube] Creating Innertube instance...");
        this.innertube = await Innertube.create({
          cache: new UniversalCache(false),
        });
      }

      // Get channel
      log.info(`[YouTube] Looking up channel: ${channelIdToUse}`);
      const channel = await this.innertube.getChannel(channelIdToUse);

      // Get live streams
      const liveStreams = await channel.getLiveStreams();

      if (!liveStreams.videos || liveStreams.videos.length === 0) {
        log.info("[YouTube] No active live stream found");
        this.emit("status", {
          platform: "youtube",
          status: "connecting",
          mode: "anonymous",
          error: "Waiting for live stream to start...",
          channelLogin: this.channelId,
        });

        this.scheduleReconnect();
        return;
      }

      const liveVideo = liveStreams.videos[0];

      // Check if liveVideo has the required properties
      if (!liveVideo || typeof liveVideo !== "object") {
        throw new Error("Invalid live video data");
      }

      // Type guard for Video type which has id and title
      const videoId = (liveVideo as { id?: string }).id;
      const videoTitle = (liveVideo as { title?: string }).title;

      if (!videoId) {
        throw new Error("Live video has no ID");
      }

      log.info(
        `[YouTube] Found live stream: ${videoTitle || "Unknown"} (${videoId})`,
      );

      // Get video info
      const videoInfo = await this.innertube.getInfo(videoId);

      // Get live chat
      this.liveChat = videoInfo.getLiveChat();

      if (!this.liveChat) {
        throw new Error("Live chat not available for this video");
      }

      // Set up event handlers
      this.setupLiveChatHandlers();

      // Start live chat
      this.liveChat.start();

      this.reconnectAttempts = 0;

      this.emit("status", {
        platform: "youtube",
        status: "connected",
        mode: "anonymous",
        channelLogin: this.channelId,
      });

      log.info("[YouTube] Connected to live chat");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error(`[YouTube] Connection error: ${errorMessage}`);

      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "anonymous",
        error: errorMessage,
        channelLogin: this.channelId,
      });

      this.scheduleReconnect();
    }
  }

  private setupLiveChatHandlers(): void {
    if (!this.liveChat) return;

    this.liveChat.on("start", () => {
      log.info("[YouTube] Live chat started");
    });

    this.liveChat.on("chat-update", (action: unknown) => {
      this.handleChatAction(action as ChatAction);
    });

    this.liveChat.on("end", () => {
      log.info("[YouTube] Live chat ended");
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.liveChat.on("error", (err: Error) => {
      log.error(`[YouTube] Live chat error: ${err.message}`);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  private handleChatAction(action: ChatAction): void {
    if (action.type !== "AddChatItemAction") return;

    const item = (action as AddChatItemActionType).item;
    if (!item) return;

    // Handle text messages
    if (item.type === "LiveChatTextMessage") {
      this.handleTextMessage(item as LiveChatTextMessage);
      return;
    }

    // Handle super chat (paid messages)
    if (item.type === "LiveChatPaidMessage") {
      this.handleSuperChat(item as LiveChatPaidMessage);
      return;
    }

    // Handle membership
    if (item.type === "LiveChatMembershipItem") {
      this.handleMembership(item as LiveChatMembershipItem);
      return;
    }

    // Handle paid stickers
    if (item.type === "LiveChatPaidSticker") {
      this.handlePaidSticker(item as LiveChatPaidSticker);
      return;
    }
  }

  private handleTextMessage(item: LiveChatTextMessage): void {
    const author = item.author;
    if (!author) return;

    const text = this.extractTextFromRuns(item.message);
    if (!text) return;

    const badges = this.extractBadges(author);
    const avatarUrl = author.best_thumbnail?.url;

    const normalized: NormalizedChatMessage = {
      id: item.id,
      platform: "youtube",
      channelId: this.channelId,
      author: {
        id: author.id,
        displayName: author.name,
        avatarUrl,
        badges,
      },
      text,
      emotes: [],
      timestamp: new Date(item.timestamp),
      type: "message",
    };

    this.emit("message", normalized);
  }

  private handleSuperChat(item: LiveChatPaidMessage): void {
    const author = item.author;
    if (!author) return;

    const text = this.extractTextFromRuns(item.message);
    const avatarUrl = author.best_thumbnail?.url;

    const event: NormalizedEvent = {
      id: item.id,
      platform: "youtube",
      type: "superchat",
      user: {
        id: author.id,
        displayName: author.name,
        avatarUrl,
      },
      data: {
        amount: item.purchase_amount,
        currency: this.extractCurrency(item.purchase_amount),
        comment: text,
      },
      timestamp: new Date(item.timestamp),
    };

    this.emit("event", event);
  }

  private handleMembership(item: LiveChatMembershipItem): void {
    const author = item.author;
    if (!author) return;

    const avatarUrl = author.best_thumbnail?.url;
    const headerText = item.header_primary_text
      ? this.extractTextFromRuns(item.header_primary_text)
      : undefined;
    const subtext = item.header_subtext
      ? this.extractTextFromRuns(item.header_subtext)
      : undefined;

    const event: NormalizedEvent = {
      id: item.id,
      platform: "youtube",
      type: "membership",
      user: {
        id: author.id,
        displayName: author.name,
        avatarUrl,
      },
      data: {
        headerText,
        subtext,
        message: item.message
          ? this.extractTextFromRuns(item.message)
          : undefined,
      },
      timestamp: new Date(item.timestamp),
    };

    this.emit("event", event);
  }

  private handlePaidSticker(item: LiveChatPaidSticker): void {
    const author = item.author;
    if (!author) return;

    const avatarUrl = author.best_thumbnail?.url;

    const event: NormalizedEvent = {
      id: item.id,
      platform: "youtube",
      type: "superchat",
      user: {
        id: author.id,
        displayName: author.name,
        avatarUrl,
      },
      data: {
        amount: item.purchase_amount,
        currency: this.extractCurrency(item.purchase_amount),
        sticker: true,
      },
      timestamp: new Date(),
    };

    this.emit("event", event);
  }

  private extractTextFromRuns(textObj: unknown): string {
    if (!textObj || typeof textObj !== "object") return "";

    // Handle Text objects from youtubei.js
    const obj = textObj as {
      runs?: Array<{
        text?: string;
        emoji?: {
          emoji_id?: string;
          shortcuts?: string[];
          image?: { url?: string };
        };
      }>;
      text?: string;
    };

    if (obj.text) {
      return obj.text;
    }

    if (obj.runs && Array.isArray(obj.runs)) {
      return obj.runs
        .map((run) => {
          if (run.text) return run.text;
          if (run.emoji) {
            // Return emoji shortcut if available, otherwise empty
            return run.emoji.shortcuts?.[0] || "";
          }
          return "";
        })
        .join("");
    }

    return "";
  }

  private extractBadges(author: {
    badges?: Array<{ type?: string; icon_type?: string }>;
    is_moderator?: boolean;
  }): Badge[] {
    const badges: Badge[] = [];

    if (author.is_moderator) {
      badges.push({ id: "mod", type: "moderator", text: "Moderator" });
    }

    if (author.badges && Array.isArray(author.badges)) {
      for (const badge of author.badges) {
        if (badge.icon_type === "OWNER") {
          badges.push({ id: "owner", type: "broadcaster", text: "Owner" });
        } else if (badge.icon_type === "VERIFIED") {
          badges.push({ id: "verified", type: "staff", text: "Verified" });
        } else if (badge.type?.includes("MEMBER")) {
          badges.push({ id: "member", type: "subscriber", text: "Member" });
        }
      }
    }

    return badges;
  }

  private extractCurrency(amountStr: string): string {
    // Extract currency from amount string like "$10.00" or "€5.00"
    const match = amountStr.match(/^[^\d\s,.]+/);
    return match ? match[0] : "USD";
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.liveChat) {
      this.liveChat.stop();
      this.liveChat = null;
    }

    this.innertube = null;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "anonymous",
    });

    log.info("[YouTube] Disconnected");
  }

  async sendMessage(_channelId: string, _text: string): Promise<void> {
    // Sending messages requires authentication
    // This would need to be implemented with OAuth if needed
    throw new Error(
      "YouTubeAdapter.sendMessage: not implemented for unofficial API. Use official API for sending messages.",
    );
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    // Clean up current connection
    if (this.liveChat) {
      this.liveChat.stop();
      this.liveChat = null;
    }

    // Calculate exponential backoff with jitter
    const baseDelay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY,
    );
    const jitter = Math.random() * 2000;
    const delay = baseDelay + jitter;

    this.reconnectAttempts++;
    log.info(
      `[YouTube] Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts})`,
    );

    this.emit("status", {
      platform: "youtube",
      status: "connecting",
      mode: "anonymous",
      error: `Reconnecting in ${Math.round(delay / 1000)}s...`,
      channelLogin: this.channelId,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.tryConnect();
    }, delay);
  }
}
