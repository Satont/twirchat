import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { deleteOldestEntry } from './bounded-cache'

const log = logger('fossabot-commands')
const API_URL = 'https://fossabot.com/api/v2/cached/channels'
const CACHE_CAPACITY = 128
const CACHE_TTL_MS = 5 * 60_000
const RETRY_MS = 30_000
const REQUEST_TIMEOUT_MS = 5_000
const COMMAND_NAME = /^[^!/\s\p{C}]+$/u

const channelResponseSchema = z.object({
  channel: z.object({
    id: z.string().regex(/^\d+$/u),
    login: z.string(),
    provider: z.string(),
    provider_id: z.string(),
  }),
})
const commandSchema = z.object({
  name: z.string().regex(COMMAND_NAME),
  aliases: z.array(z.string()),
  role_ids: z.array(z.string()),
  enabled_offline: z.boolean(),
  enabled_online: z.boolean(),
})
const commandsResponseSchema = z.object({ commands: z.array(z.unknown()) })

export interface FossabotCommand {
  name: string
  aliasFor?: string
}

export interface FossabotCommandTarget {
  channelLogin: string
  twitchChannelId?: string
}

interface CachedCommands {
  commands: readonly FossabotCommand[]
  expiresAt: number
  pending?: Promise<readonly FossabotCommand[]>
}

interface FossabotCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

function parsePublicCommands(raw: unknown): readonly FossabotCommand[] {
  const { commands } = commandsResponseSchema.parse(raw)
  const suggestions = new Map<string, FossabotCommand>()
  const publicCommands = commands.flatMap((command) => {
    const parsed = commandSchema.safeParse(command)
    if (!parsed.success) return []
    const data = parsed.data
    return data.role_ids.length === 0 && (data.enabled_online || data.enabled_offline) ? [data] : []
  })
  for (const { name } of publicCommands) {
    const key = name.toLowerCase()
    if (!suggestions.has(key)) suggestions.set(key, { name })
  }
  for (const { name, aliases } of publicCommands) {
    for (const alias of aliases) {
      const key = alias.toLowerCase()
      if (COMMAND_NAME.test(alias) && !suggestions.has(key))
        suggestions.set(key, { name: alias, aliasFor: name })
    }
  }
  return [...suggestions.values()]
}

export function createFossabotCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: FossabotCommandsClientOptions = {}) {
  const cache = new Map<string, CachedCommands>()

  function request(path: string): Promise<Response> {
    return fetcher(`${API_URL}${path}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }

  async function load(
    lookupPath: string,
    { channelLogin, twitchChannelId }: FossabotCommandTarget,
  ): Promise<readonly FossabotCommand[]> {
    const channelResponse = await request(lookupPath)
    if (channelResponse.status === 404) return []
    if (!channelResponse.ok)
      throw new Error(`Fossabot channel lookup: HTTP ${channelResponse.status}`)
    const { channel } = channelResponseSchema.parse(await channelResponse.json())
    if (
      channel.provider !== 'twitch' ||
      (twitchChannelId
        ? channel.provider_id !== twitchChannelId
        : channel.login.toLowerCase() !== channelLogin)
    )
      return []

    const response = await request(`/${channel.id}/commands`)
    if (!response.ok) throw new Error(`Fossabot command lookup: HTTP ${response.status}`)
    return parsePublicCommands(await response.json())
  }

  return ({
    channelLogin,
    twitchChannelId,
  }: FossabotCommandTarget): Promise<readonly FossabotCommand[]> => {
    const login = channelLogin.toLowerCase()
    if (!twitchChannelId && !/^[a-z0-9_]+$/u.test(login)) return Promise.resolve([])
    const key = twitchChannelId
      ? `/by-provider-id/twitch/${encodeURIComponent(twitchChannelId)}`
      : `/by-slug/${encodeURIComponent(login)}`
    const entry: CachedCommands = cache.get(key) ?? { commands: [], expiresAt: 0 }
    if (entry.pending) return entry.pending
    if (entry.expiresAt > now()) return Promise.resolve(entry.commands)

    entry.pending = load(key, { channelLogin: login, twitchChannelId }).then(
      (commands) => {
        entry.commands = commands
        entry.expiresAt = now() + CACHE_TTL_MS
        entry.pending = undefined
        return commands
      },
      (error: unknown) => {
        entry.expiresAt = now() + RETRY_MS
        entry.pending = undefined
        log.debug('Fossabot commands unavailable', { target: key, error: String(error) })
        return entry.commands
      },
    )
    cache.delete(key)
    if (cache.size >= CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return entry.pending
  }
}
