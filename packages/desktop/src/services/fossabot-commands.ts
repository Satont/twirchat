import { z } from 'zod'

import {
  createPublicBotCommandsCache,
  PUBLIC_BOT_COMMAND_NAME,
  PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS,
  TWITCH_CHANNEL_LOGIN,
  type PublicBotCommand,
} from './public-bot-commands'

const API_URL = 'https://fossabot.com/api/v2/cached/channels'

const channelResponseSchema = z.object({
  channel: z.object({
    id: z.string().regex(/^\d+$/u),
    login: z.string(),
    provider: z.string(),
    provider_id: z.string(),
  }),
})
const commandSchema = z.object({
  name: z.string().regex(PUBLIC_BOT_COMMAND_NAME),
  aliases: z.array(z.string()),
  role_ids: z.array(z.string()),
  enabled_offline: z.boolean(),
  enabled_online: z.boolean(),
})
const commandsResponseSchema = z.object({ commands: z.array(z.unknown()) })

export interface FossabotCommandTarget {
  channelLogin: string
  twitchChannelId?: string
}

interface FossabotCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

function parsePublicCommands(raw: unknown): readonly PublicBotCommand[] {
  const { commands } = commandsResponseSchema.parse(raw)
  const suggestions = new Map<string, PublicBotCommand>()
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
      if (PUBLIC_BOT_COMMAND_NAME.test(alias) && !suggestions.has(key))
        suggestions.set(key, { name: alias, aliasFor: name })
    }
  }
  return [...suggestions.values()]
}

export function createFossabotCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: FossabotCommandsClientOptions = {}) {
  const getCachedCommands = createPublicBotCommandsCache('fossabot', now)

  function request(path: string): Promise<Response> {
    return fetcher(`${API_URL}${path}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: AbortSignal.timeout(PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS),
    })
  }

  async function load(
    lookupPath: string,
    { channelLogin, twitchChannelId }: FossabotCommandTarget,
  ): Promise<readonly PublicBotCommand[]> {
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
  }: FossabotCommandTarget): Promise<readonly PublicBotCommand[]> => {
    const login = channelLogin.toLowerCase()
    if (!twitchChannelId && !TWITCH_CHANNEL_LOGIN.test(login)) return Promise.resolve([])
    const key = twitchChannelId
      ? `/by-provider-id/twitch/${encodeURIComponent(twitchChannelId)}`
      : `/by-slug/${encodeURIComponent(login)}`
    return getCachedCommands(key, () => load(key, { channelLogin: login, twitchChannelId }))
  }
}
