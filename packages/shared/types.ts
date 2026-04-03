// ============================================================
// Общие типы платформ
// ============================================================

export type Platform = "twitch" | "youtube" | "kick";

export interface Badge {
  id: string;
  type:
    | "moderator"
    | "subscriber"
    | "vip"
    | "broadcaster"
    | "staff"
    | "gifter"
    | string;
  text: string;
  imageUrl?: string;
}

export interface Emote {
  id: string;
  name: string;
  imageUrl: string;
  /** начальная и конечная позиции в тексте */
  positions: Array<{ start: number; end: number }>;
  /** соотношение сторон для широких смайлов (например 3 для privet) */
  aspectRatio?: number;
}

// ============================================================
// Нормализованные сообщения и события
// ============================================================

export interface NormalizedChatMessage {
  id: string;
  platform: Platform;
  channelId: string;
  author: {
    id: string;
    username?: string;
    displayName: string;
    color?: string;
    avatarUrl?: string;
    badges: Badge[];
  };
  text: string;
  emotes: Emote[];
  timestamp: Date;
  type: "message" | "action" | "system";
}

export interface NormalizedEvent {
  id: string;
  platform: Platform;
  type:
    | "follow"
    | "sub"
    | "resub"
    | "gift_sub"
    | "raid"
    | "host"
    | "bits"
    | "superchat"
    | "membership";
  user: {
    id: string;
    displayName: string;
    avatarUrl?: string;
  };
  data: Record<string, unknown>;
  timestamp: Date;
}

// ============================================================
// Аккаунты и настройки
// ============================================================

export interface Account {
  id: string;
  platform: Platform;
  platformUserId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  theme: "light" | "dark";
  chatTheme: "modern" | "compact";
  fontFamily: "inter" | "manrope" | "system";
  fontSize: number;
  showPlatformColorStripe: boolean;
  showPlatformIcon: boolean;
  showTimestamp: boolean;
  showAvatars: boolean;
  showBadges: boolean;
  platformFilter: Platform[] | "all";
  overlay: OverlayConfig;
  /** Auto-check for updates on startup */
  autoCheckUpdates?: boolean;
}

export interface OverlayConfig {
  background: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  maxMessages: number;
  messageTimeout: number;
  showPlatformIcon: boolean;
  showAvatar: boolean;
  showBadges: boolean;
  animation: "slide" | "fade" | "none";
  position: "bottom" | "top";
  port: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  chatTheme: "modern",
  fontFamily: "inter",
  fontSize: 14,
  showPlatformColorStripe: true,
  showPlatformIcon: true,
  showTimestamp: true,
  showAvatars: true,
  showBadges: true,
  platformFilter: "all",
  overlay: {
    background: "transparent",
    textColor: "#ffffff",
    fontSize: 14,
    fontFamily: "inter",
    maxMessages: 20,
    messageTimeout: 0,
    showPlatformIcon: true,
    showAvatar: true,
    showBadges: true,
    animation: "slide",
    position: "bottom",
    port: 45823,
  },
  autoCheckUpdates: true,
};

// ============================================================
// Статус трансляции
// ============================================================

export interface StreamStatus {
  platform: Platform;
  channelId: string;
  isLive: boolean;
  title: string;
  categoryId?: string;
  categoryName?: string;
  viewerCount?: number;
}

// ============================================================
// Статус платформы
// ============================================================

export type PlatformStatus = "connected" | "disconnected" | "connecting" | "error";

export interface PlatformStatusInfo {
  platform: Platform;
  status: PlatformStatus;
  error?: string;
  /** anonymous = слушаем без OAuth */
  mode: "anonymous" | "authenticated";
  /** The channel login name this adapter is connected to (lowercase) */
  channelLogin?: string;
}

// ============================================================
// Watched Channels
// ============================================================

export interface WatchedChannel {
  id: string;
  platform: "twitch" | "kick" | "youtube";
  channelSlug: string;
  displayName: string;
  createdAt: number;
}

// ============================================================
// Twitch Badges API
// ============================================================

/** Ответ от GET /api/twitch/badges?broadcasterLogin=<login> */
export interface TwitchBadgesResponse {
  /** "setId/version" → imageUrl, например "subscriber/6" → "https://..." */
  badges: Record<string, string>;
}
