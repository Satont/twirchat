import { homedir } from "node:os";

// Environment-aware configuration
const isDev = process.env["NODE_ENV"] !== "production";

// Ports - can be overridden via env vars
export const AUTH_SERVER_PORT = parseInt(
  process.env["AUTH_SERVER_PORT"] ?? "45821",
);
export const OVERLAY_SERVER_PORT = parseInt(
  process.env["OVERLAY_SERVER_PORT"] ?? "45823",
);
export const KICK_WEBHOOK_PORT = parseInt(
  process.env["KICK_WEBHOOK_PORT"] ?? "45822",
);

// Auth callbacks
export const AUTH_CALLBACK_BASE = `http://localhost:${AUTH_SERVER_PORT}`;
export const TWITCH_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/twitch/callback`;
export const YOUTUBE_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/youtube/callback`;
export const KICK_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/kick/callback`;

// App info
export const APP_NAME = process.env["APP_NAME"] ?? "TwirChat";

// Platform-specific constants (not secrets, just API endpoints)
export const TWITCH_ANON_PREFIX = "justinfan";

export const KICK_PUSHER_WS =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679";
export const KICK_PUSHER_APP_KEY = "32cbd69e4b950bf97679";

export const KICK_API_BASE = "https://api.kick.com/public/v1";
export const KICK_AUTH_URL = "https://id.kick.com/oauth/authorize";
export const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

export const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export const YOUTUBE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// 7TV
export const SEVENTV_GQL_ENDPOINT = "https://7tv.io/v4/gql";
export const SEVENTV_EVENT_API_URL = "https://events.7tv.io/v3";
export const SEVENTV_CDN_BASE = "https://cdn.7tv.app/emote";
