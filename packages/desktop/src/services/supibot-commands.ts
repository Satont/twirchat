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

const API_URL = 'https://supinic.com/api/bot'
const COMMAND_NAME = /^[^\s\p{C}]{1,64}$/u
const MAX_CHANNELS = 20_000
const MAX_CATALOG_COMMANDS = 2000
const MAX_USER_ALIASES = 1000

const responseSchema = z.object({
  statusCode: z.literal(200).optional(),
  data: z.array(z.unknown()),
})
const nameSchema = z.string().trim().regex(COMMAND_NAME)
const channelSchema = z.object({
  name: z.string().trim().toLowerCase().regex(TWITCH_CHANNEL_LOGIN),
  platformName: z.string().toLowerCase().pipe(z.literal('twitch')),
  mode: z.string().toLowerCase(),
})
const commandSchema = z.object({
  name: nameSchema,
  aliases: z.array(z.unknown()).optional(),
  description: z.string().nullish(),
})
const userAliasSchema = z.object({
  name: nameSchema,
  invocation: z.string().nullish(),
  description: z.string().nullish(),
})

export interface SupibotCommandTarget {
  channelLogin: string
  userLogin?: string
}

function readChannels(raw: unknown): ReadonlySet<string> {
  const { data } = responseSchema.parse(raw)
  const channels = new Set<string>()
  for (const row of data.slice(0, MAX_CHANNELS)) {
    const parsed = channelSchema.safeParse(row)
    if (!parsed.success) continue
    const { name, mode } = parsed.data
    if (mode !== 'read' && mode !== 'last seen') channels.add(name)
  }
  return channels
}

function readCatalog(raw: unknown): readonly PrefixedBotCommand[] {
  const { data } = responseSchema.parse(raw)
  const entries = data.slice(0, MAX_CATALOG_COMMANDS).flatMap((row) => {
    const parsed = commandSchema.safeParse(row)
    if (!parsed.success) return []
    const { name, aliases, description } = parsed.data
    return [{ name, aliases, description: description?.trim().slice(0, 512) }]
  })
  return expandPublicBotCatalog(entries, COMMAND_NAME).map(({ name, aliasFor, description }) => ({
    prefix: '$',
    name,
    aliasFor,
    description,
  }))
}

function readAliases(raw: unknown): readonly PrefixedBotCommand[] {
  const { data } = responseSchema.parse(raw)
  const aliases = new Map<string, PrefixedBotCommand>()
  for (const row of data.slice(0, MAX_USER_ALIASES)) {
    const parsed = userAliasSchema.safeParse(row)
    if (!parsed.success) continue
    const { name, invocation, description } = parsed.data
    const key = name.toLowerCase()
    if (aliases.has(key)) continue
    const target = invocation?.trim()
    const fallback = target && COMMAND_NAME.test(target) ? `$${target}` : undefined
    aliases.set(key, {
      prefix: '$$',
      name,
      description: description?.trim().slice(0, 512) || fallback,
    })
  }
  return [...aliases.values()]
}

export function createSupibotCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: PublicBotCommandsClientOptions = {}) {
  const getChannels = createPublicBotDataCache<ReadonlySet<string>>(
    'supibot-channels',
    now,
    new Set(),
  )
  const getCommands = createPublicBotDataCache<readonly PrefixedBotCommand[]>('supibot', now, [])
  const getAliases = createPublicBotDataCache<readonly PrefixedBotCommand[]>(
    'supibot-aliases',
    now,
    [],
  )

  async function loadChannels() {
    const response = await requestPublicBot(fetcher, `${API_URL}/channel/list?platformName=twitch`)
    if (!response.ok) throw new Error(`Supibot channel lookup: HTTP ${response.status}`)
    return readChannels(await readPublicBotJson(response, 8 * 1024 * 1024))
  }

  async function loadCommands() {
    const response = await requestPublicBot(fetcher, `${API_URL}/command/list/`)
    if (!response.ok) throw new Error(`Supibot command lookup: HTTP ${response.status}`)
    return readCatalog(await readPublicBotJson(response))
  }

  async function loadAliases(login: string) {
    const response = await requestPublicBot(fetcher, `${API_URL}/user/${login}/alias/list/`)
    if (response.status === 404) return []
    if (!response.ok) throw new Error(`Supibot alias lookup: HTTP ${response.status}`)
    return readAliases(await readPublicBotJson(response))
  }

  return async ({
    channelLogin,
    userLogin,
  }: SupibotCommandTarget): Promise<readonly PrefixedBotCommand[]> => {
    const channel = channelLogin.toLowerCase()
    if (!TWITCH_CHANNEL_LOGIN.test(channel)) return []
    const channels = await getChannels('twitch', loadChannels)
    if (!channels.has(channel)) return []

    const login = userLogin?.toLowerCase()
    const [commands, aliases] = await Promise.all([
      getCommands('catalog', loadCommands),
      login && TWITCH_CHANNEL_LOGIN.test(login) ? getAliases(login, () => loadAliases(login)) : [],
    ])
    return aliases.length ? [...commands, ...aliases] : commands
  }
}
