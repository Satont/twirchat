import type { UpdateStreamRequest, UpdateStreamResponse } from '@twirchat/shared'
/**
 * POST /api/update-stream
 *
 * The desktop provides its own user access token in the request body.
 * The backend forwards the PATCH request to the platform API using that
 * token so credentials are never stored on the backend.
 *
 * Body: UpdateStreamRequest
 * Response: UpdateStreamResponse
 */
import { z } from 'zod'

import { config } from '../config.ts'

// ----------------------------------------------------------------
// Twitch
// ----------------------------------------------------------------

async function updateTwitchStream(
  channelId: string,
  userAccessToken: string,
  title?: string,
  categoryId?: string,
): Promise<void> {
  const body: Record<string, string> = {}
  if (title !== undefined) {
    body.title = title
  }

  if (categoryId !== undefined) {
    // Game_id must be the Twitch numeric ID string
    body.game_id = categoryId
  }

  if (Object.keys(body).length === 0) {
    return
  }

  const res = await fetch(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(channelId)}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitch channel update failed: ${res.status} ${text}`)
  }
}

// ----------------------------------------------------------------
// Kick
// ----------------------------------------------------------------

async function updateKickStream(
  channelId: string,
  userAccessToken: string,
  title?: string,
  categoryId?: string,
): Promise<void> {
  const body: Record<string, string | number> = {}
  if (title !== undefined) {
    body.stream_title = title
  }
  if (categoryId !== undefined) {
    body.category_id = Number(categoryId)
  }

  if (Object.keys(body).length === 0) {
    return
  }

  const res = await fetch('https://api.kick.com/public/v1/channels', {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Client-ID': config.KICK_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kick channel update failed: ${res.status} ${text}`)
  }
}

// ----------------------------------------------------------------
// Public handler
// ----------------------------------------------------------------

export async function handleUpdateStream(req: Request): Promise<UpdateStreamResponse> {
  const body = z
    .toZod<UpdateStreamRequest>()(
      z.object({
        platform: z.enum(['twitch', 'kick']),
        channelId: z.string(),
        userAccessToken: z.string(),
        title: z.string().optional(),
        categoryId: z.string().optional(),
      }),
    )
    .parse(await req.json())
  const { platform, channelId, userAccessToken, title, categoryId } = body

  if (!platform || !channelId || !userAccessToken) {
    throw new Error('platform, channelId, and userAccessToken are required')
  }

  if (platform === 'twitch') {
    await updateTwitchStream(channelId, userAccessToken, title, categoryId)
    return { ok: true }
  }

  if (platform === 'kick') {
    await updateKickStream(channelId, userAccessToken, title, categoryId)
    return { ok: true }
  }

  throw new Error(`Unsupported platform: ${platform}`)
}
