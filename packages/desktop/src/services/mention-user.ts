import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import type { UserCardTarget } from '../views/main/utils/chatCommands'
import { deleteOldestEntry } from './bounded-cache'

export type MentionUser = Pick<
  UserCardTarget,
  'platformUserId' | 'displayName' | 'username' | 'avatarUrl' | 'color' | 'badges'
>

export interface MentionUserRequest {
  platform: Platform
  username: string
}

export async function resolveMentionUser(
  { platform, username }: MentionUserRequest,
  request: (path: string) => Promise<Response> = backendFetch,
): Promise<MentionUser | null> {
  const path =
    platform === 'youtube'
      ? `/api/youtube/resolve?handle=${encodeURIComponent(username)}`
      : platform === 'twitch'
        ? `/api/twitch/user?login=${encodeURIComponent(username)}`
        : `/api/kick/chatroom?slug=${encodeURIComponent(username)}`
  const response = await request(path)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not look up @${username} (${response.status}).`)
  if (platform === 'youtube') {
    const { channelId } = z
      .object({
        channelId: z
          .string()
          .regex(/^UC[A-Za-z0-9_-]{22}$/)
          .nullable(),
      })
      .parse(await response.json())
    return channelId
      ? {
          platformUserId: channelId,
          username: `@${username}`,
          displayName: username,
        }
      : null
  }
  if (platform === 'twitch') {
    const { user } = z
      .object({
        user: z
          .object({
            id: z.string().regex(/^\d+$/),
            login: z.string().min(1),
            display_name: z.string().optional(),
            profile_image_url: z.string().optional(),
          })
          .nullable(),
      })
      .parse(await response.json())
    return user
      ? {
          platformUserId: user.id,
          username: user.login,
          displayName: user.display_name || user.login,
          avatarUrl: user.profile_image_url,
        }
      : null
  }
  const user = z
    .object({
      broadcasterUserId: z.number().int().positive(),
      avatarUrl: z.string().optional(),
    })
    .parse(await response.json())
  return {
    platformUserId: String(user.broadcasterUserId),
    username,
    displayName: username,
    avatarUrl: user.avatarUrl,
  }
}

const CACHE_LIMIT = 500
const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, { value: MentionUser | null; expiresAt: number }>()
const inFlight = new Map<string, Promise<MentionUser | null>>()

function cacheKey({ platform, username }: MentionUserRequest): string {
  return `${platform}:${username.trim().toLowerCase()}`
}

/** Bounded, in-flight-deduplicated lookup for repeated mentions in chat rows. */
export async function resolveMentionUserCached(
  params: MentionUserRequest,
): Promise<MentionUser | null> {
  const key = cacheKey(params)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = resolveMentionUser(params)
    .then((value) => {
      cache.delete(key)
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
      while (cache.size > CACHE_LIMIT) deleteOldestEntry(cache)
      return value
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, request)
  return request
}
