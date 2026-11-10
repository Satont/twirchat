// Ports - can be overridden via env vars
const PORT_OFFSET = process.env.NODE_ENV === 'production' ? 0 : 10_000
export const AUTH_SERVER_PORT = parseInt(
  process.env['AUTH_SERVER_PORT'] ?? String(45821 + PORT_OFFSET),
)
export const OVERLAY_SERVER_PORT = parseInt(
  process.env['OVERLAY_SERVER_PORT'] ?? String(45823 + PORT_OFFSET),
)
export const KICK_WEBHOOK_PORT = parseInt(
  process.env['KICK_WEBHOOK_PORT'] ?? String(45822 + PORT_OFFSET),
)
export const DEV_SERVER_PORT = parseInt(
  process.env['DEV_SERVER_PORT'] ?? String(45824 + PORT_OFFSET),
)

// Auth callbacks
export const AUTH_CALLBACK_BASE = `http://localhost:${AUTH_SERVER_PORT}`
export const YOUTUBE_REDIRECT_URI = `http://127.0.0.1:${AUTH_SERVER_PORT}/auth/youtube/callback`
export const KICK_REDIRECT_URI = `${AUTH_CALLBACK_BASE}/auth/kick/callback`
export const VKPLAY_REDIRECT_URI = `http://127.0.0.1:${AUTH_SERVER_PORT}/auth/vkplay/callback`

// App info
export const APP_NAME = process.env['APP_NAME'] ?? 'TwirChat'

// Platform-specific constants (not secrets, just API endpoints)
export const TWITCH_ANON_PREFIX = 'justinfan'

export const KICK_API_BASE = 'https://api.kick.com/public/v1'
export const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize'
export const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token'

export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

export const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export const VKPLAY_AUTH_URL = 'https://auth.live.vkvideo.ru/app/oauth2/authorize'
export const VKPLAY_DEV_API_BASE = 'https://apidev.live.vkvideo.ru/v1'
export const VKPLAY_WS_URL =
  'wss://pubsub-dev.live.vkvideo.ru/connection/websocket?format=json&cf_protocol_version=v2'
export const VKPLAY_SCOPES: readonly string[] = ['chat:message:send']

// 7TV
export const SEVENTV_GQL_ENDPOINT = 'https://7tv.io/v4/gql'
export const SEVENTV_EVENT_API_URL = 'https://events.7tv.io/v3'
export const SEVENTV_CDN_BASE = 'https://cdn.7tv.app/emote'
