import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import { emoteCatalogEntrySchema } from './persisted-schemas'

export async function getNativeTwitchEmotes(
  channelSlug: string,
  userAccessToken?: string,
  force = false,
): Promise<EmoteCatalogEntry[]> {
  const response = await backendFetch('/api/emote-catalog/twitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelSlug, userAccessToken, force }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Twitch emote catalog: HTTP ${response.status}.`)
  return z.array(emoteCatalogEntrySchema).parse(await response.json())
}

export async function resolveTwitchChannel(
  channelSlug: string,
): Promise<{ platformUserId: string; login: string }> {
  const response = await backendFetch('/api/emote-catalog/twitch/channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelSlug }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Twitch channel lookup: HTTP ${response.status}.`)
  return z.object({ platformUserId: z.string(), login: z.string() }).parse(await response.json())
}
