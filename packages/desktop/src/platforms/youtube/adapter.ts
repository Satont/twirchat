/**
 * YouTube Platform Adapter
 *
 * Connects to YouTube Live Chat using the official gRPC streaming API:
 *   youtube.googleapis.com:443
 *   Service: V3DataLiveChatMessageService.StreamList
 *
 * Flow:
 *   1. Get the active liveChatId via REST (videos.list?part=liveStreamingDetails)
 *   2. Open a gRPC server-streaming call with the liveChatId + OAuth token
 *   3. Normalize incoming messages and emit them
 *
 * Auth: OAuth 2.0 access token stored in local AccountStore.
 * Docs: https://developers.google.com/youtube/v3/live/streaming-live-chat
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BasePlatformAdapter } from "../base-adapter";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  Badge,
} from "@twirchat/shared/types";
import { AccountStore } from "@desktop/store/account-store";

// ============================================================
// Proto loading
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, "stream_list.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const protoDescriptor = grpc.loadPackageDefinition(packageDef) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YouTubeLiveChatService = protoDescriptor?.youtube?.api?.v3
  ?.V3DataLiveChatMessageService as any;

const YOUTUBE_GRPC_ENDPOINT = "youtube.googleapis.com:443";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// ============================================================
// gRPC response types (loosely typed — proto2 optional fields)
// ============================================================

interface GrpcAuthorDetails {
  channelId?: string;
  displayName?: string;
  profileImageUrl?: string;
  isChatOwner?: boolean;
  isChatSponsor?: boolean;
  isChatModerator?: boolean;
}

interface GrpcSnippet {
  type?: string;
  publishedAt?: string;
  hasDisplayContent?: boolean;
  displayMessage?: string;
  textMessageDetails?: { messageText?: string };
  superChatDetails?: {
    amountMicros?: string;
    currency?: string;
    amountDisplayString?: string;
    userComment?: string;
    tier?: number;
  };
  newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
  memberMilestoneChatDetails?: {
    memberLevelName?: string;
    memberMonth?: number;
    userComment?: string;
  };
  membershipGiftingDetails?: {
    giftMembershipsCount?: number;
    giftMembershipsLevelName?: string;
  };
}

interface GrpcMessage {
  id?: string;
  snippet?: GrpcSnippet;
  authorDetails?: GrpcAuthorDetails;
}

interface GrpcResponse {
  nextPageToken?: string;
  offlineAt?: string;
  items?: GrpcMessage[];
}

// ============================================================
// YouTubeAdapter
// ============================================================

export class YouTubeAdapter extends BasePlatformAdapter {
  readonly platform = "youtube" as const;

  private grpcClient: ReturnType<
    typeof grpc.makeGenericClientConstructor
  > | null = null;
  private activeStream: grpc.ClientReadableStream<GrpcResponse> | null = null;
  private channelId = "";
  private liveChatId: string | null = null;
  private shouldReconnect = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

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
    });

    try {
      this.liveChatId = await this.fetchLiveChatId(channelIdOrHandle);
    } catch (err) {
      this.emit("status", {
        platform: "youtube",
        status: "error",
        mode: "authenticated",
        error: `Failed to get live chat ID: ${String(err)}`,
      });
      return;
    }

    this.startGrpcStream();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearTimers();
    this.activeStream?.cancel();
    this.activeStream = null;
    this.grpcClient = null;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "authenticated",
    });
  }

  async sendMessage(_channelId: string, _text: string): Promise<void> {
    // YouTube Live Chat message insertion requires REST API with OAuth.
    // Not yet implemented.
    throw new Error("YouTubeAdapter.sendMessage: not yet implemented");
  }

  // ============================================================
  // Private
  // ============================================================

  /**
   * Fetch the activeLiveChatId for the given channel or video ID.
   * Accepts:
   *   - A YouTube video ID (e.g. "dQw4w9WgXcQ")
   *   - A channel ID (e.g. "UCxxxxxx") — fetches the active broadcast
   */
  private async fetchLiveChatId(channelOrVideoId: string): Promise<string> {
    if (!this.accessToken) throw new Error("No access token");

    // Try as a video ID first
    const videoRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(channelOrVideoId)}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (videoRes.ok) {
      const body = (await videoRes.json()) as {
        items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
      };
      const chatId = body.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (chatId) {
        console.log(`[YouTube] Found liveChatId via video ID: ${chatId}`);
        return chatId;
      }
    }

    // Fallback: search for active live broadcast on the channel
    const searchRes = await fetch(
      `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelOrVideoId)}&eventType=live&type=video`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!searchRes.ok) {
      throw new Error(`YouTube search failed: ${searchRes.status}`);
    }

    const searchBody = (await searchRes.json()) as {
      items?: Array<{ id?: { videoId?: string } }>;
    };
    const videoId = searchBody.items?.[0]?.id?.videoId;
    if (!videoId)
      throw new Error(
        `No active live broadcast found for "${channelOrVideoId}"`,
      );

    const liveRes = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!liveRes.ok)
      throw new Error(`YouTube videos.list failed: ${liveRes.status}`);

    const liveBody = (await liveRes.json()) as {
      items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
    };
    const chatId = liveBody.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!chatId)
      throw new Error(`No active live chat found for video "${videoId}"`);

    console.log(`[YouTube] Found liveChatId via channel search: ${chatId}`);
    return chatId;
  }

  private startGrpcStream(): void {
    if (!this.liveChatId || !this.accessToken) return;

    const creds = grpc.credentials.createSsl();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const client = new YouTubeLiveChatService(YOUTUBE_GRPC_ENDPOINT, creds);
    this.grpcClient = client;

    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${this.accessToken}`);

    const request = {
      liveChatId: this.liveChatId,
      part: ["snippet", "authorDetails"],
      maxResults: 200,
    };

    console.log(
      `[YouTube] Starting gRPC stream for liveChatId=${this.liveChatId}`,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const stream = (client as any).StreamList(
      request,
      metadata,
    ) as grpc.ClientReadableStream<GrpcResponse>;
    this.activeStream = stream;

    stream.on("data", (response: GrpcResponse) => {
      for (const item of response.items ?? []) {
        this.handleGrpcMessage(item);
      }
      // If stream ended (offlineAt is set), close cleanly
      if (response.offlineAt) {
        console.log(
          `[YouTube] Stream ended — channel went offline at ${response.offlineAt}`,
        );
        stream.cancel();
      }
    });

    stream.on("error", (err: Error) => {
      const code = (err as grpc.ServiceError).code;
      if (code === grpc.status.CANCELLED) {
        // Manual cancel — do not reconnect
        return;
      }
      console.error("[YouTube] gRPC stream error:", err.message);
      this.scheduleReconnect();
    });

    stream.on("end", () => {
      console.log("[YouTube] gRPC stream ended");
      this.scheduleReconnect();
    });

    stream.on("status", (status: grpc.StatusObject) => {
      if (status.code === grpc.status.OK) {
        this.emit("status", {
          platform: "youtube",
          status: "connected",
          mode: "authenticated",
        });
      }
    });

    // Emit connected immediately (stream open = connected)
    this.emit("status", {
      platform: "youtube",
      status: "connected",
      mode: "authenticated",
    });
  }

  private handleGrpcMessage(item: GrpcMessage): void {
    const snippet = item.snippet;
    const author = item.authorDetails;
    if (!snippet || !author) return;
    if (!snippet.hasDisplayContent) return;

    const type = snippet.type ?? "";
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
      case "TEXT_MESSAGE_EVENT": {
        const text = snippet.textMessageDetails?.messageText ?? "";
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

      case "SUPER_CHAT_EVENT": {
        const sc = snippet.superChatDetails;
        const event: NormalizedEvent = {
          id: item.id ?? `yt:sc:${Date.now()}`,
          platform: "youtube",
          type: "superchat",
          user: { id: authorId, displayName, avatarUrl },
          data: {
            amountMicros: sc?.amountMicros,
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

      case "NEW_SPONSOR_EVENT": {
        const ns = snippet.newSponsorDetails;
        const event: NormalizedEvent = {
          id: item.id ?? `yt:member:${Date.now()}`,
          platform: "youtube",
          type: "membership",
          user: { id: authorId, displayName, avatarUrl },
          data: {
            levelName: ns?.memberLevelName,
            isUpgrade: ns?.isUpgrade,
          },
          timestamp,
        };
        this.emit("event", event);
        break;
      }

      case "MEMBER_MILESTONE_CHAT_EVENT": {
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

      case "MEMBERSHIP_GIFTING_EVENT": {
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
    if (!this.shouldReconnect) return;

    this.emit("status", {
      platform: "youtube",
      status: "disconnected",
      mode: "authenticated",
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
