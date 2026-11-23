import { useBackend } from '@gpuix/backend/context'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { logger } from '@twirchat/shared/logger'
import type { Badge } from '@twirchat/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

const log = logger('twitch-user-badges')

interface TwitchBadgesIdentity {
  username: string
  channelSlug?: string
  channelId?: string
}

type TwitchBadgesState =
  | { kind: 'loading'; key: string; badges: Badge[] }
  | { kind: 'error'; key: string }
  | { kind: 'loaded'; key: string; badges: Badge[] }

interface TwitchBadgesCacheEntry {
  badges: Badge[]
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60_000
const CACHE_CAPACITY = 32
const cache = new Map<string, TwitchBadgesCacheEntry>()

function identityKey({ username, channelSlug, channelId }: TwitchBadgesIdentity): string {
  return [
    username.trim().toLowerCase(),
    channelSlug?.trim().toLowerCase() ?? '',
    channelId?.trim().toLowerCase() ?? '',
  ].join('\u0000')
}

function cachedBadges(key: string): Badge[] | undefined {
  return cache.get(key)?.badges
}

function isFresh(key: string): boolean {
  const entry = cache.get(key)
  return entry !== undefined && entry.expiresAt > Date.now()
}

function cacheBadges(key: string, badges: Badge[]): void {
  cache.delete(key)
  cache.set(key, { badges, expiresAt: Date.now() + CACHE_TTL_MS })
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

function cachedState(key: string): TwitchBadgesState {
  const badges = cachedBadges(key)
  return badges ? { kind: 'loaded', key, badges } : { kind: 'loading', key, badges: [] }
}

export function useTwitchUserBadges(identity: TwitchBadgesIdentity): {
  state: TwitchBadgesState
  retry: () => void
} {
  const { api } = useBackend()
  const { username, channelSlug, channelId } = identity
  const key = identityKey(identity)
  const [stored, setStored] = useState<TwitchBadgesState>(() => cachedState(key))
  const pending = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    pending.current?.abort()
    const request = new AbortController()
    pending.current = request
    runUiTask(
      (async () => {
        try {
          const badges = await api.getTwitchUserBadges({
            username,
            channelSlug,
            channelId,
            signal: request.signal,
          })
          if (request.signal.aborted) return
          cacheBadges(key, badges)
          setStored({ kind: 'loaded', key, badges })
        } catch {
          if (!request.signal.aborted) {
            log.warn('Failed to load Twitch badge collection')
          }
        }
      })(),
    )
  }, [api, key, username, channelSlug, channelId])

  useEffect(() => {
    const badges = cachedBadges(key)
    if (badges) {
      // oxlint-disable-next-line react/set-state-in-effect -- Seed the identity snapshot from the module cache.
      setStored((current) =>
        current.key === key && current.kind === 'loaded'
          ? current
          : { kind: 'loaded', key, badges },
      )
      if (!isFresh(key)) load()
    } else {
      load()
    }
    return () => pending.current?.abort()
  }, [key, load])

  const retry = useCallback(() => {
    setStored({ kind: 'loading', key, badges: [] })
    load()
  }, [key, load])

  // Cached/loading state is derived during render, so switching identity never
  // paints the previous user's badges while the new request is pending.
  return { state: stored.key === key ? stored : cachedState(key), retry }
}
