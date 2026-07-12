interface KickAvatarCacheEntry {
  avatarUrl?: string
  expiresAt: number
}

export interface KickAvatarLookupInput {
  authorId?: string | null
  lookupSource?: 'slug' | 'username'
  profilePicture?: string | null
  slugOrUsername?: string | null
}

export interface KickAvatarResolverDependencies {
  fetchFn?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export type KickAvatarResolver = (input: KickAvatarLookupInput) => Promise<string | undefined>

export const KICK_AVATAR_POSITIVE_TTL_MS = 24 * 60 * 60 * 1000
export const KICK_AVATAR_NEGATIVE_TTL_MS = 10 * 60 * 1000
export const KICK_AVATAR_FETCH_TIMEOUT_MS = 3000

function normalizeAvatarUrl(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeSlugOrUsername(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function getCacheKey(authorId?: string | null): string | undefined {
  if (!authorId) {
    return undefined
  }

  return `kick:${authorId}`
}

function getEndpoint(slugOrUsername: string): string {
  return `https://kick.com/api/v2/channels/${encodeURIComponent(slugOrUsername)}/`
}

function shouldNegativeCache({
  lookupSource,
  responseStatus,
  timedOut,
}: {
  lookupSource: KickAvatarLookupInput['lookupSource']
  responseStatus?: number
  timedOut?: boolean
}): boolean {
  if (lookupSource !== 'slug') {
    return false
  }

  if (timedOut) {
    return false
  }

  if (responseStatus === undefined) {
    return false
  }

  return responseStatus === 200 || responseStatus === 404
}

export function createKickAvatarResolver({
  fetchFn = fetch,
  now = () => Date.now(),
  timeoutMs = KICK_AVATAR_FETCH_TIMEOUT_MS,
}: KickAvatarResolverDependencies = {}): KickAvatarResolver {
  const cache = new Map<string, KickAvatarCacheEntry>()
  const inFlight = new Map<string, Promise<string | undefined>>()

  return async ({
    authorId,
    lookupSource = 'slug',
    profilePicture,
    slugOrUsername,
  }: KickAvatarLookupInput) => {
    const immediateAvatar = normalizeAvatarUrl(profilePicture)
    const cacheKey = getCacheKey(authorId)

    if (immediateAvatar) {
      if (cacheKey) {
        cache.set(cacheKey, {
          avatarUrl: immediateAvatar,
          expiresAt: now() + KICK_AVATAR_POSITIVE_TTL_MS,
        })
      }

      return immediateAvatar
    }

    if (!cacheKey) {
      return undefined
    }

    const cached = cache.get(cacheKey)
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) {
      return cached.avatarUrl
    }

    const lookupKey = normalizeSlugOrUsername(slugOrUsername)
    if (!lookupKey) {
      return undefined
    }

    const pending = inFlight.get(cacheKey)
    if (pending) {
      return pending
    }

    const request = (async () => {
      try {
        const response = await fetchFn(getEndpoint(lookupKey), {
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          if (shouldNegativeCache({ lookupSource, responseStatus: response.status })) {
            cache.set(cacheKey, { expiresAt: now() + KICK_AVATAR_NEGATIVE_TTL_MS })
          }

          return undefined
        }

        const body = (await response.json()) as {
          user?: { profile_pic?: string | null }
        }

        const avatarUrl = normalizeAvatarUrl(body.user?.profile_pic)
        if (avatarUrl) {
          cache.set(cacheKey, {
            avatarUrl,
            expiresAt: now() + KICK_AVATAR_POSITIVE_TTL_MS,
          })
          return avatarUrl
        }

        if (shouldNegativeCache({ lookupSource, responseStatus: response.status })) {
          cache.set(cacheKey, { expiresAt: now() + KICK_AVATAR_NEGATIVE_TTL_MS })
        }

        return undefined
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError'
        if (shouldNegativeCache({ lookupSource, timedOut })) {
          cache.set(cacheKey, { expiresAt: now() + KICK_AVATAR_NEGATIVE_TTL_MS })
        }

        return undefined
      } finally {
        inFlight.delete(cacheKey)
      }
    })()

    inFlight.set(cacheKey, request)
    return request
  }
}

export const resolveKickAvatarUrl = createKickAvatarResolver()
