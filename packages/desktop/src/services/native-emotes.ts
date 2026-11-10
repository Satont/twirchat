import { createHash } from 'node:crypto'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import { createTwitchEmoteCatalog, EmoteCatalogError } from '@twirchat/shared/twitch-emote-catalog'
import { z } from 'zod'

import { createTwitchUserHelix } from '../auth/twitch-user-token'
import { backendFetch } from '../runtime-config'
import { emoteCatalogEntrySchema } from './persisted-schemas'

const localCatalog = createTwitchEmoteCatalog()

export async function getNativeTwitchEmotes(
  channelSlug: string,
  userAccessToken?: string,
  force = false,
): Promise<EmoteCatalogEntry[]> {
  if (userAccessToken) {
    const auth = await createTwitchUserHelix(userAccessToken).catch(() => undefined)
    if (auth?.scopes.includes('user:read:emotes')) {
      try {
        return await localCatalog({
          channelSlug,
          force,
          source: {
            kind: 'user',
            cacheKey: createHash('sha256').update(userAccessToken).digest('hex'),
            userId: auth.userId,
            fetch: (path) => auth.fetch(path),
          },
        })
      } catch (error) {
        if (!(error instanceof EmoteCatalogError) || (error.status !== 401 && error.status !== 403))
          throw error
      }
    }
  }
  const response = await backendFetch('/api/emote-catalog/twitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelSlug, force }),
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
