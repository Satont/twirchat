import type { Platform } from '@twirchat/shared/types'
import { useEffect, useState } from 'react'

import { deleteOldestEntry } from '../../services/bounded-cache'
import { initialsOf } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { avatarRevisionStore, avatarUrlForUser } from '../state/caches'
import { useStoreSelector } from '../state/create-store'
import { mentionAppearanceKey, mentionAppearances } from '../state/mention-appearances'
import { useTheme } from '../theme-context'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

export interface MentionAvatarTarget {
  username: string
  avatarUrl?: string
}

interface MentionAppearanceHint {
  readonly id?: string
  readonly username?: string
}

const RESOLVED_CACHE_LIMIT = 500
const RESOLVED_CACHE_TTL_MS = 5 * 60_000

const resolvedByResolver = new WeakMap<
  object,
  Map<string, { value: MentionAvatarTarget | null; expiresAt: number }>
>()
const inflightByResolver = new WeakMap<object, Map<string, Promise<MentionAvatarTarget | null>>>()

function cacheForResolver(
  resolver: object,
): Map<string, { value: MentionAvatarTarget | null; expiresAt: number }> {
  let cache = resolvedByResolver.get(resolver)
  if (!cache) {
    cache = new Map()
    resolvedByResolver.set(resolver, cache)
  }
  return cache
}

function inflightForResolver(resolver: object): Map<string, Promise<MentionAvatarTarget | null>> {
  let inflight = inflightByResolver.get(resolver)
  if (!inflight) {
    inflight = new Map()
    inflightByResolver.set(resolver, inflight)
  }
  return inflight
}

function readCachedMentionAvatar(
  resolver: object,
  normalizedKey: string,
): MentionAvatarTarget | null | undefined {
  const cache = cacheForResolver(resolver)
  const entry = cache.get(normalizedKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(normalizedKey)
    return undefined
  }
  return entry.value
}

export function useMentionAvatar(
  platform: Platform,
  username: string | undefined,
  enabled: boolean,
  appearanceHint?: MentionAppearanceHint,
): MentionAvatarTarget | null {
  const backend = useBackend()
  const api = backend.api
  const normalizedKey = username ? `${platform}:${username.trim().toLowerCase()}` : undefined
  const appearance =
    appearanceHint ??
    (enabled && username
      ? mentionAppearances.snapshot(mentionAppearanceKey(platform, username))
      : undefined)
  const cachedAvatarUrl = useStoreSelector(avatarRevisionStore, () =>
    enabled && appearance?.id && (platform === 'twitch' || platform === 'kick')
      ? avatarUrlForUser(platform, appearance.id)
      : undefined,
  )

  const [resolved, setResolved] = useState<{
    key: string | undefined
    value: MentionAvatarTarget | null
  }>(() => ({
    key: normalizedKey,
    value: enabled && normalizedKey ? (readCachedMentionAvatar(api, normalizedKey) ?? null) : null,
  }))

  useEffect(() => {
    if (!enabled || !username || !normalizedKey || cachedAvatarUrl) return undefined
    if (readCachedMentionAvatar(api, normalizedKey) !== undefined) return undefined
    let active = true
    const inflight = inflightForResolver(api)
    let request = inflight.get(normalizedKey)
    if (!request) {
      request = api
        .resolveMentionUser({ platform, username })
        .then((user) => {
          const value: MentionAvatarTarget | null = user
            ? { username: user.username ?? username, avatarUrl: user.avatarUrl }
            : null
          const cache = cacheForResolver(api)
          cache.delete(normalizedKey)
          cache.set(normalizedKey, { value, expiresAt: Date.now() + RESOLVED_CACHE_TTL_MS })
          while (cache.size > RESOLVED_CACHE_LIMIT) deleteOldestEntry(cache)
          return value
        })
        .catch(() => null)
        .finally(() => {
          if (inflight.get(normalizedKey) === request) inflight.delete(normalizedKey)
        })
      inflight.set(normalizedKey, request)
    }
    request
      .then((value) => {
        if (active) setResolved({ key: normalizedKey, value })
        return undefined
      })
      .catch(() => {
        if (active) setResolved({ key: normalizedKey, value: null })
      })
    return () => {
      active = false
    }
  }, [api, cachedAvatarUrl, enabled, normalizedKey, platform, username])

  if (!enabled || !username || !normalizedKey) return null
  if (cachedAvatarUrl) {
    return {
      username: appearance?.username ?? username,
      avatarUrl: cachedAvatarUrl,
    }
  }
  const immediate = readCachedMentionAvatar(api, normalizedKey)
  if (immediate !== undefined) return immediate
  return resolved.key === normalizedKey ? resolved.value : null
}

export function MentionAvatar({
  username,
  avatarUrl,
  size,
  fallbackColor,
  opacity = 1,
  testId,
}: {
  username: string
  avatarUrl?: string
  size: number
  fallbackColor?: string
  opacity?: number
  testId?: string
}) {
  const theme = useTheme()
  const radius = size / 2
  const fallbackFontSize = Math.max(8, Math.round(size * 0.48))

  const fallback = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: fallbackColor ?? theme.accent.primary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: fallbackFontSize,
          fontWeight: 700,
          color: fallbackColor ? 'rgba(255, 255, 255, 0.9)' : theme.accent.onDeep,
        }}
      >
        {initialsOf(username, 2)}
      </Text>
    </div>
  )

  return (
    <div
      testId={testId}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        opacity,
        pointerEvents: 'none',
        display: 'flex',
      }}
    >
      <RemoteImage
        url={avatarUrl}
        objectFit="cover"
        thumbnailSize={Math.max(size, 48)}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          pointerEvents: 'none',
        }}
        fallback={fallback}
      />
    </div>
  )
}
