/**
 * YouTube Platform Adapter
 *
 * Connects to YouTube Live Chat using the official gRPC streaming API via ConnectRPC:
 *   youtube.googleapis.com:443
 *   Service: V3DataLiveChatMessageService.StreamList
 *
 * Flow:
 *   1. Get the active liveChatId via REST (videos.list?part=liveStreamingDetails)
 *   2. Open a server-streaming call with the liveChatId + OAuth token via ConnectRPC
 *   3. Normalize incoming messages and emit them
 *
 * Auth: OAuth 2.0 access token stored in local AccountStore.
 */

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { BasePlatformAdapter } from "../base-adapter.js";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import { AccountStore } from "../../store/account-store.js";

import {
  V3DataLiveChatMessageService,
  LiveChatMessageSnippet_TypeWrapper_Type,
  type LiveChatMessage,
} from "./gen/stream_list_pb.js";

const YOUTUBE_GRPC_ENDPOINT = "https://youtube.googleapis.com";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = "youtube" as const;

  private channelId = "";
  private liveChatId: string | null = null;
  private shouldReconnect = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  private accessToken: string | null = null;
  private accountId: string | null = null;

  async connect(channelIdOrHandle: string): Promise<void> {
    this.channelId = channelIdOrHandle;
    this.shouldReconnect = true;

    const account = AccountStore.findByPlatform("youtube");
    if (!account) {
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "authenticated",
        error: "No YouTube account. Please log in first.",
      });
      return;
    }

    const tokens = AccountStore.getTokens(account.id);
    if (!tokens) {
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "authenticated",
        error: "No YouTube tokens found.",
      });
      return;
    }

    this.accountId = account.id;
    this.accessToken = tokens.accessToken;

    this.emit("status", {
      platform: "youtube",
      status: "connecting",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    try {
      this.liveChatId = await this.fetchLiveChatId(channelIdOrHandle);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[YouTube] Failed to get live chat ID:`, err);
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "authenticated",
        error: `Failed to get live chat ID: ${errorMessage}`,
        channelLogin: this.channelId,
      });
      return;
    }

    this.startGrpcStream();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearTimers();
    this.abortController?.abort();
    this.abortController = null;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "authenticated",
    });
  }

  async sendMessage(_channelId: string, text: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error("YouTubeAdapter.sendMessage: not authenticated");
    }
    if (!this.liveChatId) {
      throw new Error("YouTubeAdapter.sendMessage: no active live chat");
    }

    const res = await fetch(`${YOUTUBE_API_BASE}/liveChat/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          liveChatId: this.liveChatId,
          type: "textMessageEvent",
          textMessageDetails: {
            messageText: text,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube sendMessage failed: ${res.status} ${body}`);
    }

    console.log(`[YouTube] Message sent: ${text.slice(0, 50)}...`);
  }

  // ============================================================
  // Private
  // ============================================================

  private async fetchLiveChatId(channelOrVideoId: string): Promise<string> {
    if (!this.accessToken) throw new Error("No access token");

    // Clean up the input - remove @ prefix if present
    const cleanInput = channelOrVideoId.replace(/^@/, "");
    console.log(
      `[YouTube] Looking for live chat, input="${channelOrVideoId}", clean="${cleanInput}"`,
    );

    // Try as a video ID first (starts with characters other than UC)
    if (!cleanInput.startsWith("UC")) {
      console.log(`[YouTube] Trying as video ID: ${cleanInput}`);
      const videoRes = await fetch(
        `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(cleanInput)}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );

      if (videoRes.ok) {
        const body = (await videoRes.json()) as {
          items?: Array<{
            liveStreamingDetails?: { activeLiveChatId?: string };
          }>;
        };
        const chatId = body.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
        if (chatId) {
          console.log(`[YouTube] Found liveChatId via video ID: ${chatId}`);
          return chatId;
        }
        console.log(`[YouTube] Video found but no active live chat`);
      } else {
        console.log(`[YouTube] Video lookup failed: ${videoRes.status}`);
      }
    }

    // Try to resolve handle/username to channel ID
    let channelId = cleanInput;
    if (!cleanInput.startsWith("UC")) {
      console.log(`[YouTube] Resolving handle/username: ${cleanInput}`);
      // Try as a handle (custom URL) - search for the channel
      const searchRes = await fetch(
        `${YOUTUBE_API_BASE}/search?part=snippet&q=${encodeURIComponent(cleanInput)}&type=channel&maxResults=1`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );

      if (!searchRes.ok) {
        console.log(`[YouTube] Channel search failed: ${searchRes.status}`);
        throw new Error(`YouTube channel search failed: ${searchRes.status}`);
      }

      const searchBody = (await searchRes.json()) as {
        items?: Array<{
          id?: { channelId?: string };
          snippet?: { title?: string };
        }>;
      };

      const foundChannelId = searchBody.items?.[0]?.id?.channelId;
      const channelTitle = searchBody.items?.[0]?.snippet?.title;

      if (!foundChannelId) {
        throw new Error(`No channel found for "${cleanInput}"`);
      }

      channelId = foundChannelId;
      console.log(
        `[YouTube] Resolved to channel: ${channelId} (${channelTitle})`,
      );
    }

    // Search for active live broadcast on the channel
    console.log(
      `[YouTube] Searching for live broadcast on channel: ${channelId}`,
    );
    const searchRes = await fetch(
      `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!searchRes.ok) {
      throw new Error(`YouTube live search failed: ${searchRes.status}`);
    }

    const searchBody = (await searchRes.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string };
      }>;
    };
    const videoId = searchBody.items?.[0]?.id?.videoId;
    const videoTitle = searchBody.items?.[0]?.snippet?.title;

    if (!videoId) {
      throw new Error(
        `No active live broadcast found for channel "${channelId}". Make sure you're currently streaming.`,
      );
    }

    console.log(`[YouTube] Found live video: ${videoId} (${videoTitle})`);

    const liveRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!liveRes.ok) {
      throw new Error(`YouTube videos.list failed: ${liveRes.status}`);
    }

    const liveBody = (await liveRes.json()) as {
      items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
    };
    const chatId = liveBody.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!chatId) {
      throw new Error(`No active live chat found for video "${videoId}"`);
    }

    console.log(`[YouTube] Found liveChatId: ${chatId}`);
    return chatId;
  }

  private async startGrpcStream(): Promise<void> {
    if (!this.liveChatId || !this.accessToken) return;

    const transport = createGrpcTransport({
      baseUrl: YOUTUBE_GRPC_ENDPOINT,
      interceptors: [
        (next) => (req) => {
          req.header.set("authorization", `Bearer ${this.accessToken}`);
          req.header.set("x-goog-api-client", "twirchat/1.0.0");
          return next(req);
        },
      ],
      httpVersion: "2",
    });

    const client = createClient(V3DataLiveChatMessageService, transport);

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    console.log(
      `[YouTube] Starting gRPC stream for liveChatId=${this.liveChatId}`,
    );

    this.emit("status", {
      platform: "youtube",
      status: "connected",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    try {
      const stream = client.streamList(
        {
          liveChatId: this.liveChatId,
          part: ["snippet", "authorDetails"],
          maxResults: 200,
        },
        { signal },
      );

      for await (const response of stream) {
        if (response.offlineAt) {
          console.log(
            `[YouTube] Stream ended — channel went offline at ${response.offlineAt}`,
          );
          break;
        }
        for (const item of response.items ?? []) {
          this.handleMessage(item);
        }
      }

      // Stream ended cleanly
      this.scheduleReconnect();
    } catch (err: unknown) {
      if (signal.aborted) {
        // Manual disconnect — do not reconnect
        return;
      }
      console.error("[YouTube] gRPC stream error:", err);
      if (err instanceof Error) {
        console.error("[YouTube] Error details:", err.message);
        console.error("[YouTube] Error stack:", err.stack);
      }
      this.scheduleReconnect();
    }
  }

  private handleMessage(item: LiveChatMessage): void {
    const snippet = item.snippet;
    const author = item.authorDetails;
    if (!snippet || !author) return;
    if (!snippet.hasDisplayContent) return;

    const type =
      snippet.type ?? LiveChatMessageSnippet_TypeWrapper_Type.INVALID_TYPE;
    const timestamp = snippet.publishedAt
      ? new Date(snippet.publishedAt)
      : new Date();
    const authorId = author.channelId ?? "";
    const displayName = author.displayName ?? "unknown";
    const avatarUrl = author.profileImageUrl ?? undefined;

    const badges: Badge[] = [];
    if (author.isChatOwner)
      badges.push({ id: "owner", type: "broadcaster", text: "Owner" });
    if (author.isChatModerator)
      badges.push({ id: "mod", type: "moderator", text: "Moderator" });
    if (author.isChatSponsor)
      badges.push({ id: "sponsor", type: "subscriber", text: "Member" });

    switch (type) {
      case LiveChatMessageSnippet_TypeWrapper_Type.TEXT_MESSAGE_EVENT: {
        const content = snippet.displayedContent;
        const text =
          (content?.case === "textMessageDetails"
            ? (content.value as { messageText?: string }).messageText
            : undefined) ??
          snippet.displayMessage ??
          "";
        if (!text) return;

        const normalized: NormalizedChatMessage = {
          id: item.id ?? `yt:${Date.now()}`,
          platform: "youtube",
          channelId: this.channelId,
          author: { id: authorId, displayName, avatarUrl, badges },
          text,
          emotes: [],
          timestamp,
          type: "message",
        };
        this.emit("message", normalized);
        break;
      }

      case LiveChatMessageSnippet_TypeWrapper_Type.SUPER_CHAT_EVENT: {
        const content = snippet.displayedContent;
        const sc =
          content?.case === "superChatDetails"
            ? (content.value as {
                amountMicros?: bigint;
                currency?: string;
                amountDisplayString?: string;
                userComment?: string;
                tier?: number;
              })
            : undefined;

        const event: NormalizedEvent = {
          id: item.id ?? `yt:sc:${Date.now()}`,
          platform: "youtube",
          type: "superchat",
          user: { id: authorId, displayName, avatarUrl },
          data: {
            amountMicros: sc?.amountMicros?.toString(),
            currency: sc?.currency,
            amountDisplayString: sc?.amountDisplayString,
            comment: sc?.userComment,
            tier: sc?.tier,
          },
          timestamp,
        };
        this.emit("event", event);
        break;
      }

      case LiveChatMessageSnippet_TypeWrapper_Type.NEW_SPONSOR_EVENT: {
        const content = snippet.displayedContent;
        const ns =
          content?.case === "newSponsorDetails"
            ? (content.value as {
                memberLevelName?: string;
                isUpgrade?: boolean;
              })
            : undefined;

        const event: NormalizedEvent = {
          id: item.id ?? `yt:member:${Date.now()}`,
          platform: "youtube",
          type: "membership",
          user: { id: authorId, displayName, avatarUrl },
          data: { levelName: ns?.memberLevelName, isUpgrade: ns?.isUpgrade },
          timestamp,
        };
        this.emit("event", event);
        break;
      }

      case LiveChatMessageSnippet_TypeWrapper_Type.MEMBER_MILESTONE_CHAT_EVENT: {
        const content = snippet.displayedContent;
        const mm =
          content?.case === "memberMilestoneChatDetails"
            ? (content.value as {
                memberLevelName?: string;
                memberMonth?: number;
                userComment?: string;
              })
            : undefined;

        const event: NormalizedEvent = {
          id: item.id ?? `yt:milestone:${Date.now()}`,
          platform: "youtube",
          type: "membership",
          user: { id: authorId, displayName, avatarUrl },
          data: {
            levelName: mm?.memberLevelName,
            months: mm?.memberMonth,
            comment: mm?.userComment,
          },
          timestamp,
        };
        this.emit("event", event);
        break;
      }

      case LiveChatMessageSnippet_TypeWrapper_Type.MEMBERSHIP_GIFTING_EVENT: {
        const content = snippet.displayedContent;
        const mg =
          content?.case === "membershipGiftingDetails"
            ? (content.value as {
                giftMembershipsCount?: number;
                giftMembershipsLevelName?: string;
              })
            : undefined;

        const event: NormalizedEvent = {
          id: item.id ?? `yt:giftmember:${Date.now()}`,
          platform: "youtube",
          type: "gift_sub",
          user: { id: authorId, displayName, avatarUrl },
          data: {
            giftCount: mg?.giftMembershipsCount,
            levelName: mg?.giftMembershipsLevelName,
          },
          timestamp,
        };
        this.emit("event", event);
        break;
      }

      // Silently ignore: TOMBSTONE, CHAT_ENDED_EVENT, POLL_EVENT, etc.
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    console.log("[YouTube] Reconnecting in 10s...");
    this.reconnectTimeout = setTimeout(() => {
      if (this.liveChatId && this.accessToken) {
        this.startGrpcStream();
      }
    }, 10_000);
  }

  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}
