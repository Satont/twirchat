import { z } from 'zod'

import { t } from '../i18n'
import { backendFetch } from '../runtime-config'
import { deleteOldestEntry } from './bounded-cache'
import { resolveMentionUser } from './mention-user'
import { resolveTwitchChannel } from './native-emotes'
import { readPublicBotJson, requestPublicBot } from './public-bot-commands'
import type { TwirChannelSlug, TwirChannelTarget } from './twir-channels'

const API_URL = 'https://twir.app/api'
export const TWIR_CACHE_CAPACITY = 128
const CHANNEL_TTL_MS = 5 * 60_000
export const TWIR_RETRY_MS = 30_000

const channelIdSchema = z.uuid().brand<'TwirChannelId'>()
const channelSchema = z.object({ channel_id: channelIdSchema })

export type TwirChannelId = z.infer<typeof channelIdSchema>

export interface TwirRequestOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

export function requestTwir(
  fetcher: NonNullable<TwirRequestOptions['fetcher']>,
  path: string,
): Promise<Response> {
  return requestPublicBot(fetcher, `${API_URL}${path}`)
}

interface CachedResponse<Value> {
  result: Promise<Value>
  expiresAt: number
}

export function createTwirResponseCache<Value>({
  now,
  ttlMs,
}: {
  now: () => number
  ttlMs: number
}) {
  const cache = new Map<string, CachedResponse<Value>>()
  return (key: string, load: () => Promise<Value>, refresh = false): Promise<Value> => {
    const cached = cache.get(key)
    if (cached && (cached.expiresAt === Infinity || (!refresh && cached.expiresAt > now())))
      return cached.result

    const entry: CachedResponse<Value> = {
      result: load().then(
        (value) => {
          entry.expiresAt = now() + ttlMs
          return value
        },
        (error: unknown) => {
          entry.expiresAt = now() + TWIR_RETRY_MS
          throw error
        },
      ),
      expiresAt: Infinity,
    }
    cache.delete(key)
    if (cache.size >= TWIR_CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return entry.result
  }
}

export interface TwirChannelLookupOptions extends TwirRequestOptions {
  resolveChannelId?: (target: TwirChannelSlug) => Promise<string | null>
}

async function resolvePlatformChannelId({
  platform,
  channelSlug,
}: TwirChannelSlug): Promise<string | null> {
  if (platform === 'twitch') return (await resolveTwitchChannel(channelSlug)).platformUserId
  if (/^UC[A-Za-z0-9_-]{22}$/u.test(channelSlug)) return channelSlug
  const channel = await resolveMentionUser({ platform, username: channelSlug }, (path) =>
    backendFetch(path, { signal: AbortSignal.timeout(5_000) }),
  )
  return channel?.platformUserId ?? null
}

export function createTwirChannelLookup({
  fetcher = fetch,
  resolveChannelId = resolvePlatformChannelId,
  now = Date.now,
}: TwirChannelLookupOptions = {}) {
  const lookupSlug = createTwirResponseCache<string | null>({ now, ttlMs: CHANNEL_TTL_MS })
  const lookupId = createTwirResponseCache<TwirChannelId | null>({ now, ttlMs: CHANNEL_TTL_MS })

  async function load(platform: string, id: string): Promise<TwirChannelId | null> {
    const response = await requestTwir(
      fetcher,
      `/v1/channels/by-platform/${platform}/${encodeURIComponent(id)}`,
    )
    if (response.status === 404) return null
    if (!response.ok)
      throw new Error(t('notices.twirCommands.channelLookup', { status: response.status }))
    return channelSchema.parse(await readPublicBotJson(response, 4_096)).channel_id
  }

  async function lookupTarget(target: TwirChannelTarget, refresh: boolean) {
    const id =
      'platformChannelId' in target
        ? target.platformChannelId
        : await lookupSlug(
            `${target.platform}:${target.channelSlug}`,
            () => resolveChannelId(target),
            refresh,
          )
    if (!id) return null
    const platform = target.platform === 'vkplay' ? 'vk_video_live' : target.platform
    return lookupId(`${platform}:${id}`, () => load(platform, id), refresh)
  }

  return async (
    targets: readonly TwirChannelTarget[],
    refresh = false,
  ): Promise<TwirChannelId | null> => {
    for (const target of targets) {
      // oxlint-disable-next-line no-await-in-loop -- only look up lower-priority targets on a miss.
      const channel = await lookupTarget(target, refresh)
      if (channel) return channel
    }
    return null
  }
}
