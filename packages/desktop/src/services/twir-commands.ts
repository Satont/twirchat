import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import { resolveMentionUser } from './mention-user'
import { resolveTwitchChannel } from './native-emotes'

const log = logger('twir-commands')
const API_URL = 'https://twir.app/api'
const CACHE_CAPACITY = 128
const CACHE_TTL_MS = 5 * 60_000
const RETRY_MS = 30_000
const REQUEST_TIMEOUT_MS = 5_000

const channelSchema = z.object({ channel_id: z.uuid() })
const commandSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
})
const commandsSchema = z.array(commandSchema)

export type TwirCommand = z.infer<typeof commandSchema>
type TwirCommandChannelSlug = { platform: 'twitch' | 'youtube'; channelSlug: string }
export type TwirCommandTarget =
  | { platform: Platform; platformChannelId: string }
  | TwirCommandChannelSlug

interface CachedCommands {
  result: Promise<readonly TwirCommand[]>
  expiresAt: number
}

interface TwirCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  resolveChannelId?: (target: TwirCommandChannelSlug) => Promise<string | null>
  now?: () => number
}

async function resolvePlatformChannelId({
  platform,
  channelSlug,
}: TwirCommandChannelSlug): Promise<string | null> {
  if (platform === 'twitch') return (await resolveTwitchChannel(channelSlug)).platformUserId
  if (/^UC[A-Za-z0-9_-]{22}$/u.test(channelSlug)) return channelSlug
  const channel = await resolveMentionUser({ platform, username: channelSlug }, (path) =>
    backendFetch(path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  )
  return channel?.platformUserId ?? null
}

export function createTwirCommandsClient({
  fetcher = fetch,
  resolveChannelId = resolvePlatformChannelId,
  now = Date.now,
}: TwirCommandsClientOptions = {}) {
  const cache = new Map<string, CachedCommands>()

  function request(path: string): Promise<Response> {
    return fetcher(`${API_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  }

  async function load(target: TwirCommandTarget): Promise<readonly TwirCommand[]> {
    const id =
      'platformChannelId' in target ? target.platformChannelId : await resolveChannelId(target)
    if (!id) return []
    const channel = await request(
      `/v1/channels/by-platform/${target.platform}/${encodeURIComponent(id)}`,
    )
    if (channel.status === 404) return []
    if (!channel.ok) throw new Error(`Twir channel lookup: HTTP ${channel.status}.`)
    const { channel_id: uuid } = channelSchema.parse(await channel.json())

    const commands = await request(`/v2/channels/${uuid}/commands`)
    if (!commands.ok) throw new Error(`Twir command lookup: HTTP ${commands.status}.`)
    return commandsSchema
      .parse(await commands.json())
      .filter(({ name }) => name.length > 0 && name.isWellFormed() && !/\s/u.test(name))
  }

  return (target: TwirCommandTarget): Promise<readonly TwirCommand[]> => {
    const key =
      'platformChannelId' in target
        ? `${target.platform}:id:${target.platformChannelId}`
        : `${target.platform}:slug:${target.channelSlug}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return cached.result

    cache.delete(key)
    if (cache.size >= CACHE_CAPACITY) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    const entry: CachedCommands = {
      expiresAt: Infinity,
      result: load(target).then(
        (commands) => {
          entry.expiresAt = now() + CACHE_TTL_MS
          return commands
        },
        (error: unknown) => {
          entry.expiresAt = now() + RETRY_MS
          log.debug('Twir commands unavailable', { target: key, error: String(error) })
          return []
        },
      ),
    }
    cache.set(key, entry)
    return entry.result
  }
}
