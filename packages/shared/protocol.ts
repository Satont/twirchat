import type { Platform } from "./types";

/**
 * Протокол WebSocket между backend и desktop-приложением.
 *
 * Desktop подключается к backend с заголовком:
 *   X-Client-Secret: <uuid>
 *
 * Backend пушит сообщения в desktop в виде JSON-объектов BackendToDesktopMessage.
 * Desktop отправляет команды в виде DesktopToBackendMessage.
 *
 * NOTE: chat_message / chat_event / platform_status are no longer forwarded
 * through the backend — platform adapters run directly in the Bun process.
 * channel_join / channel_leave / send_message are handled locally by adapters.
 */

export interface SevenTVEmote {
  id: string;
  alias: string;
  name: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  imageUrl: string;
}

// ============================================================
// Backend → Desktop
// ============================================================

export type BackendToDesktopMessage =
  | { type: "auth_url"; platform: Platform; url: string }
  | { type: "auth_success"; platform: Platform; username: string; displayName: string }
  | { type: "auth_error"; platform: Platform; error: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | { type: "chat_message"; data: unknown }
  | { type: "chat_event"; data: unknown }
  | { type: "platform_status"; platform: Platform; status: "connected" | "disconnected" | "error"; error?: string }
  // 7TV events
  | { type: "seventv_emote_set"; platform: Platform; channelId: string; emotes: SevenTVEmote[] }
  | { type: "seventv_emote_added"; platform: Platform; channelId: string; emote: SevenTVEmote }
  | { type: "seventv_emote_removed"; platform: Platform; channelId: string; emoteId: string }
  | { type: "seventv_emote_updated"; platform: Platform; channelId: string; emoteId: string; alias: string }
  // 7TV system notification
  | { type: "seventv_system_message"; platform: Platform; channelId: string; action: "added" | "removed" | "updated"; emote: SevenTVEmote; oldAlias?: string }
  | { type: "seventv_system_message"; platform: Platform; channelId: string; action: "set_changed"; setName: string };

// ============================================================
// Desktop → Backend
// ============================================================

export type DesktopToBackendMessage =
  | { type: "ping" }
  | { type: "auth_start"; platform: Exclude<Platform, "twitch"> }
  | { type: "auth_start_twitch"; codeChallenge: string; state: string }
  | { type: "auth_logout"; platform: Platform }
  | { type: "send_message"; platform: Platform; channel: string; message: string }
  | { type: "channel_join"; platform: Platform; channel: string }
  | { type: "channel_leave"; platform: Platform; channel: string }
  // 7TV commands
  | { type: "seventv_subscribe"; platform: Platform; channelId: string }
  | { type: "seventv_unsubscribe"; platform: Platform; channelId: string }
  // Client reconnect - send list of subscribed channels
  | { type: "seventv_resubscribe"; subscriptions: Array<{ platform: Platform; channelId: string }> };

// ============================================================
// HTTP API — запросы от desktop к backend
// ============================================================

/** POST /api/auth/kick/start — получить URL для OAuth */
export interface AuthStartRequest {
  clientSecret: string;
}

export interface AuthStartResponse {
  url: string;
}

/**
 * POST /api/auth/twitch/start
 * Desktop отправляет PKCE codeChallenge + state + redirectUri, backend формирует authUrl
 */
export interface TwitchBuildUrlRequest {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}

export interface TwitchBuildUrlResponse {
  url: string;
}

/**
 * POST /api/auth/twitch/exchange
 * Desktop получил code из callback, просит backend обменять на токены
 */
export interface TwitchExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface TwitchExchangeResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
}

/**
 * POST /api/auth/kick/start
 * Desktop отправляет PKCE codeChallenge + state, backend формирует authUrl
 */
export interface KickBuildUrlRequest {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}

export interface KickBuildUrlResponse {
  url: string;
}

/**
 * POST /api/auth/kick/exchange
 * Desktop получил code из callback, просит backend обменять на токены
 */
export interface KickExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface KickExchangeResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
}

/**
 * POST /api/auth/kick/refresh
 * Desktop просит backend обновить Kick токен
 */
export interface KickRefreshRequest {
  refreshToken: string;
}

export interface KickRefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * POST /api/auth/twitch/refresh
 * Desktop просит backend обновить токен
 */
export interface TwitchRefreshRequest {
  refreshToken: string;
}

export interface TwitchRefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * POST /api/auth/youtube/start
 * Desktop отправляет PKCE codeChallenge + state, backend формирует authUrl
 */
export interface YouTubeBuildUrlRequest {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}

export interface YouTubeBuildUrlResponse {
  url: string;
}

/**
 * POST /api/auth/youtube/exchange
 * Desktop получил code из callback, просит backend обменять на токены
 */
export interface YouTubeExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface YouTubeExchangeResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
}

/**
 * POST /api/auth/youtube/refresh
 * Desktop просит backend обновить YouTube токен
 */
export interface YouTubeRefreshRequest {
  refreshToken: string;
}

export interface YouTubeRefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

// ============================================================
// HTTP API — stream status, update stream, search categories
// ============================================================

/** GET /api/stream-status?platform=twitch|kick&channelId=... */
export interface StreamStatusResponse {
  isLive: boolean;
  title: string;
  categoryId?: string;
  categoryName?: string;
  viewerCount?: number;
}

/**
 * GET /api/channels-status
 * Bulk stream status for all active channels, fetched in parallel.
 *
 * Request body (JSON): { channels: ChannelStatusRequest[] }
 * Optionally pass userAccessToken per-channel to use authenticated Helix calls.
 */
export interface ChannelStatusRequest {
  platform: "twitch" | "kick";
  /** For Twitch: the channel login (e.g. "ninja"). For Kick: the channel slug. */
  channelLogin: string;
  /** Optional user access token — if provided, backend uses it instead of app token */
  userAccessToken?: string;
}

export interface ChannelStatus {
  platform: "twitch" | "kick";
  channelLogin: string;
  isLive: boolean;
  title: string;
  categoryName?: string;
  viewerCount?: number;
}

export interface ChannelsStatusResponse {
  channels: ChannelStatus[];
}

/** POST /api/update-stream */
export interface UpdateStreamRequest {
  platform: "twitch" | "kick";
  channelId: string;
  /** User access token from the desktop's SQLite */
  userAccessToken: string;
  title?: string;
  categoryId?: string;
}

export interface UpdateStreamResponse {
  ok: boolean;
}

/** GET /api/search-categories?platform=twitch|kick&query=... */
export interface CategorySearchResult {
  id: string;
  name: string;
  thumbnailUrl?: string;
}

export interface SearchCategoriesResponse {
  categories: CategorySearchResult[];
}

// ============================================================

/** GET /api/accounts — список аккаунтов */
export interface AccountsResponse {
  accounts: Array<{
    platform: Platform;
    username: string;
    displayName: string;
    avatarUrl?: string;
    connectedAt: number;
  }>;
}
