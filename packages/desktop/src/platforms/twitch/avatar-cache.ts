import { getBackendUrl } from '../../runtime-config'

interface TwitchAvatarCacheEntry {
  avatarUrl?: string
  expiresAt: number
}

export interface TwitchAvatarLookupInput {
  authorId?: string | null
}

export interface TwitchAvatarResolverDependencies {
  fetchFn?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export type TwitchAvatarResolver = (input: TwitchAvatarLookupInput) => Promise<string | undefined>

export const TWITCH_AVATAR_POSITIVE_TTL_MS = 24 * 60 * 60 * 1000
export const TWITCH_AVATAR_NEGATIVE_TTL_MS = 10 * 60 * 1000
export const TWITCH_AVATAR_FETCH_TIMEOUT_MS = 3000

function getCacheKey(authorId?: string | null): string | undefined {
  if (!authorId) {
    return undefined
  }

  return `twitch:${authorId}`
}

function normalizeAvatarUrl(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function getEndpoint(userId: string): string {
  return `${getBackendUrl()}/api/twitch/user?userId=${encodeURIComponent(userId)}`
}

export function createTwitchAvatarResolver({
  fetchFn = fetch,
  now = () => Date.now(),
  timeoutMs = TWITCH_AVATAR_FETCH_TIMEOUT_MS,
}: TwitchAvatarResolverDependencies = {}): TwitchAvatarResolver {
  const cache = new Map<string, TwitchAvatarCacheEntry>()
  const inFlight = new Map<string, Promise<string | undefined>>()

  return async ({ authorId }: TwitchAvatarLookupInput) => {
    const cacheKey = getCacheKey(authorId)
    if (!cacheKey || !authorId) {
      return undefined
    }

    const cached = cache.get(cacheKey)
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) {
      return cached.avatarUrl
    }

    const pending = inFlight.get(cacheKey)
    if (pending) {
      return pending
    }

    const request = (async () => {
      try {
        const response = await fetchFn(getEndpoint(authorId), {
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!response.ok) {
          cache.set(cacheKey, { expiresAt: now() + TWITCH_AVATAR_NEGATIVE_TTL_MS })
          return undefined
        }

        const body = (await response.json()) as {
          user?: { profile_image_url?: string | null }
        }
        const avatarUrl = normalizeAvatarUrl(body.user?.profile_image_url)

        cache.set(cacheKey, {
          avatarUrl,
          expiresAt:
            now() + (avatarUrl ? TWITCH_AVATAR_POSITIVE_TTL_MS : TWITCH_AVATAR_NEGATIVE_TTL_MS),
        })

        return avatarUrl
      } catch {
        cache.set(cacheKey, { expiresAt: now() + TWITCH_AVATAR_NEGATIVE_TTL_MS })
        return undefined
      } finally {
        inFlight.delete(cacheKey)
      }
    })()

    inFlight.set(cacheKey, request)
    return request
  }
}

export const resolveTwitchAvatarUrl = createTwitchAvatarResolver()
