import { logger } from '@twirchat/shared/logger'

import { deleteOldestEntry } from './bounded-cache'

const CACHE_CAPACITY = 128
const CACHE_TTL_MS = 5 * 60_000
const RETRY_MS = 30_000
const MAX_CATALOG_ALIASES = 5000

export const PUBLIC_BOT_COMMAND_NAME = /^[^!/\s\p{C}]+$/u
export const PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS = 5_000
export const TWITCH_CHANNEL_LOGIN = /^[a-z0-9_]+$/u

export interface PublicBotCommand {
  name: string
  aliasFor?: string
}

export interface PrefixedBotCommand extends PublicBotCommand {
  prefix: string
  description?: string
}

export interface PublicBotCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

interface CatalogEntry {
  name: string
  aliases?: readonly unknown[]
  description?: string
}

export function expandPublicBotCatalog(
  entries: readonly CatalogEntry[],
  namePattern: RegExp,
): Omit<PrefixedBotCommand, 'prefix'>[] {
  const commands = new Map<string, Omit<PrefixedBotCommand, 'prefix'>>()
  for (const { name, description } of entries) {
    const key = name.toLowerCase()
    if (!commands.has(key)) commands.set(key, { name, description })
  }
  const limit = commands.size + MAX_CATALOG_ALIASES
  for (const { name, aliases = [] } of entries) {
    for (const value of aliases) {
      if (commands.size >= limit) return [...commands.values()]
      if (typeof value !== 'string') continue
      const alias = value.trim()
      const key = alias.toLowerCase()
      if (namePattern.test(alias) && !commands.has(key)) {
        commands.set(key, { name: alias, aliasFor: name })
      }
    }
  }
  return [...commands.values()]
}

export function requestPublicBot(
  fetcher: NonNullable<PublicBotCommandsClientOptions['fetcher']>,
  url: string,
): Promise<Response> {
  return fetcher(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS),
  })
}

export async function readPublicBotJson(
  response: Response,
  maxBytes = 2 * 1024 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Public bot response has no body')
  const decoder = new TextDecoder()
  let bytes = 0
  let content = ''
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- check the size before pulling the next chunk.
      const { value, done } = await reader.read()
      if (done) return JSON.parse(content + decoder.decode())
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('Public bot response is too large')
      content += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

interface CachedBotData<Data> {
  data: Data
  expiresAt: number
  pending?: Promise<Data>
}

export function createPublicBotCommandsCache(provider: string, now: () => number) {
  return createPublicBotDataCache<readonly PublicBotCommand[]>(provider, now, [])
}

export function createPublicBotDataCache<Data>(provider: string, now: () => number, empty: Data) {
  const log = logger(`${provider}-commands`)
  const cache = new Map<string, CachedBotData<Data>>()

  return (key: string, load: () => Promise<Data>): Promise<Data> => {
    const entry = cache.get(key) ?? { data: empty, expiresAt: 0 }
    if (entry.pending) return entry.pending
    if (entry.expiresAt > now()) return Promise.resolve(entry.data)

    entry.pending = load().then(
      (data) => {
        entry.data = data
        entry.expiresAt = now() + CACHE_TTL_MS
        entry.pending = undefined
        return data
      },
      (error: unknown) => {
        entry.expiresAt = now() + RETRY_MS
        entry.pending = undefined
        log.debug('Public commands unavailable', { target: key, error: String(error) })
        return entry.data
      },
    )
    cache.delete(key)
    if (cache.size >= CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return entry.pending
  }
}
