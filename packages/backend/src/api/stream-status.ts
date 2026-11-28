import type { StreamStatusResponse } from '@twirchat/shared'
/**
 * GET /api/stream-status?platform=twitch|kick&channelId=<id>
 *
 * Uses App Access Tokens (client_credentials) so no user login is required.
 * For Twitch, channelId is the numeric user ID (broadcaster_id).
 * For Kick, channelId is the channel slug.
 *
 * Returns StreamStatusResponse.
 */
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken, getKickAppHeaders } from './app-credentials.ts'

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

  const streamBody = z
    .object({
      data: z.array(
        z.object({
          title: z.string(),
          game_id: z.string(),
          game_name: z.string(),
          viewer_count: z.number(),
        }),
      ),
    })
    .parse(await streamRes.json())

  const stream = streamBody.data[0]
  if (stream) {
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

  const channelBody = z
    .object({
      data: z.array(z.object({ title: z.string(), game_id: z.string(), game_name: z.string() })),
    })
    .parse(await channelRes.json())

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
  const headers = await getKickAppHeaders()
  const res = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channelSlug)}`,
    { headers },
  )

  if (!res.ok) {
    throw new Error(`Kick channels API failed: ${res.status}`)
  }

  const body = z
    .object({
      data: z
        .array(
          z.object({
            stream_title: z.string().optional(),
            stream: z
              .object({ is_live: z.boolean().optional(), viewer_count: z.number().optional() })
              .optional(),
            category: z
              .object({ id: z.number().optional(), name: z.string().optional() })
              .optional(),
          }),
        )
        .optional(),
    })
    .parse(await res.json())

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
