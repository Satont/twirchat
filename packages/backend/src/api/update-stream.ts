import type { UpdateStreamRequest, UpdateStreamResponse } from '@twirchat/shared'
import { z } from 'zod'

import { config } from '../config.ts'

async function updateKickStream(
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

export async function handleUpdateStream(req: Request): Promise<UpdateStreamResponse> {
  const body = z
    .toZod<UpdateStreamRequest>()(
      z.object({
        platform: z.literal('kick'),
        channelId: z.string(),
        userAccessToken: z.string(),
        title: z.string().optional(),
        categoryId: z.string().optional(),
      }),
    )
    .parse(await req.json())
  const { channelId, userAccessToken, title, categoryId } = body

  if (!channelId || !userAccessToken) {
    throw new Error('channelId and userAccessToken are required')
  }

  await updateKickStream(userAccessToken, title, categoryId)
  return { ok: true }
}
