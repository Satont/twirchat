/**
 * TwirChat Electrobun RPC Schema
 *
 * Defines the typed RPC contract between the Bun main process and the
 * webview (Vue) side.  Import this type in both src/bun/index.ts and
 * src/views/main/index.ts.
 *
 * Convention:
 *   bun.requests   — requests that the WEBVIEW sends and BUN handles
 *   bun.messages   — fire-and-forget messages that the WEBVIEW sends to BUN
 *   webview.requests  — (currently none)
 *   webview.messages  — messages that BUN pushes to the WEBVIEW
 */

import type { ElectrobunRPCSchema, RPCSchema } from "electrobun/bun";
import type {
  NormalizedChatMessage,
  NormalizedEvent,
  PlatformStatusInfo,
  Account,
  AppSettings,
  Platform,
} from "@twirchat/shared/types";
import type {
  StreamStatusResponse,
  UpdateStreamRequest,
  UpdateStreamResponse,
  SearchCategoriesResponse,
} from "@twirchat/shared/protocol";

// ----------------------------------------------------------------
// Bun-side schema (what the webview calls into)
// ----------------------------------------------------------------

type BunRequests = {
  /** Return all stored accounts */
  getAccounts: { params: void; response: Account[] };
  /** Return current app settings */
  getSettings: { params: void; response: AppSettings };
  /** Save app settings */
  saveSettings: { params: AppSettings; response: void };
  /** Return all persisted joined channels grouped by platform */
  getChannels: { params: void; response: Partial<Record<Platform, string[]>> };
  /** Start OAuth flow for a platform */
  authStart: { params: { platform: Platform }; response: void };
  /** Log out from a platform */
  authLogout: { params: { platform: Platform }; response: void };
  /** Join a channel for live chat */
  joinChannel: {
    params: { platform: Platform; channelSlug: string };
    response: void;
  };
  /** Leave a channel */
  leaveChannel: {
    params: { platform: Platform; channelSlug: string };
    response: void;
  };
  /** Send a chat message */
  sendMessage: {
    params: { platform: Platform; channelId: string; text: string };
    response: void;
  };
  /** Get current stream status (title, category, viewers, isLive) */
  getStreamStatus: {
    params: { platform: "twitch" | "kick"; channelId: string };
    response: StreamStatusResponse;
  };
  /** Update stream title and/or category */
  updateStream: {
    params: Omit<UpdateStreamRequest, never>;
    response: UpdateStreamResponse;
  };
  /** Search for game/category suggestions */
  searchCategories: {
    params: { platform: "twitch" | "kick"; query: string };
    response: SearchCategoriesResponse;
  };
};

type BunMessages = Record<never, unknown>;

// ----------------------------------------------------------------
// Webview-side schema (what Bun pushes into the webview)
// ----------------------------------------------------------------

type WebviewRequests = Record<never, unknown>;

type WebviewMessages = {
  /** A new chat message arrived */
  chat_message: NormalizedChatMessage;
  /** A follow/sub/raid/… event arrived */
  chat_event: NormalizedEvent;
  /** Platform connection status changed */
  platform_status: PlatformStatusInfo;
  /** OAuth URL ready — open in browser */
  auth_url: { platform: Platform; url: string };
  /** OAuth completed successfully */
  auth_success: { platform: Platform; username: string; displayName: string };
  /** OAuth failed */
  auth_error: { platform: Platform; error: string };
};

// ----------------------------------------------------------------
// Combined schema exported for use on both sides
// ----------------------------------------------------------------

export type TwirChatRPCSchema = {
  bun: RPCSchema<{ requests: BunRequests; messages: BunMessages }>;
  webview: RPCSchema<{ requests: WebviewRequests; messages: WebviewMessages }>;
};

// ----------------------------------------------------------------
// Explicit sender type — used on the bun side to push messages
// into the webview without fighting TypeScript's generic inference
// ----------------------------------------------------------------

export type WebviewSender = {
  [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void;
};

// Satisfy ElectrobunRPCSchema constraint (structural)
export type { ElectrobunRPCSchema };
