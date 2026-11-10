import { logger } from '@twirchat/shared/logger'

import { deleteOldestEntry } from './bounded-cache'

const CACHE_CAPACITY = 128
const CACHE_TTL_MS = 5 * 60_000
const RETRY_MS = 30_000

export const PUBLIC_BOT_COMMAND_NAME = /^[^!/\s\p{C}]+$/u
export const PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS = 5_000
export const TWITCH_CHANNEL_LOGIN = /^[a-z0-9_]+$/u

export interface PublicBotCommand {
  name: string
  aliasFor?: string
}

interface CachedCommands {
  commands: readonly PublicBotCommand[]
  expiresAt: number
  pending?: Promise<readonly PublicBotCommand[]>
}

export function createPublicBotCommandsCache(provider: string, now: () => number) {
  const log = logger(`${provider}-commands`)
  const cache = new Map<string, CachedCommands>()

  return (
    key: string,
    load: () => Promise<readonly PublicBotCommand[]>,
  ): Promise<readonly PublicBotCommand[]> => {
    const entry: CachedCommands = cache.get(key) ?? { commands: [], expiresAt: 0 }
    if (entry.pending) return entry.pending
    if (entry.expiresAt > now()) return Promise.resolve(entry.commands)

    entry.pending = load().then(
      (commands) => {
        entry.commands = commands
        entry.expiresAt = now() + CACHE_TTL_MS
        entry.pending = undefined
        return commands
      },
      (error: unknown) => {
        entry.expiresAt = now() + RETRY_MS
        entry.pending = undefined
        log.debug('Public commands unavailable', { target: key, error: String(error) })
        return entry.commands
      },
    )
    cache.delete(key)
    if (cache.size >= CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return entry.pending
  }
}
