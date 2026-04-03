import { BasePlatformAdapter } from "../base-adapter";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import {
  KICK_PUSHER_WS,
  KICK_API_BASE,
} from "@twirchat/shared/constants";
import { getBackendUrl } from "../../runtime-config";
import { AccountStore } from "../../store/account-store";
import { refreshKickToken } from "../../auth/kick";
import { getKickBadgeSvg } from "./badges";
import { logger } from "@twirchat/shared/logger";

const log = logger("kick");

// ============================================================
// Типы Kick Pusher events
// ============================================================

interface KickChatMessage {
  id: string;
  chatroom_id: number;
  content: string;
  type: "message" | "reply";
  created_at: string;
  sender: {
    id: number;
    username: string;
    slug: string;
    identity: {
      color: string;
      badges: Array<{
        type: string;
        text: string;
        count?: number;
      }>;
    };
    profile_picture?: string;
  };
}

interface KickFollowEvent {
  channel_id: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url?: string;
  followed_at: string;
}

interface KickSubscriptionEvent {
  channel_id: number;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url?: string;
  gifted_by?: string;
  duration?: number;
  created_at: string;
}

// Pusher protocol envelope
interface PusherEvent {
  event: string;
  channel?: string;
  data: string | Record<string, unknown>;
}

// ============================================================
// Kick адаптер
//
// Подключается к Kick через Pusher WebSocket в анонимном режиме
// (без токенов). Входящие сообщения чата и события (подписки,
// фолловы) приходят через Pusher. Отправка сообщений делегируется
// вовне — должна идти через backend WS (send_message).
// ============================================================

export class KickAdapter extends BasePlatformAdapter {
  readonly platform = "kick" as const;

  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private channelSlug = "";
  private chatroomId: number | null = null;
  private broadcasterUserId: number | null = null;
  private isConnected = false;
  private shouldReconnect = true;

  private anonymous = true;
  private accessToken: string | null = null;
  private accountId: string | null = null;
  private platformUserId: string | null = null;

  async connect(channelSlug: string): Promise<void> {
    this.channelSlug = channelSlug;
    this.shouldReconnect = true;

    // Check for stored account
    const account = AccountStore.findByPlatform("kick");
    if (account) {
      const tokens = AccountStore.getTokens(account.id);
      if (tokens) {
        this.anonymous = false;
        this.accessToken = tokens.accessToken;
        this.accountId = account.id;
        this.platformUserId = account.platformUserId;

        // Check if token needs refresh
        const now = Math.floor(Date.now() / 1000);
        if (tokens.expiresAt && tokens.expiresAt < now + 300) {
          log.info("[Kick] Token expired or expiring soon, refreshing...");
          try {
            this.accessToken = await refreshKickToken(account.id);
            log.info("[Kick] Token refreshed successfully");
          } catch (err) {
            log.error("[Kick] Failed to refresh token", { error: String(err) });
          }
        }
      }
    }

    if (this.anonymous) {
      this.accessToken = null;
    }

    this.emit("status", {
      platform: "kick",
      status: "connecting",
      mode: this.anonymous ? "anonymous" : "authenticated",
      channelLogin: channelSlug,
    });

    const info = await this.fetchChatroomId(channelSlug);
    this.chatroomId = info.chatroomId;
    this.broadcasterUserId = info.broadcasterUserId;
    await this.connectPusher();
  }

  getBroadcasterUserId(): number | null {
    return this.broadcasterUserId;
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;

    this.emit("status", {
      platform: "kick",
      status: "disconnected",
      mode: this.anonymous ? "anonymous" : "authenticated",
      channelLogin: this.channelSlug,
    });
  }

  async sendMessage(_channelId: string, text: string): Promise<void> {
    if (this.anonymous) {
      throw new Error(
        "Cannot send messages in anonymous mode. Please log in to Kick.",
      );
    }
    if (!this.accessToken) {
      throw new Error("Kick access token not available");
    }
    if (!this.accountId) {
      throw new Error("Kick account ID not available");
    }

    // Check if token needs refresh before sending
    await this.refreshTokenIfNeeded();

    const body = {
      broadcaster_user_id: this.broadcasterUserId ?? Number(this.platformUserId),
      content: text,
      type: "user",
    };

    const url = `${KICK_API_BASE}/chat`;
    let res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // If 401, try to refresh token and retry once
    if (res.status === 401) {
      log.info("[Kick] Got 401, attempting token refresh...");
      const refreshed = await this.refreshTokenIfNeeded();
      if (refreshed) {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }
    }

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      throw new Error(
        `Failed to send Kick message ${JSON.stringify(body)}: ${res.status} ${responseBody}`,
      );
    }
  }

  private async refreshTokenIfNeeded(): Promise<boolean> {
    if (!this.accountId) return false;

    const tokens = AccountStore.getTokens(this.accountId);
    if (!tokens?.refreshToken) return false;

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt && tokens.expiresAt < now + 300) {
      log.info("[Kick] Token expired or expiring soon, refreshing...");
      try {
        this.accessToken = await refreshKickToken(this.accountId);
        log.info("[Kick] Token refreshed successfully");
        return true;
      } catch (err) {
        log.error("[Kick] Failed to refresh token", { error: String(err) });
        return false;
      }
    }
    return false;
  }

  // ============================================================
  // Private
  // ============================================================

  private async fetchChatroomId(channelSlug: string): Promise<{ chatroomId: number; broadcasterUserId: number }> {
    const url = `${getBackendUrl()}/api/kick/chatroom?slug=${encodeURIComponent(channelSlug)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Cannot fetch Kick chatroom for "${channelSlug}": ${res.status} ${body}`,
      );
    }

    const data = (await res.json()) as { chatroomId?: number; broadcasterUserId?: number; error?: string };
    if (data.error)
      throw new Error(
        `Kick chatroom error for "${channelSlug}": ${data.error}`,
      );

    const chatroomId = data.chatroomId;
    const broadcasterUserId = data.broadcasterUserId;
    if (!chatroomId)
      throw new Error(
        `Kick chatroom ID not found for channel "${channelSlug}"`,
      );
    if (!broadcasterUserId)
      throw new Error(
        `Kick broadcaster user ID not found for channel "${channelSlug}"`,
      );

    log.info(`[Kick] Channel "${channelSlug}" → chatroom_id=${chatroomId}, broadcaster_user_id=${broadcasterUserId}`);
    return { chatroomId, broadcasterUserId };
  }

  private async connectPusher(): Promise<void> {
    if (!this.chatroomId) throw new Error("chatroomId not set");

    const wsUrl = `${KICK_PUSHER_WS}?protocol=7&client=js&version=8.4.0&flash=false`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      log.info(
        `[Kick] Pusher connected (${this.anonymous ? "anonymous" : "authenticated"})`,
      );
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as PusherEvent;
        this.handlePusherEvent(msg);
      } catch (err) {
        log.error("[Kick] Failed to parse Pusher event", { error: String(err) });
      }
    });

    ws.addEventListener("close", (event) => {
      log.warn(`[Kick] Pusher disconnected: ${event.code} ${event.reason}`);
      this.isConnected = false;
      this.clearTimers();

      this.emit("status", {
        platform: "kick",
        status: "disconnected",
        mode: this.anonymous ? "anonymous" : "authenticated",
        channelLogin: this.channelSlug,
      });

      if (this.shouldReconnect) {
        log.info("[Kick] Reconnecting in 5s...");
        this.reconnectTimeout = setTimeout(
          () => void this.connectPusher(),
          5000,
        );
      }
    });

    ws.addEventListener("error", (err) => {
      log.error("[Kick] Pusher WebSocket error", { error: String(err) });
    });
  }

  private handlePusherEvent(event: PusherEvent): void {
    switch (event.event) {
      case "pusher:connection_established": {
        this.subscribeToChatroom();
        break;
      }

      case "pusher:ping": {
        this.ws?.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        break;
      }

      case "pusher_internal:subscription_succeeded": {
        log.info(`[Kick] Subscribed to chatroom ${this.chatroomId}`);
        this.isConnected = true;
        this.emit("status", {
          platform: "kick",
          status: "connected",
          mode: this.anonymous ? "anonymous" : "authenticated",
          channelLogin: this.channelSlug,
        });
        break;
      }

      case "App\\Events\\ChatMessageEvent": {
        const data =
          typeof event.data === "string"
            ? (JSON.parse(event.data) as KickChatMessage)
            : (event.data as unknown as KickChatMessage);
        this.handleChatMessage(data);
        break;
      }

      case "App\\Events\\FollowersUpdated": {
        const data =
          typeof event.data === "string"
            ? (JSON.parse(event.data) as KickFollowEvent)
            : (event.data as unknown as KickFollowEvent);
        this.handleFollowEvent(data);
        break;
      }

      case "App\\Events\\SubscriptionEvent": {
        const data =
          typeof event.data === "string"
            ? (JSON.parse(event.data) as KickSubscriptionEvent)
            : (event.data as unknown as KickSubscriptionEvent);
        this.handleSubscriptionEvent(data);
        break;
      }

      default: {
        if (!event.event.startsWith("pusher")) {
          log.info(`[Kick] Unhandled Pusher event: ${event.event}`);
        }
        break;
      }
    }
  }

  private subscribeToChatroom(): void {
    if (!this.chatroomId || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: {
          auth: "",
          channel: `chatrooms.${this.chatroomId}.v2`,
        },
      }),
    );
  }

  private handleChatMessage(msg: KickChatMessage): void {
    const badges: Badge[] = msg.sender.identity.badges.map((b) => ({
      id: b.type,
      type: b.type,
      text: b.text,
      imageUrl: getKickBadgeSvg(b.type) || undefined,
    }));

    // Parse Kick emotes from content
    // Format: [emote:37232:PeepoClap]
    const emotes: import("@twirchat/shared/types").Emote[] = [];
    const emoteRegex = /\[emote:(\d+):([^\]]+)\]/g;
    let match;
    let cleanText = msg.content;
    let offsetDelta = 0;

    while ((match = emoteRegex.exec(msg.content)) !== null) {
      const [fullMatch, emoteId, emoteName] = match;
      if (!emoteId || !emoteName) continue;
      const originalStart = match.index;
      const originalEnd = originalStart + fullMatch.length - 1;

      // Calculate position in clean text (after removing emote tags)
      const cleanStart = originalStart - offsetDelta;
      const cleanEnd = cleanStart + emoteName.length - 1;

      emotes.push({
        id: emoteId,
        name: emoteName,
        imageUrl: `https://files.kick.com/emotes/${emoteId}/fullsize`,
        positions: [{ start: cleanStart, end: cleanEnd }],
      });

      // Update offset for next matches
      offsetDelta += fullMatch.length - emoteName.length;
    }

    // Remove emote tags from text, leaving just the name
    cleanText = msg.content.replace(/\[emote:\d+:([^\]]+)\]/g, "$1");

    const normalized: NormalizedChatMessage = {
      id: msg.id,
      platform: "kick",
      channelId: String(this.broadcasterUserId ?? msg.chatroom_id),
      author: {
        id: String(msg.sender.id),
        username: msg.sender.username,
        displayName: msg.sender.username,
        color: msg.sender.identity.color || undefined,
        avatarUrl: msg.sender.profile_picture ?? undefined,
        badges,
      },
      text: cleanText,
      emotes,
      timestamp: new Date(msg.created_at),
      type: "message",
    };

    this.emit("message", normalized);
  }

  private handleFollowEvent(event: KickFollowEvent): void {
    const normalized: NormalizedEvent = {
      id: `kick:follow:${event.user_id}:${event.followed_at}`,
      platform: "kick",
      type: "follow",
      user: {
        id: String(event.user_id),
        displayName: event.display_name || event.username,
        avatarUrl: event.avatar_url,
      },
      data: { channelId: event.channel_id },
      timestamp: new Date(event.followed_at),
    };

    this.emit("event", normalized);
  }

  private handleSubscriptionEvent(event: KickSubscriptionEvent): void {
    const isGift = Boolean(event.gifted_by);

    const normalized: NormalizedEvent = {
      id: `kick:sub:${event.user_id}:${event.created_at}`,
      platform: "kick",
      type: isGift ? "gift_sub" : "sub",
      user: {
        id: String(event.user_id),
        displayName: event.display_name || event.username,
        avatarUrl: event.avatar_url,
      },
      data: {
        channelId: event.channel_id,
        giftedBy: event.gifted_by,
        duration: event.duration,
      },
      timestamp: new Date(event.created_at),
    };

    this.emit("event", normalized);
  }

  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}
