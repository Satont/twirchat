/**
 * Twitch Platform Adapter
 *
 * Connects to Twitch IRC via WebSocket (wss://irc-ws.chat.twitch.tv).
 *
 * - Anonymous mode:  justinfan<random> (read-only, no auth required)
 * - Authenticated:   uses stored access token for chat:read/chat:edit
 *
 * For EventSub (subscriptions, bits, etc.) the authenticated path will
 * be added in a later sprint via Twitch EventSub WebSocket transport.
 *
 * Twitch IRC WebSocket docs:
 * https://dev.twitch.tv/docs/irc/
 */

import { BasePlatformAdapter } from "../base-adapter";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import { TWITCH_ANON_PREFIX, BACKEND_URL } from "@twirchat/shared/constants";
import { AccountStore } from "../../store/account-store";
import type { TwitchBadgesResponse } from "@twirchat/shared/types";

const TWITCH_IRC_WS = "wss://irc-ws.chat.twitch.tv:443";

// ============================================================
// IRC message parser
// ============================================================

interface TwitchIrcMessage {
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[];
}

function parseIrcMessage(raw: string): TwitchIrcMessage | null {
  let pos = 0;

  // Tags
  const tags: Record<string, string> = {};
  if (raw[pos] === "@") {
    const end = raw.indexOf(" ", pos);
    if (end === -1) return null;
    const tagStr = raw.slice(pos + 1, end);
    for (const part of tagStr.split(";")) {
      const eq = part.indexOf("=");
      if (eq !== -1) {
        tags[part.slice(0, eq)] = part.slice(eq + 1);
      } else {
        tags[part] = "";
      }
    }
    pos = end + 1;
  }

  // Prefix
  let prefix: string | null = null;
  if (raw[pos] === ":") {
    const end = raw.indexOf(" ", pos);
    if (end === -1) return null;
    prefix = raw.slice(pos + 1, end);
    pos = end + 1;
  }

  // Command
  const cmdEnd = raw.indexOf(" ", pos);
  const command = cmdEnd === -1 ? raw.slice(pos) : raw.slice(pos, cmdEnd);
  pos = cmdEnd === -1 ? raw.length : cmdEnd + 1;

  // Params
  const params: string[] = [];
  while (pos < raw.length) {
    if (raw[pos] === ":") {
      params.push(raw.slice(pos + 1));
      break;
    }
    const end = raw.indexOf(" ", pos);
    if (end === -1) {
      params.push(raw.slice(pos));
      break;
    }
    params.push(raw.slice(pos, end));
    pos = end + 1;
  }

  return { tags, prefix, command, params };
}

// ============================================================
// TwitchAdapter
// ============================================================

export class TwitchAdapter extends BasePlatformAdapter {
  readonly platform = "twitch" as const;

  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private badgeRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private channelName = "";
  private shouldReconnect = true;
  private joined = false;

  /** "setId/version" → imageUrl_1x, populated from backend /api/twitch/badges */
  private badgeCache = new Map<string, string>();
  private badgeCacheChannel = ""; // канал для которого загружены channel badges

  constructor() {
    super();
  }

  private anonymous = true;
  private accessToken: string | null = null;
  private displayName: string | null = null;
  private login: string | null = null;

  async connect(channelName: string): Promise<void> {
    this.channelName = channelName.toLowerCase();
    this.shouldReconnect = true;
    this.joined = false;

    // Check for stored account
    const account = AccountStore.findByPlatform("twitch");
    if (account) {
      const tokens = AccountStore.getTokens(account.id);
      if (tokens) {
        this.anonymous = false;
        this.accessToken = tokens.accessToken;
        this.displayName = account.displayName;
        this.login = account.username;
      }
    }

    if (this.anonymous) {
      this.accessToken = null;
    }

    this.emit("status", {
      platform: "twitch",
      status: "connecting",
      mode: this.anonymous ? "anonymous" : "authenticated",
    });

    // Initial badge fetch + schedule refresh every 5 minutes
    void this.fetchBadges();
    this.badgeRefreshInterval = setInterval(() => void this.fetchBadges(), 5 * 60 * 1000);

    this.connectWs();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;

    this.emit("status", {
      platform: "twitch",
      status: "disconnected",
      mode: this.anonymous ? "anonymous" : "authenticated",
    });
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    if (this.anonymous) {
      throw new Error(
        "Cannot send messages in anonymous mode. Please log in to Twitch.",
      );
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Twitch IRC not connected");
    }
    this.ws.send(`PRIVMSG #${channelId} :${text}`);
  }

  // ============================================================
  // Private
  // ============================================================

  private connectWs(): void {
    const ws = new WebSocket(TWITCH_IRC_WS);
    this.ws = ws;

    ws.addEventListener("open", () => {
      console.log(
        `[Twitch] IRC WebSocket opened (${this.anonymous ? "anonymous" : "authenticated"})`,
      );

      // Request tags and commands capabilities
      ws.send(
        "CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership",
      );

      if (this.anonymous) {
        const username = `${TWITCH_ANON_PREFIX}${Math.floor(Math.random() * 900000 + 100000)}`;
        console.log(`[Twitch] Logging in anonymously as ${username}`);
        ws.send(`NICK ${username}`);
      } else {
        ws.send(`PASS oauth:${this.accessToken}`);
        ws.send(`NICK ${this.login ?? "unknown"}`);
      }
    });

    ws.addEventListener("message", (evt) => {
      const lines = (evt.data as string).split("\r\n");
      for (const line of lines) {
        if (!line) continue;
        const msg = parseIrcMessage(line);
        if (msg) this.handleIrcMessage(msg);
      }
    });

    ws.addEventListener("close", (evt) => {
      console.warn(`[Twitch] IRC disconnected: ${evt.code} ${evt.reason}`);
      this.ws = null;
      this.joined = false;

      this.emit("status", {
        platform: "twitch",
        status: "disconnected",
        mode: this.anonymous ? "anonymous" : "authenticated",
      });

      if (this.shouldReconnect) {
        console.log("[Twitch] Reconnecting in 5s...");
        this.reconnectTimeout = setTimeout(() => this.connectWs(), 5000);
      }
    });

    ws.addEventListener("error", (err) => {
      console.error("[Twitch] IRC WebSocket error:", err);
    });
  }

  private handleIrcMessage(msg: TwitchIrcMessage): void {
    switch (msg.command) {
      case "PING":
        this.ws?.send(`PONG :${msg.params[0] ?? "tmi.twitch.tv"}`);
        break;

      case "001":
      case "376":
        // Registered — join channel (guard against duplicate 001+376 both firing)
        if (!this.joined) {
          this.joined = true;
          this.ws?.send(`JOIN #${this.channelName}`);
        }
        break;

      case "JOIN":
        if (msg.params[0] === `#${this.channelName}`) {
          console.log(`[Twitch] Joined #${this.channelName}`);
          this.emit("status", {
            platform: "twitch",
            status: "connected",
            mode: this.anonymous ? "anonymous" : "authenticated",
          });
        }
        break;

      case "PRIVMSG":
        console.log(`[Twitch] PRIVMSG received in ${msg.params[0]}`);
        this.handlePrivMsg(msg);
        break;

      case "USERNOTICE":
        this.handleUserNotice(msg);
        break;

      case "NOTICE":
        console.log(`[Twitch] NOTICE: ${msg.params.join(" ")}`);
        break;

      case "RECONNECT":
        console.log("[Twitch] Server requested RECONNECT");
        this.ws?.close();
        break;
    }
  }

  private handlePrivMsg(msg: TwitchIrcMessage): void {
    const channel = msg.params[0] ?? "";
    const text = msg.params[1] ?? "";
    const tags = msg.tags;

    const userId = tags["user-id"] ?? "";
    const displayName =
      tags["display-name"] ?? msg.prefix?.split("!")[0] ?? "unknown";
    const color = tags["color"] || undefined;
    const msgId = tags["id"] ?? `${Date.now()}`;
    const tmiSent = tags["tmi-sent-ts"];
    const timestamp = tmiSent ? new Date(Number(tmiSent)) : new Date();

    // Parse emotes: "emote_id:start-end,start-end/emote_id2:..."
    const emotes: NormalizedChatMessage["emotes"] = [];
    const emotesTag = tags["emotes"];
    if (emotesTag) {
      for (const part of emotesTag.split("/")) {
        const [emoteId, posStr] = part.split(":");
        if (!emoteId || !posStr) continue;
        const positions = posStr.split(",").map((p) => {
          const [s, e] = p.split("-");
          return { start: Number(s), end: Number(e) };
        });
        emotes.push({
          id: emoteId,
          name: text.slice(
            positions[0]?.start ?? 0,
            (positions[0]?.end ?? 0) + 1,
          ),
          imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/1.0`,
          positions,
        });
      }
    }

    // Parse badges: "broadcaster/1,subscriber/6"
    const badges: Badge[] = [];
    const badgesTag = tags["badges"];
    if (badgesTag) {
      for (const b of badgesTag.split(",")) {
        const [badgeId, version] = b.split("/");
        if (badgeId) {
          const cacheKey = `${badgeId}/${version ?? "1"}`;
          badges.push({
            id: cacheKey,
            type: badgeId,
            text: badgeId,
            imageUrl: this.badgeCache.get(cacheKey),
          });
        }
      }
    }

    const normalized: NormalizedChatMessage = {
      id: msgId,
      platform: "twitch",
      channelId: channel.replace("#", ""),
      author: {
        id: userId,
        displayName,
        color,
        badges,
      },
      text,
      emotes,
      timestamp,
      type: "message",
    };

    this.emit("message", normalized);
  }

  private handleUserNotice(msg: TwitchIrcMessage): void {
    const tags = msg.tags;
    const msgType = tags["msg-id"] ?? "";
    const userId = tags["user-id"] ?? "";
    const displayName = tags["display-name"] ?? "unknown";
    const channelId = (msg.params[0] ?? "").replace("#", "");

    const user = {
      id: userId,
      displayName,
    };

    let event: NormalizedEvent | null = null;

    switch (msgType) {
      case "sub":
      case "resub": {
        event = {
          id: `twitch:${msgType}:${userId}:${Date.now()}`,
          platform: "twitch",
          type: msgType === "resub" ? "resub" : "sub",
          user,
          data: {
            channelId,
            months: tags["msg-param-cumulative-months"],
            subPlan: tags["msg-param-sub-plan"],
            systemMsg: tags["system-msg"]?.replace(/\\s/g, " "),
          },
          timestamp: new Date(),
        };
        break;
      }

      case "subgift": {
        event = {
          id: `twitch:subgift:${userId}:${Date.now()}`,
          platform: "twitch",
          type: "gift_sub",
          user,
          data: {
            channelId,
            recipientId: tags["msg-param-recipient-id"],
            recipientDisplayName: tags["msg-param-recipient-display-name"],
            subPlan: tags["msg-param-sub-plan"],
            systemMsg: tags["system-msg"]?.replace(/\\s/g, " "),
          },
          timestamp: new Date(),
        };
        break;
      }

      case "raid": {
        event = {
          id: `twitch:raid:${userId}:${Date.now()}`,
          platform: "twitch",
          type: "raid",
          user,
          data: {
            channelId,
            viewerCount: tags["msg-param-viewerCount"],
            systemMsg: tags["system-msg"]?.replace(/\\s/g, " "),
          },
          timestamp: new Date(),
        };
        break;
      }
    }

    if (event) {
      this.emit("event", event);
    }
  }

  private async fetchBadges(): Promise<void> {
    const url = new URL(`${BACKEND_URL}/api/twitch/badges`);
    if (this.channelName) {
      url.searchParams.set("broadcasterLogin", this.channelName);
    }

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`[Twitch] Badge fetch failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as TwitchBadgesResponse;
      this.badgeCache = new Map(Object.entries(data.badges));
      this.badgeCacheChannel = this.channelName;
      console.log(`[Twitch] Badge cache updated: ${this.badgeCache.size} entries`);
    } catch (err) {
      console.warn("[Twitch] Badge fetch error:", err);
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.badgeRefreshInterval) {
      clearInterval(this.badgeRefreshInterval);
      this.badgeRefreshInterval = null;
    }
  }
}
