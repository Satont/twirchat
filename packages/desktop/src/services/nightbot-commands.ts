import { z } from 'zod'

import {
  createPublicBotCommandsCache,
  PUBLIC_BOT_COMMAND_NAME,
  PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS,
  TWITCH_CHANNEL_LOGIN,
  type PublicBotCommand,
} from './public-bot-commands'

const API_URL = 'https://api.nightbot.tv/1'

const channelResponseSchema = z.object({
  channel: z
    .object({
      _id: z.string().regex(/^[a-f0-9]{24}$/iu),
      name: z.string(),
      provider: z.string(),
    })
    .transform(({ _id: id, name, provider }) => ({ id, name, provider })),
})
const commandSchema = z.object({
  name: z.string(),
  userLevel: z.literal('everyone'),
})
const commandsResponseSchema = z.object({ commands: z.array(z.unknown()) })

interface NightbotCommandsClientOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  now?: () => number
}

function parsePublicCommands(raw: unknown): readonly PublicBotCommand[] {
  const { commands } = commandsResponseSchema.parse(raw)
  const suggestions = new Map<string, PublicBotCommand>()
  for (const command of commands) {
    const parsed = commandSchema.safeParse(command)
    if (!parsed.success || !parsed.data.name.startsWith('!')) continue
    const name = parsed.data.name.slice(1)
    const key = name.toLowerCase()
    if (PUBLIC_BOT_COMMAND_NAME.test(name) && !suggestions.has(key)) suggestions.set(key, { name })
  }
  return [...suggestions.values()]
}

export function createNightbotCommandsClient({
  fetcher = fetch,
  now = Date.now,
}: NightbotCommandsClientOptions = {}) {
  const getCachedCommands = createPublicBotCommandsCache('nightbot', now)

  function request(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetcher(`${API_URL}${path}`, {
      headers: { Accept: 'application/json', ...headers },
      credentials: 'omit',
      signal: AbortSignal.timeout(PUBLIC_BOT_COMMAND_REQUEST_TIMEOUT_MS),
    })
  }

  async function load(login: string): Promise<readonly PublicBotCommand[]> {
    const channelResponse = await request(`/channels/twitch/${login}`)
    if (channelResponse.status === 404) return []
    if (!channelResponse.ok)
      throw new Error(`Nightbot channel lookup: HTTP ${channelResponse.status}`)
    const { channel } = channelResponseSchema.parse(await channelResponse.json())
    if (channel.provider !== 'twitch' || channel.name.toLowerCase() !== login) return []

    const response = await request('/commands', { 'Nightbot-Channel': channel.id })
    if (!response.ok) throw new Error(`Nightbot command lookup: HTTP ${response.status}`)
    return parsePublicCommands(await response.json())
  }

  return (channelLogin: string): Promise<readonly PublicBotCommand[]> => {
    const login = channelLogin.toLowerCase()
    if (!TWITCH_CHANNEL_LOGIN.test(login)) return Promise.resolve([])
    return getCachedCommands(login, () => load(login))
  }
}
