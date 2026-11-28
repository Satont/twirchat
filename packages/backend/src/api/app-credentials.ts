import { z } from 'zod'

import { config } from '../config.ts'

// Bun.serve answers in `routes` must finish well within its idleTimeout.
const TWITCH_REQUEST_TIMEOUT_MS = 8000
const REFRESH_MARGIN_MS = 60_000
const appTokenResponse = z.object({ access_token: z.string(), expires_in: z.number() })

interface AppGrantRequest {
  provider: 'Twitch' | 'Kick'
  endpoint: string
  clientId: string
  clientSecret: string
  signal?: AbortSignal
}

async function requestAppGrant({
  provider,
  endpoint,
  clientId,
  clientSecret,
  signal,
}: AppGrantRequest) {
  const res = await fetch(endpoint, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) {
    throw new Error(`Failed to get ${provider} app token: ${res.status} ${await res.text()}`)
  }
  return appTokenResponse.parse(await res.json())
}

let twitchAppToken: string | null = null
let twitchAppTokenExpiresAt = 0
let pendingTwitchAppToken: Promise<string> | null = null

function invalidateTwitchAppToken(): void {
  twitchAppToken = null
  twitchAppTokenExpiresAt = 0
}

function getTwitchHelixHeaders(token: string, headers?: RequestInit['headers']): Headers {
  const nextHeaders = new Headers(headers)
  nextHeaders.set('Authorization', `Bearer ${token}`)
  nextHeaders.set('Client-Id', config.TWITCH_CLIENT_ID)

  return nextHeaders
}

async function getTwitchAppToken(): Promise<string> {
  if (twitchAppToken && Date.now() < twitchAppTokenExpiresAt - REFRESH_MARGIN_MS) {
    return twitchAppToken
  }
  // Concurrent requests after a restart or expiry share one token request.
  pendingTwitchAppToken ??= requestTwitchAppToken().finally(() => {
    pendingTwitchAppToken = null
  })
  return pendingTwitchAppToken
}

async function requestTwitchAppToken(): Promise<string> {
  const data = await requestAppGrant({
    provider: 'Twitch',
    endpoint: 'https://id.twitch.tv/oauth2/token',
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    signal: AbortSignal.timeout(TWITCH_REQUEST_TIMEOUT_MS),
  })

  twitchAppToken = data.access_token
  twitchAppTokenExpiresAt = Date.now() + data.expires_in * 1000

  return twitchAppToken
}

export async function fetchTwitchHelixWithAppToken(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getTwitchAppToken()
  const response = await fetch(input, {
    ...init,
    headers: getTwitchHelixHeaders(token, init.headers),
    signal: init.signal ?? AbortSignal.timeout(TWITCH_REQUEST_TIMEOUT_MS),
  })

  if (response.status !== 401) {
    return response
  }

  invalidateTwitchAppToken()

  const refreshedToken = await getTwitchAppToken()
  return fetch(input, {
    ...init,
    headers: getTwitchHelixHeaders(refreshedToken, init.headers),
    signal: init.signal ?? AbortSignal.timeout(TWITCH_REQUEST_TIMEOUT_MS),
  })
}

let kickAppToken: string | null = null
let kickAppTokenExpiresAt = 0

async function getKickAppToken(): Promise<string> {
  if (kickAppToken && Date.now() < kickAppTokenExpiresAt - REFRESH_MARGIN_MS) {
    return kickAppToken
  }

  const data = await requestAppGrant({
    provider: 'Kick',
    endpoint: 'https://id.kick.com/oauth/token',
    clientId: config.KICK_CLIENT_ID,
    clientSecret: config.KICK_CLIENT_SECRET,
  })

  kickAppToken = data.access_token
  kickAppTokenExpiresAt = Date.now() + data.expires_in * 1000

  return kickAppToken
}

export async function getKickAppHeaders(): Promise<Record<string, string>> {
  const token = await getKickAppToken()
  return { Authorization: `Bearer ${token}`, 'Client-ID': config.KICK_CLIENT_ID }
}
