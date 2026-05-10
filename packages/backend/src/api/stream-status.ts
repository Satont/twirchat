/**
 * GET /api/stream-status?platform=twitch|kick&channelId=<id>
 *
 * Uses App Access Tokens (client_credentials) so no user login is required.
 * For Twitch, channelId is the numeric user ID (broadcaster_id).
 * For Kick, channelId is the channel slug.
 *
 * Returns StreamStatusResponse.
 */

import { config } from '../config.ts'
import type { StreamStatusResponse } from '@twirchat/shared'

// ----------------------------------------------------------------
// Twitch App Token (cached in-memory with expiry)
// ----------------------------------------------------------------

let twitchAppToken: string | null = null
let twitchAppTokenExpiresAt = 0

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
  if (twitchAppToken && Date.now() < twitchAppTokenExpiresAt - 60_000) {
    return twitchAppToken
  }

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to get Twitch app token: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
  }

  twitchAppToken = data.access_token
  twitchAppTokenExpiresAt = Date.now() + data.expires_in * 1000

  return twitchAppToken
}

async function fetchTwitchHelixWithAppToken(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getTwitchAppToken()
  const response = await fetch(input, {
    ...init,
    headers: getTwitchHelixHeaders(token, init.headers),
  })

  if (response.status !== 401) {
    return response
  }

  invalidateTwitchAppToken()

  const refreshedToken = await getTwitchAppToken()
  return fetch(input, {
    ...init,
    headers: getTwitchHelixHeaders(refreshedToken, init.headers),
  })
}

// ----------------------------------------------------------------
// Kick App Token (client_credentials)
// ----------------------------------------------------------------

let kickAppToken: string | null = null
let kickAppTokenExpiresAt = 0

async function getKickAppToken(): Promise<string> {
  if (kickAppToken && Date.now() < kickAppTokenExpiresAt - 60_000) {
    return kickAppToken
  }

  const res = await fetch('https://id.kick.com/oauth/token', {
    body: new URLSearchParams({
      client_id: config.KICK_CLIENT_ID,
      client_secret: config.KICK_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to get Kick app token: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
  }

  kickAppToken = data.access_token
  kickAppTokenExpiresAt = Date.now() + data.expires_in * 1000

  return kickAppToken
}

// ----------------------------------------------------------------
// Twitch stream status
// ----------------------------------------------------------------

async function getTwitchStreamStatus(channelId: string): Promise<StreamStatusResponse> {
  // First, try to get live stream data
  const streamRes = await fetchTwitchHelixWithAppToken(
    `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(channelId)}`,
  )

  if (!streamRes.ok) {
    throw new Error(`Twitch streams API failed: ${streamRes.status}`)
  }

  const streamBody = (await streamRes.json()) as {
    data: {
      title: string
      game_id: string
      game_name: string
      viewer_count: number
    }[]
  }

  if (streamBody.data.length > 0) {
    const stream = streamBody.data[0]!
    return {
      categoryId: stream.game_id || undefined,
      categoryName: stream.game_name || undefined,
      isLive: true,
      title: stream.title,
      viewerCount: stream.viewer_count,
    }
  }

  // Offline: fetch channel info for title/game
  const channelRes = await fetchTwitchHelixWithAppToken(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(channelId)}`,
  )

  if (!channelRes.ok) {
    throw new Error(`Twitch channels API failed: ${channelRes.status}`)
  }

  const channelBody = (await channelRes.json()) as {
    data: {
      title: string
      game_id: string
      game_name: string
    }[]
  }

  const channel = channelBody.data[0]
  if (!channel) {
    return { isLive: false, title: '' }
  }

  return {
    categoryId: channel.game_id || undefined,
    categoryName: channel.game_name || undefined,
    isLive: false,
    title: channel.title,
  }
}

// ----------------------------------------------------------------
// Kick stream status
// ----------------------------------------------------------------

async function getKickStreamStatus(channelSlug: string): Promise<StreamStatusResponse> {
  const token = await getKickAppToken()

  const res = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channelSlug)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-ID': config.KICK_CLIENT_ID,
      },
    },
  )

  if (!res.ok) {
    throw new Error(`Kick channels API failed: ${res.status}`)
  }

  const body = (await res.json()) as {
    data?: {
      stream_title?: string
      stream?: {
        is_live?: boolean
        viewer_count?: number
      }
      category?: {
        id?: number
        name?: string
      }
    }[]
  }

  const channel = body.data?.[0]
  if (!channel) {
    return { isLive: false, title: '' }
  }

  const { stream } = channel

  return {
    categoryId: channel.category?.id !== undefined ? String(channel.category.id) : undefined,
    categoryName: channel.category?.name,
    isLive: stream?.is_live ?? false,
    title: channel.stream_title ?? '',
    viewerCount: stream?.viewer_count,
  }
}

// ----------------------------------------------------------------
// Public handler
// ----------------------------------------------------------------

export async function handleStreamStatus(url: URL): Promise<StreamStatusResponse> {
  const platform = url.searchParams.get('platform')
  const channelId = url.searchParams.get('channelId')

  if (!platform || !channelId) {
    throw new Error('platform and channelId query params are required')
  }

  if (platform === 'twitch') {
    return getTwitchStreamStatus(channelId)
  }

  if (platform === 'kick') {
    return getKickStreamStatus(channelId)
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

// Re-export app token helpers for use in other API modules
export { fetchTwitchHelixWithAppToken, getKickAppToken, getTwitchAppToken }
