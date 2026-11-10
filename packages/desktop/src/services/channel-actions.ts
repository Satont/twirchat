import type { Account, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { t, type MessageKey } from '../gpuix/i18n'

type PlayerMode = 'custom' | 'streamlink'
const PLAYER_NAME_KEYS: Record<PlayerMode, MessageKey> = {
  custom: 'notices.channelActions.playerCustom',
  streamlink: 'notices.channelActions.playerStreamlink',
}
const playerName = (mode: PlayerMode): string => t(PLAYER_NAME_KEYS[mode])

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
  if (!value || typeof value !== 'object')
    throw new Error(t('notices.channelActions.invalidSettings'))
  const validate = (input: unknown, mode: PlayerMode): PlayerCommand => {
    if (!input || typeof input !== 'object')
      throw new Error(t('notices.channelActions.invalidCommand', { name: playerName(mode) }))
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
      throw new Error(t('notices.channelActions.commandHint', { name: playerName(mode) }))
    for (const argument of command.arguments)
      for (const token of argument.matchAll(/\{([^{}]+)\}/g))
        if (!['url', 'channel', 'platform'].includes(token[1] ?? ''))
          throw new Error(t('notices.channelActions.unknownPlaceholder', { token: token[1] ?? '' }))
    if (!command.arguments.some((argument) => argument.includes('{url}')))
      throw new Error(t('notices.channelActions.urlRequired', { name: playerName(mode) }))
    return { executable: command.executable.trim(), arguments: [...command.arguments] }
  }
  const input = z.object({ custom: z.unknown(), streamlink: z.unknown() }).parse(value)
  return {
    custom: validate(input.custom, 'custom'),
    streamlink: validate(input.streamlink, 'streamlink'),
  }
}
export function channelPlayerUrl(platform: Platform, channelSlug: string): string {
  if (typeof channelSlug !== 'string') throw new Error(t('notices.channelActions.channelRequired'))
  const channel = channelSlug.trim().replace(/^#/, '')
  let url: string
  if (platform === 'twitch' && /^[a-z0-9_]{1,25}$/i.test(channel))
    url = `https://www.twitch.tv/${encodeURIComponent(channel)}`
  else if (platform === 'kick' && /^[a-z0-9_-]{1,50}$/i.test(channel))
    url = `https://kick.com/${encodeURIComponent(channel)}`
  else if (platform === 'vkplay' && /^[a-z0-9_-]{3,50}$/i.test(channel))
    url = `https://live.vkvideo.ru/${encodeURIComponent(channel)}`
  else if (platform === 'youtube' && /^UC[A-Za-z0-9_-]{22}$/.test(channel))
    url = `https://www.youtube.com/channel/${channel}/live`
  else if (platform === 'youtube' && /^@?[\p{L}\p{N}._-]{1,100}$/u.test(channel))
    url = `https://www.youtube.com/@${encodeURIComponent(channel.replace(/^@/, ''))}/live`
  else throw new Error(t('notices.channelActions.invalidChannel'))
  if (new URL(url).protocol !== 'https:') throw new Error(t('notices.channelActions.httpsRequired'))
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
    throw new Error(t('notices.channelActions.httpRequired'))
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
      if (!platforms.length) throw new Error(t('notices.channelActions.reconnectNoAccount'))
      const results = await Promise.allSettled(
        platforms.map((platform) => dependencies.reconnectOwn(platform)),
      )
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected' ? [`${platforms[index]}: ${String(result.reason)}`] : [],
      )
      if (failures.length)
        throw new Error(
          t('notices.channelActions.reconnectFailed', { failures: failures.join('; ') }),
        )
    },
    async reloadChatEmotes(params: {
      platform: Platform
      channelSlug: string
      kind?: 'channel' | 'subscriber'
    }): Promise<void> {
      channelPlayerUrl(params.platform, params.channelSlug)
      const kind = params.kind ?? 'channel'
      if (kind !== 'channel' && kind !== 'subscriber')
        throw new Error(t('notices.channelActions.chooseEmoteKind'))
      if (kind === 'subscriber') {
        const account = dependencies
          .activeAccounts()
          .find((account) => account.platform === params.platform)
        if (!account) throw new Error(t('notices.channelActions.subscriberNeedsAccount'))
        if (params.platform !== 'twitch')
          throw new Error(t('notices.channelActions.subscriberTwitchOnly'))
        if (!account.scopes.includes('user:read:emotes'))
          throw new Error(t('notices.channelActions.subscriberScope'))
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
        throw new Error(t('notices.channelActions.unknownMode'))
      const command = validatePlayerSettings(dependencies.readPlayerSettings())[params.mode]
      if (!command.executable)
        throw new Error(
          t('notices.channelActions.configureExecutable', {
            name: playerName(params.mode),
          }),
        )
      try {
        await dependencies.spawnPlayer(
          playerArguments(command, params.platform, params.channelSlug, url),
        )
      } catch (error) {
        throw new Error(
          t('notices.channelActions.launchFailed', {
            name: playerName(params.mode),
            executable: command.executable,
            error: error instanceof Error ? error.message : String(error),
          }),
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
  if (startup && startup.code !== 0)
    throw new Error(t('notices.channelActions.playerExited', { code: startup.code }))
}
