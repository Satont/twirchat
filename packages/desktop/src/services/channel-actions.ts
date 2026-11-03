import type { Account, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

export interface PlayerCommand {
  executable: string
  arguments: string[]
}
export interface PlayerSettings {
  custom: PlayerCommand
  streamlink: PlayerCommand
}
export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  custom: { executable: '', arguments: ['{url}'] },
  streamlink: { executable: 'streamlink', arguments: ['{url}', 'best'] },
}
export const PLAYER_SETTINGS_KEY = 'player_settings_v1'
export function validatePlayerSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid player settings.')
  const validate = (input: unknown, name: string): PlayerCommand => {
    if (!input || typeof input !== 'object') throw new Error(`Invalid ${name} player command.`)
    const command = z
      .object({ executable: z.string(), arguments: z.array(z.string()) })
      .parse(input)
    if (
      typeof command.executable !== 'string' ||
      command.executable.length > 4096 ||
      /[\r\n\0]/.test(command.executable) ||
      !Array.isArray(command.arguments) ||
      command.arguments.length > 100 ||
      command.arguments.some(
        (argument) =>
          typeof argument !== 'string' ||
          argument.length > 8192 ||
          !argument ||
          /[\r\n\0]/.test(argument),
      )
    )
      throw new Error(`${name}: use an executable path and one nonempty argument per line.`)
    for (const argument of command.arguments)
      for (const token of argument.matchAll(/\{([^{}]+)\}/g))
        if (!['url', 'channel', 'platform'].includes(token[1] ?? ''))
          throw new Error(
            `Unknown player placeholder {${token[1]}}. Use {url}, {channel} or {platform}.`,
          )
    if (!command.arguments.some((argument) => argument.includes('{url}')))
      throw new Error(`${name}: include {url} in the argument list.`)
    return { executable: command.executable.trim(), arguments: [...command.arguments] }
  }
  const input = z.object({ custom: z.unknown(), streamlink: z.unknown() }).parse(value)
  return {
    custom: validate(input.custom, 'Custom'),
    streamlink: validate(input.streamlink, 'Streamlink'),
  }
}
export function channelPlayerUrl(platform: Platform, channelSlug: string): string {
  if (typeof channelSlug !== 'string') throw new Error('A channel is required.')
  const channel = channelSlug.trim().replace(/^#/, '')
  let url: string
  if (platform === 'twitch' && /^[a-z0-9_]{1,25}$/i.test(channel))
    url = `https://www.twitch.tv/${encodeURIComponent(channel)}`
  else if (platform === 'kick' && /^[a-z0-9_-]{1,50}$/i.test(channel))
    url = `https://kick.com/${encodeURIComponent(channel)}`
  else if (platform === 'youtube' && /^UC[A-Za-z0-9_-]{22}$/.test(channel))
    url = `https://www.youtube.com/channel/${channel}/live`
  else if (platform === 'youtube' && /^@?[\p{L}\p{N}._-]{1,100}$/u.test(channel))
    url = `https://www.youtube.com/@${encodeURIComponent(channel.replace(/^@/, ''))}/live`
  else throw new Error('Use a valid channel login, YouTube channel ID or @handle.')
  if (new URL(url).protocol !== 'https:') throw new Error('Player URLs must use HTTPS.')
  return url
}
export function playerArguments(
  command: PlayerCommand,
  platform: Platform,
  channel: string,
  url: string,
): string[] {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('Player URLs must use HTTP or HTTPS.')
  return [
    command.executable,
    ...command.arguments.map((argument) =>
      argument.replace(/\{(url|channel|platform)\}/g, (_, token: string) =>
        token === 'url' ? url : token === 'channel' ? channel : platform,
      ),
    ),
  ]
}
export interface ChannelActionDependencies {
  activeAccounts(): Account[]
  reconnectOwn(platform: Platform): Promise<void>
  reconnectWatched(id: string): Promise<void>
  reloadEmotes(
    platform: Platform,
    channelSlug: string,
    kind: 'channel' | 'subscriber',
  ): Promise<void>
  readPlayerSettings(): PlayerSettings
  writePlayerSettings(settings: PlayerSettings): Promise<void> | void
  openBrowser(url: string): Promise<void> | void
  spawnPlayer(argv: string[]): Promise<void>
}
export function createChannelActions(dependencies: ChannelActionDependencies) {
  return {
    async reconnectChat(params: { watchedChannelId?: string; platform?: Platform }): Promise<void> {
      if (params.watchedChannelId) {
        await dependencies.reconnectWatched(params.watchedChannelId)
        return
      }
      const platforms = [
        ...new Set(dependencies.activeAccounts().map((account) => account.platform)),
      ].filter((platform) => !params.platform || platform === params.platform)
      if (!platforms.length)
        throw new Error('Connect an account or select a watched channel before reconnecting.')
      const results = await Promise.allSettled(
        platforms.map((platform) => dependencies.reconnectOwn(platform)),
      )
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [`${platforms[index]}: ${String(result.reason)}`] : [],
      )
      if (failures.length) throw new Error(`Some chats could not reconnect: ${failures.join('; ')}`)
    },
    async reloadChatEmotes(params: {
      platform: Platform
      channelSlug: string
      kind?: 'channel' | 'subscriber'
    }): Promise<void> {
      channelPlayerUrl(params.platform, params.channelSlug)
      const kind = params.kind ?? 'channel'
      if (kind !== 'channel' && kind !== 'subscriber')
        throw new Error('Choose channel or subscriber emotes.')
      if (kind === 'subscriber') {
        const account = dependencies
          .activeAccounts()
          .find((account) => account.platform === params.platform)
        if (!account) throw new Error('Connect an account before reloading subscriber emotes.')
        if (params.platform !== 'twitch')
          throw new Error('Subscriber emote reload is supported for Twitch accounts.')
        if (!account.scopes.includes('user:read:emotes'))
          throw new Error(
            'Sign in to Twitch again with user:read:emotes permission to reload subscriber emotes.',
          )
      }
      await dependencies.reloadEmotes(params.platform, params.channelSlug, kind)
    },
    getPlayerSettings: (): PlayerSettings =>
      validatePlayerSettings(dependencies.readPlayerSettings()),
    async savePlayerSettings(settings: PlayerSettings): Promise<void> {
      await dependencies.writePlayerSettings(validatePlayerSettings(settings))
    },
    async openChannelPlayer(params: {
      platform: Platform
      channelSlug: string
      mode: 'browser' | 'custom' | 'streamlink'
    }): Promise<void> {
      const url = channelPlayerUrl(params.platform, params.channelSlug)
      if (params.mode === 'browser') {
        await dependencies.openBrowser(url)
        return
      }
      if (params.mode !== 'custom' && params.mode !== 'streamlink')
        throw new Error('Unknown player mode.')
      const command = validatePlayerSettings(dependencies.readPlayerSettings())[params.mode]
      if (!command.executable)
        throw new Error(`Configure the ${params.mode} executable in Player settings first.`)
      try {
        await dependencies.spawnPlayer(
          playerArguments(command, params.platform, params.channelSlug, url),
        )
      } catch (error) {
        throw new Error(
          `Could not launch ${params.mode} player “${command.executable}”. Install it or check Player settings. ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    },
  }
}
export type ChannelActions = ReturnType<typeof createChannelActions>

export async function spawnChannelPlayer(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  child.unref()
  const startup = await Promise.race([
    child.exited.then((code) => ({ code })),
    Bun.sleep(150).then(() => null),
  ])
  if (startup && startup.code !== 0) throw new Error(`Player exited with code ${startup.code}.`)
}
