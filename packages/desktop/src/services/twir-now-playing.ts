import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { sanitizeDisplayText } from '../views/shared/utils/display-text'
import { readPublicBotJson } from './public-bot-commands'
import {
  createTwirChannelLookup,
  createTwirResponseCache,
  requestTwir,
  type TwirChannelId,
  type TwirRequestOptions,
} from './twir-api'
import type { TwirChannelTarget } from './twir-channels'

const log = logger('twir-now-playing')
const TRACK_TTL_MS = 15_000
const RATE_LIMIT_RETRY_MS = 60_000

function parseArtworkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  const url = URL.parse(value)
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port)
    return undefined
  if (
    (url.hostname === 'i.scdn.co' && url.pathname.startsWith('/image/')) ||
    (url.hostname === 'lastfm.freetls.fastly.net' && url.pathname.startsWith('/i/u/'))
  )
    return url.href
  return undefined
}

const trackTextSchema = z
  .string()
  .max(512)
  .transform((value) => sanitizeDisplayText(value).trim())
const trackSchema = z.object({
  title: trackTextSchema,
  artist: trackTextSchema,
  imageUrl: z.unknown().transform(parseArtworkUrl).optional(),
})
const nowPlayingSchema = z.object({ data: trackSchema.nullable() })

export type TwirNowPlaying = z.infer<typeof trackSchema>

interface TwirNowPlayingClientOptions extends TwirRequestOptions {
  lookupChannel?: ReturnType<typeof createTwirChannelLookup>
}

export function createTwirNowPlayingClient({
  fetcher = fetch,
  now = Date.now,
  lookupChannel = createTwirChannelLookup({ fetcher, now }),
}: TwirNowPlayingClientOptions = {}) {
  const readTrack = createTwirResponseCache<TwirNowPlaying | null>({ now, ttlMs: TRACK_TTL_MS })
  let retryAt = 0

  async function load(channelId: TwirChannelId): Promise<TwirNowPlaying | null> {
    if (retryAt > now()) return null
    const response = await requestTwir(fetcher, `/v1/channels/${channelId}/now-playing`)
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After')) * 1_000
      retryAt = now() + Math.max(RATE_LIMIT_RETRY_MS, Number.isFinite(retryAfter) ? retryAfter : 0)
      return null
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Twir now playing: HTTP ${response.status}.`)
    const { data } = nowPlayingSchema.parse(await readPublicBotJson(response, 16_384))
    return data?.title ? data : null
  }

  return async (targets: readonly TwirChannelTarget[]): Promise<TwirNowPlaying | null> => {
    try {
      const channelId = await lookupChannel(targets)
      return channelId ? await readTrack(channelId, () => load(channelId)) : null
    } catch (error) {
      log.debug('Current Twir track unavailable', { error: String(error) })
      return null
    }
  }
}
