import type { NormalizedChatMessage, NormalizedEvent, Platform, PlatformStatusInfo } from "./types";

/**
 * Протокол WebSocket между backend и desktop-приложением.
 *
 * Desktop подключается к backend с заголовком:
 *   X-Client-Secret: <uuid>
 *
 * Backend пушит сообщения в desktop в виде JSON-объектов BackendToDesktopMessage.
 * Desktop отправляет команды в виде DesktopToBackendMessage.
 */

// ============================================================
// Backend → Desktop
// ============================================================

export type BackendToDesktopMessage =
  | { type: "chat_message"; data: NormalizedChatMessage }
  | { type: "chat_event"; data: NormalizedEvent }
  | { type: "platform_status"; data: PlatformStatusInfo }
  | { type: "auth_url"; platform: Platform; url: string }
  | { type: "auth_success"; platform: Platform; username: string; displayName: string }
  | { type: "auth_error"; platform: Platform; error: string }
  | { type: "error"; message: string }
  | { type: "pong" };

// ============================================================
// Desktop → Backend
// ============================================================

export type DesktopToBackendMessage =
  | { type: "ping" }
  | { type: "auth_start"; platform: Platform }
  | { type: "auth_logout"; platform: Platform }
  | { type: "channel_join"; platform: Platform; channelSlug: string }
  | { type: "channel_leave"; platform: Platform; channelSlug: string }
  | { type: "send_message"; platform: Platform; channelId: string; text: string };

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
