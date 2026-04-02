/**
 * YouTube Platform Adapter
 *
 * Connects to YouTube Live Chat using the official gRPC streaming API via @grpc/grpc-js:
 *   youtube.googleapis.com:443
 *   Service: V3DataLiveChatMessageService.StreamList
 *
 * Flow:
 *   1. Get the active liveChatId via REST (videos.list?part=liveStreamingDetails)
 *   2. Open a server-streaming call with the liveChatId + OAuth token via gRPC
 *   3. Normalize incoming messages and emit them
 *
 * Auth: OAuth 2.0 access token stored in local AccountStore.
 */

import * as grpc from "@grpc/grpc-js";

import { BasePlatformAdapter } from "../base-adapter.js";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import { AccountStore } from "../../store/account-store.js";
import { refreshYouTubeToken } from "../../auth/youtube.js";
import { logger } from "@twirchat/shared/logger";
import { getBackendUrl } from "../../runtime-config.js";

import {
  V3DataLiveChatMessageServiceClient,
  LiveChatMessageListRequest,
  LiveChatMessageSnippet_TypeWrapper_Type,
  type LiveChatMessage,
  type LiveChatMessageListResponse,
} from "./gen/stream_list.js";

const log = logger("youtube");

const YOUTUBE_GRPC_ENDPOINT = "dns:///youtube.googleapis.com:443";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = "youtube" as const;

  private channelId = "";
  private liveChatId: string | null = null;
  private resolvedChannelId: string | null = null; // cached after first resolution
  private shouldReconnect = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY = 60000; // Max 60 seconds
  private readonly BASE_RECONNECT_DELAY = 5000; // Start with 5 seconds

  private accessToken: string | null = null;
  private accountId: string | null = null;
  private grpcClient: V3DataLiveChatMessageServiceClient | null = null;
  private activeStream: grpc.ClientReadableStream<LiveChatMessageListResponse> | null = null;
  private nextPageToken: string | undefined = undefined;
  private isPolling = false;

  async connect(channelIdOrHandle: string): Promise<void> {
    this.channelId = channelIdOrHandle;
    this.shouldReconnect = true;
    this.resolvedChannelId = null; // reset cache on fresh connect

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

    // Check if token needs refresh (expires in less than 5 minutes or already expired)
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt && tokens.expiresAt < now + 300) {
      log.info("[YouTube] Token expired or expiring soon, refreshing...");
      try {
        this.accessToken = await refreshYouTubeToken(account.id);
        log.info("[YouTube] Token refreshed successfully");
      } catch (err) {
        log.error("[YouTube] Failed to refresh token", { error: String(err) });
        this.emit("status", {
          platform: "youtube",
          status: "error",
          mode: "authenticated",
          error: "Failed to refresh access token. Please re-authenticate.",
        });
        return;
      }
    }

    this.emit("status", {
      platform: "youtube",
      status: "connecting",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    await this.tryFetchLiveChatAndConnect();
  }

  private async tryFetchLiveChatAndConnect(): Promise<void> {
    if (!this.shouldReconnect) return;

    try {
      // If we already resolved the channel ID, skip straight to live search
      // (avoids re-spending quota on handle resolution on every retry)
      if (this.resolvedChannelId) {
        log.info(`[YouTube] Retrying with cached channelId: ${this.resolvedChannelId}`);
        this.liveChatId = await this.fetchLiveChatForChannel(this.resolvedChannelId);
      } else {
        this.liveChatId = await this.fetchLiveChatId(this.channelId);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Check if it's "no live broadcast" error - we should retry
      const isNoLiveBroadcast = errorMessage.includes("No active live broadcast") ||
                                 errorMessage.includes("no live broadcast");
      
      if (isNoLiveBroadcast && this.shouldReconnect) {
        log.info(`[YouTube] No live broadcast yet, will retry...`);
        this.emit("status", {
          platform: "youtube",
          status: "connecting",
          mode: "authenticated",
          error: `Waiting for live broadcast to start...`,
          channelLogin: this.channelId,
        });
        
        // Schedule retry with exponential backoff
        this.scheduleLiveChatRetry();
        return;
      }
      
      log.error(`Failed to get live chat ID`, { error: errorMessage });
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "authenticated",
        error: `Failed to get live chat ID: ${errorMessage}`,
        channelLogin: this.channelId,
      });
      return;
    }

    // Reset polling state
    this.nextPageToken = undefined;
    this.isPolling = false;
    this.reconnectAttempts = 0;
    this.liveChatRetryAttempts = 0; // Reset retry counter on successful connection
    
    this.emit("status", {
      platform: "youtube",
      status: "connected",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    this.startGrpcStream();
  }

  private liveChatRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private liveChatRetryAttempts = 0;
  private readonly MAX_LIVECHAT_RETRY_DELAY = 300000; // Max 5 minutes — search costs 100 quota units
  private readonly BASE_LIVECHAT_RETRY_DELAY = 10000; // Start with 10 seconds

  private scheduleLiveChatRetry(): void {
    if (!this.shouldReconnect) return;
    
    // Clean up any existing retry timeout
    if (this.liveChatRetryTimeout) {
      clearTimeout(this.liveChatRetryTimeout);
    }

    // Calculate exponential backoff with jitter
    const baseDelay = Math.min(
      this.BASE_LIVECHAT_RETRY_DELAY * Math.pow(2, this.liveChatRetryAttempts),
      this.MAX_LIVECHAT_RETRY_DELAY,
    );
    const jitter = Math.random() * 2000; // Add up to 2 seconds of random jitter
    const delay = baseDelay + jitter;

    this.liveChatRetryAttempts++;
    log.info(
      `[YouTube] Retrying live chat lookup in ${Math.round(delay / 1000)}s... (attempt ${this.liveChatRetryAttempts})`,
    );

    this.liveChatRetryTimeout = setTimeout(() => {
      this.tryFetchLiveChatAndConnect();
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearTimers();

    // Cancel active stream
    if (this.activeStream) {
      this.activeStream.cancel();
      this.activeStream = null;
    }

    // Close gRPC client
    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }

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

    const res = await this.fetchWithAuth(`${YOUTUBE_API_BASE}/liveChat/messages?part=snippet`, {
      method: "POST",
      headers: {
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

    log.info(`[YouTube] Message sent: ${text.slice(0, 50)}...`);
  }

  // ============================================================
  // Private
  // ============================================================

  private async refreshTokenIfNeeded(): Promise<boolean> {
    if (!this.accountId) return false;

    const tokens = AccountStore.getTokens(this.accountId);
    if (!tokens?.refreshToken) return false;

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt && tokens.expiresAt < now + 300) {
      log.info("[YouTube] Token expired or expiring soon, refreshing...");
      try {
        this.accessToken = await refreshYouTubeToken(this.accountId);
        log.info("[YouTube] Token refreshed successfully");
        return true;
      } catch (err) {
        log.error("[YouTube] Failed to refresh token", { error: String(err) });
        return false;
      }
    }
    return false;
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) throw new Error("No access token");

    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    // If 401, try to refresh token and retry once
    if (res.status === 401 && this.accountId) {
      log.info("[YouTube] Got 401, attempting token refresh...");
      const refreshed = await this.refreshTokenIfNeeded();
      if (refreshed) {
        // Retry the request with new token
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
      }
    }

    return res;
  }

  private async fetchLiveChatId(channelOrVideoId: string): Promise<string> {
    if (!this.accessToken) throw new Error("No access token");

    // Strip @ prefix, trim whitespace
    const cleanInput = channelOrVideoId.replace(/^@/, "").trim();
    log.info(
      `[YouTube] Looking for live chat, input="${channelOrVideoId}", clean="${cleanInput}"`,
    );

    // If it already looks like a UC channel ID, go straight to live search
    if (/^UC/i.test(cleanInput)) {
      log.info(`[YouTube] Input looks like a channel ID: ${cleanInput}`);
      this.resolvedChannelId = cleanInput;
      return this.fetchLiveChatForChannel(cleanInput);
    }

    // Try as a video ID — liveChatId can be fetched directly, costs 1 quota unit
    log.info(`[YouTube] Trying as video ID: ${cleanInput}`);
    const videoRes = await this.fetchWithAuth(
      `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(cleanInput)}`,
    );
    if (videoRes.ok) {
      const body = (await videoRes.json()) as {
        items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
      };
      const chatId = body.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (chatId) {
        log.info(`[YouTube] Found liveChatId via video ID: ${chatId}`);
        return chatId;
      }
      if (body.items && body.items.length > 0) {
        log.info(`[YouTube] Video found but no active live chat`);
      }
    } else {
      log.info(`[YouTube] Video lookup failed: ${videoRes.status}`);
    }

    // Resolve handle → channel ID via backend (cached in DB, uses API key, no OAuth quota)
    log.info(`[YouTube] Resolving handle via backend: ${cleanInput}`);
    const channelId = await this.resolveChannelIdViaBackend(cleanInput);
    if (channelId) {
      this.resolvedChannelId = channelId;
      return this.fetchLiveChatForChannel(channelId);
    }

    throw new Error(`Could not resolve "${cleanInput}" to a YouTube channel or live video`);
  }

  /**
   * Calls the backend /api/youtube/resolve endpoint to get a stable channel ID.
   * The backend caches results in Postgres for 30 days and uses a server-side
   * API key, so this does NOT consume the user's OAuth quota.
   */
  private async resolveChannelIdViaBackend(handle: string): Promise<string | null> {
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

  /** Given a confirmed channel ID, find its active live chat ID. */
  private async fetchLiveChatForChannel(channelId: string): Promise<string> {
    log.info(`[YouTube] Searching for live broadcast on channel: ${channelId}`);
    const searchRes = await this.fetchWithAuth(
      `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video`,
    );
    if (!searchRes.ok) {
      const body = await searchRes.text();
      throw new Error(`YouTube live search failed: ${searchRes.status} — ${body}`);
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
        `No active live broadcast found for channel "${channelId}". Make sure the stream is live.`,
      );
    }

    log.info(`[YouTube] Found live video: ${videoId} (${videoTitle})`);

    const liveRes = await this.fetchWithAuth(
      `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
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

    log.info(`[YouTube] Found liveChatId: ${chatId}`);
    return chatId;
  }

  private startGrpcStream(): void {
    if (!this.liveChatId || !this.accessToken || this.isPolling) return;

    this.isPolling = true;
    this.pollMessages();
  }

  private async pollMessages(): Promise<void> {
    if (!this.liveChatId || !this.accessToken || !this.shouldReconnect) {
      this.isPolling = false;
      return;
    }

    // Create gRPC client if not exists
    if (!this.grpcClient) {
      const sslCreds = grpc.credentials.createSsl();
      this.grpcClient = new V3DataLiveChatMessageServiceClient(
        YOUTUBE_GRPC_ENDPOINT,
        sslCreds,
        {
          "grpc.max_receive_message_length": 16 * 1024 * 1024,
          "grpc.max_send_message_length": 16 * 1024 * 1024,
        },
      );
    }

    const metadata = new grpc.Metadata();
    metadata.add("authorization", `Bearer ${this.accessToken}`);
    metadata.add("x-goog-api-client", "twirchat/1.0.0");

    const request: LiveChatMessageListRequest = {
      liveChatId: this.liveChatId,
      part: ["snippet", "authorDetails"],
      maxResults: 200,
      pageToken: this.nextPageToken,
    };

    try {
      const nextToken = await new Promise<string | undefined>((resolve, reject) => {
        let lastToken: string | undefined = undefined;
        
        this.activeStream = this.grpcClient!.streamList(request, metadata);

        this.activeStream!.on("data", (response: LiveChatMessageListResponse) => {
          this.reconnectAttempts = 0;
          
          if (response.offlineAt) {
            log.info(`[YouTube] Stream went offline at ${response.offlineAt}`);
            this.activeStream?.cancel();
            resolve(undefined);
            return;
          }

          for (const item of response.items ?? []) {
            this.handleMessage(item);
          }

          // Save the next page token from the response
          if (response.nextPageToken) {
            lastToken = response.nextPageToken;
          }
        });

        this.activeStream!.on("error", (err: grpc.ServiceError) => {
          if (err.code === grpc.status.CANCELLED) {
            resolve(lastToken);
            return;
          }
          reject(err);
        });

        this.activeStream!.on("end", () => {
          resolve(lastToken);
        });
      });

      this.nextPageToken = nextToken;

      // If we got a next page token, immediately poll again
      // Otherwise, wait a bit before polling
      if (this.nextPageToken && this.shouldReconnect) {
        // Small delay to prevent hammering the API
        await new Promise(resolve => setTimeout(resolve, 100));
        this.pollMessages();
      } else if (this.shouldReconnect) {
        // No more messages, wait before polling again
        log.debug("[YouTube] No more messages, waiting before next poll");
        await new Promise(resolve => setTimeout(resolve, 5000));
        this.pollMessages();
      }
    } catch (err) {
      log.error("[YouTube] gRPC stream error", { error: err instanceof Error ? err.message : String(err) });
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
        const text =
          snippet.textMessageDetails?.messageText ?? snippet.displayMessage ?? "";
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
        const sc = snippet.superChatDetails;

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
        const ns = snippet.newSponsorDetails;

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
        const mm = snippet.memberMilestoneChatDetails;

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
        const mg = snippet.membershipGiftingDetails;

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
    if (!this.shouldReconnect || this.isPolling) return;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "authenticated",
      channelLogin: this.channelId,
    });

    // Clean up current client
    if (this.activeStream) {
      this.activeStream.cancel();
      this.activeStream = null;
    }
    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }

    this.isPolling = false;

    // Calculate exponential backoff with jitter
    const baseDelay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY,
    );
    const jitter = Math.random() * 1000; // Add up to 1 second of random jitter
    const delay = baseDelay + jitter;

    this.reconnectAttempts++;
    log.info(
      `[YouTube] Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimeout = setTimeout(() => {
      if (this.liveChatId && this.accessToken) {
        this.startGrpcStream();
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.liveChatRetryTimeout) {
      clearTimeout(this.liveChatRetryTimeout);
      this.liveChatRetryTimeout = null;
    }
  }
}
