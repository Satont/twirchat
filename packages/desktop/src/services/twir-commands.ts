import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { deleteOldestEntry } from './bounded-cache'
import { readPublicBotJson } from './public-bot-commands'
import {
  createTwirChannelLookup,
  requestTwir,
  TWIR_CACHE_CAPACITY,
  TWIR_RETRY_MS,
  type TwirChannelLookupOptions,
} from './twir-api'
import type { TwirChannelTarget } from './twir-channels'

const log = logger('twir-commands')
const CACHE_TTL_MS = 5 * 60_000
const COMMAND_NAME = /^[^\s\p{Cc}]+(?: [^\s\p{Cc}]+)*$/u

const commandSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
})
const commandsSchema = z.array(commandSchema)

export type TwirCommand = z.infer<typeof commandSchema>

interface CachedCommands {
  commands: readonly TwirCommand[]
  expiresAt: number
  pending?: {
    result: Promise<readonly TwirCommand[]>
    fallback: Promise<readonly TwirCommand[]>
  }
}

export interface TwirCommandsOptions {
  refresh?: boolean
}

interface TwirCommandsClientOptions extends TwirChannelLookupOptions {
  lookupChannel?: ReturnType<typeof createTwirChannelLookup>
}

export function createTwirCommandsClient({
  fetcher = fetch,
  resolveChannelId,
  now = Date.now,
  lookupChannel = createTwirChannelLookup({ fetcher, now, resolveChannelId }),
}: TwirCommandsClientOptions = {}) {
  const cache = new Map<string, CachedCommands>()

  async function load(
    targets: readonly TwirChannelTarget[],
    refresh: boolean,
  ): Promise<readonly TwirCommand[]> {
    const channelId = await lookupChannel(targets, refresh)
    if (!channelId) return []

    const commands = await requestTwir(fetcher, `/v2/channels/${channelId}/commands`)
    if (!commands.ok)
      throw new Error(t('notices.twirCommands.commandLookup', { status: commands.status }))
    return commandsSchema
      .parse(await readPublicBotJson(commands))
      .filter(({ name }) => name.isWellFormed() && COMMAND_NAME.test(name))
  }

  return (
    targets: readonly TwirChannelTarget[],
    { refresh = false }: TwirCommandsOptions = {},
  ): Promise<readonly TwirCommand[]> => {
    const key = JSON.stringify(
      targets.map((target) =>
        'platformChannelId' in target
          ? [target.platform, 'id', target.platformChannelId]
          : [target.platform, 'slug', target.channelSlug],
      ),
    )
    const entry: CachedCommands = cache.get(key) ?? { commands: [], expiresAt: 0 }
    if (entry.pending) return refresh ? entry.pending.result : entry.pending.fallback
    if (!refresh && entry.expiresAt > now()) return Promise.resolve(entry.commands)

    const previous = entry.commands
    const result = load(targets, refresh).then(
      (commands) => {
        entry.commands = commands
        entry.expiresAt = now() + CACHE_TTL_MS
        entry.pending = undefined
        return commands
      },
      (error: unknown) => {
        entry.expiresAt = now() + TWIR_RETRY_MS
        entry.pending = undefined
        log.debug('Twir commands unavailable', { target: key, error: String(error) })
        if (error instanceof z.ZodError) throw new Error(t('notices.twirCommands.invalidResponse'))
        throw error
      },
    )
    const fallback = result.catch(() => previous)
    entry.pending = { result, fallback }
    cache.delete(key)
    if (cache.size >= TWIR_CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return refresh ? result : fallback
  }
}
