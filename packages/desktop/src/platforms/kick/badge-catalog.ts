import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { deleteOldestEntry } from '../../services/bounded-cache'
import { kickSubscriberBadgeSchema, type KickSubscriberBadge } from './badge-data'

const log = logger('kick-badges')
const MAX_CHANNELS = 128
const MAX_REQUESTS = 8
const POSITIVE_TTL_MS = 6 * 60 * 60_000
const NEGATIVE_TTL_MS = 5 * 60_000

interface CatalogEntry {
  badges: KickSubscriberBadge[]
  expiresAt: number
}

const catalogSchema = z.object({ subscriber_badges: z.array(z.unknown()).max(500).optional() })

export function createKickBadgeCatalog(
  options: {
    fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    now?: () => number
    timeoutMs?: number
  } = {},
) {
  const cache = new Map<string, CatalogEntry>()
  const inFlight = new Map<string, Promise<KickSubscriberBadge[]>>()
  const now = options.now ?? Date.now
  const fetchFn = options.fetchFn ?? fetch

  function load(channelSlug: string): Promise<KickSubscriberBadge[]> {
    const slug = channelSlug.trim().replace(/^#/, '').toLowerCase()
    const existing = cache.get(slug)
    if (existing && existing.expiresAt > now()) return Promise.resolve(existing.badges)
    const pending = inFlight.get(slug)
    if (pending) return pending
    if (inFlight.size >= MAX_REQUESTS) return Promise.resolve([])
    const task = (async () => {
      try {
        const response = await fetchFn(
          `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
          {
            signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
            headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 TwirChat' },
          },
        )
        if (!response.ok) throw new Error(`Kick badge catalog HTTP ${response.status}`)
        const data = catalogSchema.parse(await response.json())
        const badges = (data.subscriber_badges ?? []).flatMap((value) => {
          const badge = kickSubscriberBadgeSchema.safeParse(value)
          return badge.success ? [badge.data] : []
        })
        cache.set(slug, { badges, expiresAt: now() + POSITIVE_TTL_MS })
        return badges
      } catch (error) {
        log.debug('Kick subscriber badge catalog is unavailable', {
          channel: slug,
          error: String(error),
        })
        cache.set(slug, { badges: [], expiresAt: now() + NEGATIVE_TTL_MS })
        return []
      } finally {
        inFlight.delete(slug)
        while (cache.size > MAX_CHANNELS) deleteOldestEntry(cache)
      }
    })()
    inFlight.set(slug, task)
    return task
  }

  return { load }
}

export const kickBadgeCatalog = createKickBadgeCatalog()
