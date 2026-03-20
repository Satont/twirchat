export const AUTH_SERVER_PORT = 45821;
export const OVERLAY_SERVER_PORT = 45823;
export const KICK_WEBHOOK_PORT = 45822;

export const AUTH_CALLBACK_BASE = `http://localhost:${AUTH_SERVER_PORT}`;

export const TWITCH_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/twitch/callback`;
export const YOUTUBE_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/youtube/callback`;
export const KICK_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/kick/callback`;

export const DB_PATH = `${process.env["HOME"]}/.twirchat/db.sqlite`;

export const APP_NAME = "TwirChat";

// Backend service
export const BACKEND_URL =
  process.env["CHATRIX_BACKEND_URL"] ?? "http://localhost:3000";
export const BACKEND_WS_URL =
  process.env["CHATRIX_BACKEND_WS_URL"] ?? "ws://localhost:3000/ws";

// Twitch IRC anonymous credentials
export const TWITCH_ANON_PREFIX = "justinfan";

// Kick Pusher (анонимный WebSocket)
export const KICK_PUSHER_WS =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679";
export const KICK_PUSHER_APP_KEY = "32cbd69e4b950bf97679";

// Kick API
export const KICK_API_BASE = "https://api.kick.com/public/v1";
export const KICK_AUTH_URL = "https://id.kick.com/oauth/authorize";
export const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

// Twitch
export const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

// YouTube
export const YOUTUBE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
