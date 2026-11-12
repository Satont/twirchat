import { z } from 'zod'

import {
  createPublicBotDataCache,
  expandPublicBotCatalog,
  readPublicBotJson,
  requestPublicBot,
  TWITCH_CHANNEL_LOGIN,
  type PrefixedBotCommand,
  type PublicBotCommandsClientOptions,
} from './public-bot-commands'

const API_URL = 'https://api.potat.app'
const DEFAULT_PREFIX = '#'
const MAX_PREFIXES = 8
const MAX_CATALOG_COMMANDS = 1000
const MAX_CHANNEL_COMMANDS = 200
const COMMAND_NAME = /^[\w-]{1,64}$/u
const PREFIX = /^[^\s\p{C}]{1,16}$/u
const LITERAL_TRIGGER = /^[^.\\+*?[\](){}|^$\s\p{C}]{1,64}$/u
const PREFIX_MARKS = /^[^\p{L}\p{N}]+/u

const catalogSchema = z.array(z.unknown())
const catalogEntrySchema = z.object({
  name: z.string().trim().regex(COMMAND_NAME),
  aliases: z.array(z.unknown()).optional(),
  usage: z.string().optional(),
  isDisabled: z.boolean().optional(),
})
const channelSchema = z.object({
  data: z.array(
    z.object({
      channel: z
        .object({
          state: z.string(),
          settings: z.object({ prefix: z.unknown().optional() }).nullish(),
          commands: z.array(z.unknown()).nullish(),
        })
        .nullish(),
    }),
  ),
})
const customCommandSchema = z.object({
  active: z.literal(true),
  expires_at: z.string().nullish(),
  user_trigger_ids: z.array(z.unknown()).nullish(),
  trigger: z.string().nullish(),
  name: z.string().nullish(),
  help: z.string().nullish(),
})

interface PotatChannel {
  prefixes: readonly string[]
  commands: readonly PrefixedBotCommand[]
}

function readCatalog(raw: unknown) {
  const rows = catalogSchema.parse(raw).slice(0, MAX_CATALOG_COMMANDS)
  return expandPublicBotCatalog(
    rows.flatMap((row) => {
      const parsed = catalogEntrySchema.safeParse(row)
      if (!parsed.success || parsed.data.isDisabled) return []
      const { name, aliases, usage } = parsed.data
      return [{ name, aliases, description: usage?.trim().slice(0, 512) }]
    }),
    COMMAND_NAME,
  )
}

function readPrefixes(raw: unknown): string[] {
  const prefixes = new Map<string, string>()
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (typeof value !== 'string') continue
    const prefix = value.trim()
    const key = prefix.toLowerCase()
    if (PREFIX.test(prefix) && !prefixes.has(key)) prefixes.set(key, prefix)
    if (prefixes.size >= MAX_PREFIXES) break
  }
  return prefixes.size ? [...prefixes.values()] : [DEFAULT_PREFIX]
}

function readLiteralTrigger(trigger: string): string {
  const pattern = trigger.startsWith('/') && trigger.endsWith('/') ? trigger.slice(1, -1) : trigger
  if (!pattern.startsWith('^')) return ''
  return pattern.slice(1).replace(/\$$/u, '')
}

function readCustomCommands(
  rows: readonly unknown[],
  prefixes: readonly string[],
  now: number,
): PrefixedBotCommand[] {
  const commands: PrefixedBotCommand[] = []
  for (const row of rows.slice(0, MAX_CHANNEL_COMMANDS)) {
    const parsed = customCommandSchema.safeParse(row)
    if (!parsed.success) continue
    const { expires_at: expiresAt, user_trigger_ids: userIds, trigger, name, help } = parsed.data
    if (userIds?.length || (expiresAt?.trim() && !(Date.parse(expiresAt) > now))) continue
    const description = help?.trim().slice(0, 512)
    const pattern = trigger?.trim()
    const literal = pattern ? readLiteralTrigger(pattern) : (name?.trim() ?? '')
    if (!pattern && literal.startsWith('{any}')) {
      const commandName = literal.slice('{any}'.length)
      if (LITERAL_TRIGGER.test(commandName)) {
        for (const prefix of prefixes) commands.push({ prefix, name: commandName, description })
      }
      continue
    }
    if (!LITERAL_TRIGGER.test(literal)) continue
    const lower = literal.toLowerCase()
    const matchedPrefix =
      prefixes.find((prefix) => lower.startsWith(prefix.toLowerCase())) ??
      literal.match(PREFIX_MARKS)?.[0]
    if (matchedPrefix && matchedPrefix.length < literal.length) {
      commands.push({
        prefix: literal.slice(0, matchedPrefix.length),
        name: literal.slice(matchedPrefix.length),
        description,
      })
    }
  }
  return commands
}

export function createPotatCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: PublicBotCommandsClientOptions = {}) {
  const getCatalog = createPublicBotDataCache<ReturnType<typeof readCatalog>>(
    'potat-catalog',
    now,
    [],
  )
  const getChannel = createPublicBotDataCache<PotatChannel | undefined>(
    'potat-channel',
    now,
    undefined,
  )

  async function loadCatalog() {
    const response = await requestPublicBot(fetcher, `${API_URL}/help`)
    if (!response.ok) throw new Error(`Potat command lookup: HTTP ${response.status}`)
    return readCatalog(await readPublicBotJson(response))
  }

  async function loadChannel(login: string): Promise<PotatChannel | undefined> {
    const response = await requestPublicBot(fetcher, `${API_URL}/users/${login}`)
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`Potat channel lookup: HTTP ${response.status}`)
    const { data } = channelSchema.parse(await readPublicBotJson(response, 1024 * 1024))
    const channel = data[0]?.channel
    if (channel?.state !== 'JOINED') return undefined
    const prefixes = readPrefixes(channel.settings?.prefix).toSorted((a, b) => b.length - a.length)
    return {
      prefixes,
      commands: readCustomCommands(channel.commands ?? [], prefixes, now()),
    }
  }

  return async (channelLogin: string): Promise<readonly PrefixedBotCommand[]> => {
    const login = channelLogin.toLowerCase()
    if (!TWITCH_CHANNEL_LOGIN.test(login)) return []
    const channel = await getChannel(login, () => loadChannel(login))
    if (!channel) return []
    const catalog = await getCatalog('help', loadCatalog)
    const commands = new Map<string, PrefixedBotCommand>()
    for (const prefix of channel.prefixes) {
      for (const command of catalog) {
        const key = (prefix + command.name).toLowerCase()
        if (!commands.has(key)) commands.set(key, { prefix, ...command })
      }
    }
    for (const command of channel.commands) {
      const key = (command.prefix + command.name).toLowerCase()
      if (!commands.has(key)) commands.set(key, command)
    }
    return [...commands.values()]
  }
}
