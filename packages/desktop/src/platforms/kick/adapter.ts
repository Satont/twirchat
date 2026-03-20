import { BasePlatformAdapter } from "../base-adapter";
import type { NormalizedChatMessage, NormalizedEvent, Badge } from "@chatrix/shared/types";
import {
  KICK_PUSHER_WS,
  KICK_API_BASE,
} from "@chatrix/shared/constants";

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
  private isConnected = false;
  private shouldReconnect = true;

  async connect(channelSlug: string): Promise<void> {
    this.channelSlug = channelSlug;
    this.shouldReconnect = true;

    this.emit("status", {
      platform: "kick",
      status: "connecting",
      mode: "anonymous",
    });

    this.chatroomId = await this.fetchChatroomId(channelSlug);
    await this.connectPusher();
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
      mode: "anonymous",
    });
  }

  /**
   * Sending messages is handled externally via the backend WS
   * (send_message message type). Calling this directly is not supported.
   */
  async sendMessage(_channelId: string, _text: string): Promise<void> {
    throw new Error(
      "KickAdapter.sendMessage: use BackendConnection.send({ type: 'send_message', ... }) instead"
    );
  }

  // ============================================================
  // Private
  // ============================================================

  private async fetchChatroomId(channelSlug: string): Promise<number> {
    const res = await fetch(`${KICK_API_BASE}/channels/${channelSlug}`);
    if (!res.ok) {
      throw new Error(`Cannot fetch Kick channel info for "${channelSlug}": ${res.status}`);
    }

    const body = (await res.json()) as {
      data?: { chatroom?: { id: number } };
    };

    const id = body.data?.chatroom?.id;
    if (!id) throw new Error(`Kick chatroom ID not found for channel "${channelSlug}"`);

    console.log(`[Kick] Channel "${channelSlug}" → chatroom_id=${id}`);
    return id;
  }

  private async connectPusher(): Promise<void> {
    if (!this.chatroomId) throw new Error("chatroomId not set");

    const wsUrl = `${KICK_PUSHER_WS}?protocol=7&client=js&version=8.4.0&flash=false`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      console.log("[Kick] Pusher connected (anonymous)");
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as PusherEvent;
        this.handlePusherEvent(msg);
      } catch (err) {
        console.error("[Kick] Failed to parse Pusher event:", err);
      }
    });

    ws.addEventListener("close", (event) => {
      console.warn(`[Kick] Pusher disconnected: ${event.code} ${event.reason}`);
      this.isConnected = false;
      this.clearTimers();

      this.emit("status", {
        platform: "kick",
        status: "disconnected",
        mode: "anonymous",
      });

      if (this.shouldReconnect) {
        console.log("[Kick] Reconnecting in 5s...");
        this.reconnectTimeout = setTimeout(() => void this.connectPusher(), 5000);
      }
    });

    ws.addEventListener("error", (err) => {
      console.error("[Kick] Pusher WebSocket error:", err);
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
        console.log(`[Kick] Subscribed to chatroom ${this.chatroomId}`);
        this.isConnected = true;
        this.emit("status", {
          platform: "kick",
          status: "connected",
          mode: "anonymous",
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
      })
    );
  }

  private handleChatMessage(msg: KickChatMessage): void {
    const badges: Badge[] = msg.sender.identity.badges.map((b) => ({
      id: b.type,
      type: b.type,
      text: b.text,
    }));

    const normalized: NormalizedChatMessage = {
      id: msg.id,
      platform: "kick",
      channelId: String(msg.chatroom_id),
      author: {
        id: String(msg.sender.id),
        displayName: msg.sender.username,
        color: msg.sender.identity.color || undefined,
        avatarUrl: msg.sender.profile_picture ?? undefined,
        badges,
      },
      text: msg.content,
      emotes: [],
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
