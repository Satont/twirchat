import type { UpdateStreamRequest, UpdateStreamResponse } from '@twirchat/shared/protocol'

import type { TwitchUserCredentials } from './twitch-users'

export async function updateTwitchStream(
  { channelId, title, categoryId }: Omit<UpdateStreamRequest, 'platform' | 'userAccessToken'>,
  credentials: TwitchUserCredentials,
): Promise<UpdateStreamResponse> {
  if (!channelId) throw new Error('A Twitch channel ID is required.')
  const body: Record<string, string> = {}
  if (title !== undefined) {
    body.title = title
  }

  if (categoryId !== undefined) {
    // Game_id must be the Twitch numeric ID string
    body.game_id = categoryId
  }

  if (Object.keys(body).length === 0) {
    return { ok: true }
  }

  const res = await fetch(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(channelId)}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Client-Id': credentials.clientId,
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitch channel update failed: ${res.status} ${text}`)
  }
  return { ok: true }
}
