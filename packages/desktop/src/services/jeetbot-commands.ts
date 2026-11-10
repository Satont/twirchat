import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { deleteOldestEntry } from './bounded-cache'

const log = logger('jeetbot-commands')
const API_URL = 'https://api.jeetbot.app/api/v2/public/extension_helper/'
const CACHE_CAPACITY = 128
// The command list changes rarely and the API itself caches for an hour: keep a fetched list for
// half a day and back off for minutes after a failure, so typing `!` never floods the API.
const CACHE_TTL_MS = 12 * 60 * 60_000
const RETRY_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 5_000
const COMMAND_ALIAS = /^!([^\s\p{Cc}]+)$/u

const optionSchema = z.union([
  z.string().transform((value) => ({ value, label: value, aliases: [] })),
  z.object({
    value: z.string(),
    label: z.string(),
    aliases: z.array(z.string()).default([]),
  }),
])
const argumentSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(false),
  description: z.string().nullish(),
  suggestions: z.array(optionSchema).default([]),
  choices: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
})
const subcommandSchema = z.object({
  name: z.string().regex(/^[^\s\p{Cc}]+$/u),
  description: z.string().nullish(),
  args: z.array(argumentSchema).default([]),
})
const commandSchema = z.object({
  description: z.string().nullish(),
  aliases: z.array(z.string()),
  args: z.array(argumentSchema).default([]),
  subcommands: z.array(subcommandSchema).default([]),
})
const responseSchema = z.object({ commands: z.array(z.unknown()) })

export interface JeetbotArgumentOption {
  value: string
  label: string
  aliases: readonly string[]
}

export interface JeetbotArgument {
  name: string
  /** jeetbot's argument kind: `mention`, `voice`, `choice`, `duration`, `number`, `text`… */
  type: string
  required: boolean
  description: string
  options: readonly JeetbotArgumentOption[]
  examples: readonly string[]
}

export interface JeetbotSubcommand {
  name: string
  description: string
  args: readonly JeetbotArgument[]
}

export interface JeetbotCommand {
  /** Invocation names without `!`; the last one is the command's own prefix. */
  names: readonly string[]
  description: string
  args: readonly JeetbotArgument[]
  subcommands: readonly JeetbotSubcommand[]
}

export interface JeetbotCommandTarget {
  /** Twitch login of the chat the commands are typed in. */
  channelLogin: string
  /** Twitch user ID of the account that sends: jeetbot shows only commands it may run. */
  userId?: string
}

export interface JeetbotCommandsOptions {
  refresh?: boolean
}

interface CachedCommands {
  commands: readonly JeetbotCommand[]
  expiresAt: number
  pending?: {
    result: Promise<readonly JeetbotCommand[]>
    fallback: Promise<readonly JeetbotCommand[]>
  }
}

interface JeetbotCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

function toArgument(argument: z.infer<typeof argumentSchema>): JeetbotArgument {
  return {
    name: argument.name,
    type: argument.type,
    required: argument.required,
    description: argument.description ?? '',
    options: [
      ...argument.suggestions,
      ...argument.choices.map((value) => ({ value, label: value, aliases: [] })),
    ].filter(({ value }) => value.length > 0 && !/\s/u.test(value)),
    examples: argument.examples,
  }
}

function toCommand(raw: unknown): JeetbotCommand | null {
  const parsed = commandSchema.safeParse(raw)
  if (!parsed.success) return null
  const names = parsed.data.aliases.flatMap((alias) => {
    const name = alias.match(COMMAND_ALIAS)?.[1]
    return name?.isWellFormed() ? [name] : []
  })
  if (!names.length) return null
  return {
    names: [...new Set(names)],
    description: parsed.data.description ?? '',
    args: parsed.data.args.map(toArgument),
    subcommands: parsed.data.subcommands.map((subcommand) => ({
      name: subcommand.name,
      description: subcommand.description ?? '',
      args: subcommand.args.map(toArgument),
    })),
  }
}

export function createJeetbotCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: JeetbotCommandsClientOptions = {}) {
  const cache = new Map<string, CachedCommands>()

  async function load({
    channelLogin,
    userId,
  }: JeetbotCommandTarget): Promise<readonly JeetbotCommand[]> {
    const url = new URL(API_URL)
    url.searchParams.set('channel_name', channelLogin.toLowerCase())
    if (userId) url.searchParams.set('user_id', userId)
    const response = await fetcher(url.href, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    // The channel does not use jeetbot: an empty list, cached like any other answer.
    if (response.status === 404) return []
    if (!response.ok)
      throw new Error(t('notices.jeetbotCommands.lookup', { status: response.status }))
    const { commands } = responseSchema.parse(await response.json())
    return commands.flatMap((raw) => toCommand(raw) ?? [])
  }

  return (
    target: JeetbotCommandTarget,
    { refresh = false }: JeetbotCommandsOptions = {},
  ): Promise<readonly JeetbotCommand[]> => {
    const key = `${target.channelLogin.toLowerCase()}:${target.userId ?? ''}`
    const entry: CachedCommands = cache.get(key) ?? { commands: [], expiresAt: 0 }
    if (entry.pending) return refresh ? entry.pending.result : entry.pending.fallback
    if (!refresh && entry.expiresAt > now()) return Promise.resolve(entry.commands)

    const previous = entry.commands
    const result = load(target).then(
      (commands) => {
        entry.commands = commands
        entry.expiresAt = now() + CACHE_TTL_MS
        entry.pending = undefined
        return commands
      },
      (error: unknown) => {
        entry.expiresAt = now() + RETRY_MS
        entry.pending = undefined
        log.debug('jeetbot commands unavailable', { target: key, error: String(error) })
        if (error instanceof z.ZodError)
          throw new Error(t('notices.jeetbotCommands.invalidResponse'))
        throw error
      },
    )
    const fallback = result.catch(() => previous)
    entry.pending = { result, fallback }
    cache.delete(key)
    if (cache.size >= CACHE_CAPACITY) deleteOldestEntry(cache)
    cache.set(key, entry)
    return refresh ? result : fallback
  }
}
