import {
  PLATFORM_COMMAND_NAMES,
  type PlatformCommandName,
  type PlatformCommandResult,
  type RoomState,
} from '@twirchat/shared/channel-tools'
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { config } from '../config'
import { handleKickChatroom } from './kick-chatroom'
import { resolveTwitchUserId } from './twitch-users'

export interface ChatToolsInput {
  platform: Platform
  channelSlug: string
  accessToken: string
  platformUserId: string
  scopes: readonly string[]
}

export class ChatToolsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function isPlatformCommand(value: string): value is PlatformCommandName {
  return Object.hasOwn(TWITCH_SCOPES, value)
}

const TWITCH_SCOPES: Record<PlatformCommandName, readonly string[]> = {
  ban: ['moderator:manage:banned_users'],
  timeout: ['moderator:manage:banned_users'],
  unban: ['moderator:manage:banned_users'],
  untimeout: ['moderator:manage:banned_users'],
  delete: ['moderator:manage:chat_messages'],
  clear: ['moderator:manage:chat_messages'],
  slow: ['moderator:manage:chat_settings'],
  slowoff: ['moderator:manage:chat_settings'],
  followers: ['moderator:manage:chat_settings'],
  followersoff: ['moderator:manage:chat_settings'],
  subscribers: ['moderator:manage:chat_settings'],
  subscribersoff: ['moderator:manage:chat_settings'],
  emoteonly: ['moderator:manage:chat_settings'],
  emoteonlyoff: ['moderator:manage:chat_settings'],
  uniquechat: ['moderator:manage:chat_settings'],
  uniquechatoff: ['moderator:manage:chat_settings'],
  announce: ['moderator:manage:announcements'],
  announceblue: ['moderator:manage:announcements'],
  announcegreen: ['moderator:manage:announcements'],
  announceorange: ['moderator:manage:announcements'],
  announcepurple: ['moderator:manage:announcements'],
  color: ['user:manage:chat_color'],
  commercial: ['channel:edit:commercial'],
  raid: ['channel:manage:raids'],
  unraid: ['channel:manage:raids'],
  shoutout: ['moderator:manage:shoutouts'],
  mod: ['channel:manage:moderators'],
  unmod: ['channel:manage:moderators'],
  vip: ['channel:manage:vips'],
  unvip: ['channel:manage:vips'],
  mods: ['moderation:read', 'channel:manage:moderators'],
  vips: ['channel:read:vips', 'channel:manage:vips'],
  block: ['user:manage:blocked_users'],
  unblock: ['user:manage:blocked_users'],
  w: ['user:manage:whispers'],
  whisper: ['user:manage:whispers'],
  warn: ['moderator:manage:warnings'],
  shield: ['moderator:manage:shield_mode'],
  shieldoff: ['moderator:manage:shield_mode'],
  blockedterms: ['moderator:read:blocked_terms', 'moderator:manage:blocked_terms'],
  blockterm: ['moderator:manage:blocked_terms'],
  unblockterm: ['moderator:manage:blocked_terms'],
  automodallow: ['moderator:manage:automod'],
  automoddeny: ['moderator:manage:automod'],
  restrict: ['moderator:manage:suspicious_users'],
  monitor: ['moderator:manage:suspicious_users'],
  unrestrict: ['moderator:manage:suspicious_users'],
  unmonitor: ['moderator:manage:suspicious_users'],
  clip: ['clips:edit'],
  marker: ['channel:manage:broadcast'],
  title: [],
  category: [],
  uptime: [],
  usercolor: [],
}

export interface ChatToolsDependencies {
  fetch(input: string, init?: RequestInit): Promise<Response>
  resolveTwitchUserId(identifier: string, token: string): Promise<string | null>
  resolveKickUserId(identifier: string): Promise<number>
}

const defaultDependencies: ChatToolsDependencies = {
  fetch: (...args) => fetch(...args),
  resolveTwitchUserId,
  async resolveKickUserId(identifier) {
    if (/^\d+$/.test(identifier))
      return positiveInteger(identifier, 'user ID', Number.MAX_SAFE_INTEGER)
    return (
      await handleKickChatroom(
        new URL(`http://localhost/?slug=${encodeURIComponent(identifier.replace(/^@/, ''))}`),
      )
    ).broadcasterUserId
  },
}

function requireScope(input: ChatToolsInput, scopes: readonly string[]): void {
  if (scopes.length && !scopes.some((scope) => input.scopes.includes(scope))) {
    throw new ChatToolsError(`Reconnect ${input.platform} to grant ${scopes.join(' or ')}.`, 403)
  }
}

function positiveInteger(value: string, label: string, maximum: number, minimum = 1): number {
  if (!/^\d+$/.test(value)) throw new ChatToolsError(`${label} must be an integer.`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ChatToolsError(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return number
}

function duration(value: string, label: string, maximum: number, minimum = 1): number {
  if (/^\d+$/.test(value)) return positiveInteger(value, label, maximum, minimum)
  if (!/^(?:\d+[smhdw])+$/i.test(value))
    throw new ChatToolsError(`Invalid ${label}. Use seconds or 10m / 1h.`)
  let seconds = 0
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }
  for (const part of value.matchAll(/(\d+)([smhdw])/gi))
    seconds += Number(part[1]) * (units[(part[2] ?? '').toLowerCase()] ?? 0)
  return positiveInteger(String(seconds), label, maximum, minimum)
}

function words(argument: string): string[] {
  return argument ? argument.split(/\s+/) : []
}

function requireArguments(
  args: string[],
  minimum: 2,
  maximum: number,
  usage: string,
): asserts args is [string, string, ...string[]]
function requireArguments(
  args: string[],
  minimum: 1,
  maximum: number,
  usage: string,
): asserts args is [string, ...string[]]
function requireArguments(args: string[], minimum: number, maximum: number, usage: string): void
function requireArguments(args: string[], minimum: number, maximum: number, usage: string): void {
  if (args.length < minimum || args.length > maximum) throw new ChatToolsError(`Usage: ${usage}`)
}

function boundedText(text: string, maximum: number, label: string): string {
  if (!text || Array.from(text).length > maximum)
    throw new ChatToolsError(`${label} must contain 1–${maximum} characters.`)
  return text
}

function assertInput(input: ChatToolsInput): void {
  if (input.platform !== 'twitch' && input.platform !== 'kick')
    throw new ChatToolsError(`Platform commands are unavailable for ${input.platform}.`)
  if (!input.accessToken || !input.platformUserId || !input.channelSlug)
    throw new ChatToolsError('An authenticated account and channel are required.', 401)
  if (!Array.isArray(input.scopes) || !input.scopes.every((scope) => typeof scope === 'string'))
    throw new ChatToolsError('Account scopes are required.')
}

interface HelixRoomSettings {
  slow_mode: boolean
  slow_mode_wait_time: number | null
  follower_mode: boolean
  follower_mode_duration: number | null
  subscriber_mode: boolean
  emote_mode: boolean
  unique_chat_mode: boolean
}

export function normalizeHelixRoomState(channelId: string, state: HelixRoomSettings): RoomState {
  return {
    platform: 'twitch',
    channelId: channelId.replace(/^#/, '').toLowerCase(),
    slowSeconds: state.slow_mode ? (state.slow_mode_wait_time ?? 30) : 0,
    followersOnlyMinutes: state.follower_mode ? (state.follower_mode_duration ?? 0) : null,
    subscribersOnly: state.subscriber_mode,
    emoteOnly: state.emote_mode,
    uniqueChat: state.unique_chat_mode,
  }
}

export function createChatToolsService(dependencies: ChatToolsDependencies = defaultDependencies) {
  async function request(
    input: ChatToolsInput,
    path: string,
    method: string,
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const host =
      input.platform === 'twitch'
        ? 'https://api.twitch.tv/helix/'
        : 'https://api.kick.com/public/v1/'
    const url = new URL(`${host}${path}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await dependencies.fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        ...(input.platform === 'twitch' ? { 'Client-Id': config.TWITCH_CLIENT_ID } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const error = z
          .object({ message: z.string().optional(), error: z.string().optional() })
          .parse(await response.json())
        detail = error.message ?? error.error ?? detail
      } catch {
        /* Provider returned an empty or non-JSON error. */
      }
      throw new ChatToolsError(`${input.platform}: ${detail.slice(0, 500)}`, response.status)
    }
    return response.status === 204
      ? {}
      : z.record(z.string(), z.unknown()).parse(await response.json())
  }

  async function twitchUser(identifier: string, input: ChatToolsInput): Promise<string> {
    const id = await dependencies.resolveTwitchUserId(
      identifier.replace(/^[@#]/, ''),
      input.accessToken,
    )
    if (!id) throw new ChatToolsError(`Twitch user not found: ${identifier}`)
    return id
  }

  return {
    async getRoomState(input: ChatToolsInput): Promise<RoomState> {
      assertInput(input)
      if (input.platform !== 'twitch')
        throw new ChatToolsError('Room settings are unavailable through the Kick public API.')
      const broadcasterId = await twitchUser(input.channelSlug, input)
      const result = await request(input, 'chat/settings', 'GET', { broadcaster_id: broadcasterId })
      const state = z
        .union([
          z.array(
            z.object({
              slow_mode: z.boolean(),
              slow_mode_wait_time: z.union([z.number(), z.null()]),
              follower_mode: z.boolean(),
              follower_mode_duration: z.union([z.number(), z.null()]),
              subscriber_mode: z.boolean(),
              emote_mode: z.boolean(),
              unique_chat_mode: z.boolean(),
            }),
          ),
          z.undefined(),
        ])
        .parse(result.data)?.[0]
      if (!state) throw new ChatToolsError('Twitch did not return channel settings.', 502)
      return normalizeHelixRoomState(input.channelSlug, state)
    },

    async execute(input: ChatToolsInput & { text: string }): Promise<PlatformCommandResult> {
      assertInput(input)
      if (typeof input.text !== 'string' || input.text.length > 12000)
        throw new ChatToolsError('Command is too long.')
      const parsed = input.text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i)
      const name = parsed?.[1]?.toLowerCase()
      if (name !== undefined && !isPlatformCommand(name))
        throw new ChatToolsError('Unknown platform command. It was not sent to chat.')
      if (!name || !PLATFORM_COMMAND_NAMES.includes(name))
        throw new ChatToolsError('Unknown platform command. It was not sent to chat.')
      const argument = parsed?.[2]?.trim() ?? ''
      const args = words(argument)
      const usage = `/${name}`

      if (input.platform === 'kick') {
        if (!['ban', 'timeout', 'unban', 'untimeout', 'delete'].includes(name))
          throw new ChatToolsError(`/${name} is unavailable through the Kick public API.`)
        requireScope(input, [
          name === 'delete' ? 'moderation:chat_message:manage' : 'moderation:ban',
        ])
        if (name === 'delete') {
          requireArguments(args, 1, 1, '/delete message-id')
          await request(input, `chat/${encodeURIComponent(args[0])}`, 'DELETE')
        } else {
          requireArguments(
            args,
            1,
            name === 'ban' || name === 'timeout' ? Infinity : 1,
            `/${name} user [duration] [reason]`,
          )
          const broadcasterId = await dependencies.resolveKickUserId(input.channelSlug)
          const targetId = await dependencies.resolveKickUserId(args[0].replace(/^@/, ''))
          const body: {
            broadcaster_user_id: number
            user_id: number
            duration?: number
            reason?: string
          } = { broadcaster_user_id: broadcasterId, user_id: targetId }
          if (name === 'timeout') {
            const seconds =
              args[1] && /^[+-]?\d/.test(args[1])
                ? duration(args[1], 'timeout duration', 604800, 60)
                : 600
            body.duration = Math.ceil(seconds / 60)
            const reason = args.slice(args[1] && /^[+-]?\d/.test(args[1]) ? 2 : 1).join(' ')
            if (reason) body.reason = boundedText(reason, 100, 'Reason')
          } else if (name === 'ban' && args.length > 1)
            body.reason = boundedText(args.slice(1).join(' '), 100, 'Reason')
          await request(
            input,
            'moderation/bans',
            name === 'unban' || name === 'untimeout' ? 'DELETE' : 'POST',
            {},
            body,
          )
        }
        return { message: `/${name} accepted by Kick.` }
      }

      requireScope(input, TWITCH_SCOPES[name])
      // Account operations do not depend on the channel in the current split.
      if (name === 'usercolor') {
        requireArguments(args, 0, 1, '/usercolor [user]')
        const id = args[0] ? await twitchUser(args[0], input) : input.platformUserId
        const result = await request(input, 'chat/color', 'GET', { user_id: id })
        const user = z
          .union([z.array(z.object({ user_name: z.string(), color: z.string() })), z.undefined()])
          .parse(result.data)?.[0]
        if (!user) throw new ChatToolsError('Twitch returned no user color.', 502)
        return { message: `${user.user_name}: ${user.color || 'default color'}` }
      }
      if (name === 'automodallow' || name === 'automoddeny') {
        requireArguments(args, 1, 1, `/${name} held-message-id`)
        await request(
          input,
          'moderation/automod/message',
          'POST',
          {},
          {
            user_id: input.platformUserId,
            msg_id: args[0],
            action: name === 'automodallow' ? 'ALLOW' : 'DENY',
          },
        )
        return { message: 'AutoMod decision accepted by Twitch.' }
      }
      if (name === 'color') {
        requireArguments(args, 1, 1, '/color color-name-or-hex')
        if (!/^(?:#[\da-f]{6}|[a-z]+)$/i.test(args[0]))
          throw new ChatToolsError('Invalid chat color.')
        await request(input, 'chat/color', 'PUT', {
          user_id: input.platformUserId,
          color: args[0],
        })
        return { message: 'Chat color updated.' }
      }
      if (name === 'block' || name === 'unblock') {
        requireArguments(args, 1, 1, `/${name} user`)
        await request(input, 'users/blocks', name === 'block' ? 'PUT' : 'DELETE', {
          target_user_id: await twitchUser(args[0], input),
        })
        return { message: `/${name} accepted by Twitch.` }
      }
      if (name === 'w' || name === 'whisper') {
        requireArguments(args, 2, Infinity, `/${name} user message`)
        const message = boundedText(args.slice(1).join(' '), 500, 'Whisper')
        await request(
          input,
          'whispers',
          'POST',
          { from_user_id: input.platformUserId, to_user_id: await twitchUser(args[0], input) },
          { message },
        )
        return { message: 'Whisper submitted to Twitch.' }
      }

      const broadcasterId = await twitchUser(input.channelSlug, input)
      const moderated = { broadcaster_id: broadcasterId, moderator_id: input.platformUserId }
      switch (name) {
        case 'warn':
          requireArguments(args, 2, Infinity, '/warn user reason')
          await request(input, 'moderation/warnings', 'POST', moderated, {
            data: {
              user_id: await twitchUser(args[0], input),
              reason: boundedText(args.slice(1).join(' '), 500, 'Reason'),
            },
          })
          break
        case 'shield':
        case 'shieldoff':
          requireArguments(args, 0, 0, usage)
          await request(input, 'moderation/shield_mode', 'PUT', moderated, {
            is_active: name === 'shield',
          })
          break
        case 'blockterm':
          if (Array.from(argument).length < 2)
            throw new ChatToolsError('Blocked term must contain 2–500 characters.')
          await request(input, 'moderation/blocked_terms', 'POST', moderated, {
            text: boundedText(argument, 500, 'Blocked term'),
          })
          break
        case 'unblockterm':
          requireArguments(args, 1, 1, '/unblockterm term-id')
          await request(input, 'moderation/blocked_terms', 'DELETE', { ...moderated, id: args[0] })
          break
        case 'blockedterms': {
          requireArguments(args, 0, 0, usage)
          const terms: string[] = []
          const seen = new Set<string>()
          let cursor = ''
          do {
            const page = await request(input, 'moderation/blocked_terms', 'GET', {
              ...moderated,
              first: '100',
              ...(cursor ? { after: cursor } : {}),
            })
            for (const term of z
              .union([z.array(z.object({ id: z.string(), text: z.string() })), z.undefined()])
              .parse(page.data) ?? [])
              terms.push(`${term.id}: ${term.text}`)
            cursor =
              z
                .union([z.object({ cursor: z.string().optional() }), z.undefined()])
                .parse(page.pagination)?.cursor ?? ''
            if (cursor && seen.has(cursor))
              throw new ChatToolsError('Twitch repeated the pagination cursor.', 502)
            seen.add(cursor)
          } while (cursor)
          return { message: terms.length ? terms.join('\n') : 'No blocked terms.' }
        }
        case 'restrict':
        case 'monitor':
        case 'unrestrict':
        case 'unmonitor': {
          requireArguments(args, 1, 1, `/${name} user`)
          const userId = await twitchUser(args[0], input)
          if (name.startsWith('un'))
            await request(input, 'moderation/suspicious_users', 'DELETE', {
              ...moderated,
              user_id: userId,
            })
          else
            await request(input, 'moderation/suspicious_users', 'POST', moderated, {
              user_id: userId,
              status: name === 'restrict' ? 'RESTRICTED' : 'ACTIVE_MONITORING',
            })
          break
        }
        case 'clip': {
          requireArguments(args, 0, 0, usage)
          const result = await request(input, 'clips', 'POST', { broadcaster_id: broadcasterId })
          const clip = z
            .union([z.array(z.object({ edit_url: z.string().optional() })), z.undefined()])
            .parse(result.data)?.[0]
          if (!clip?.edit_url)
            throw new ChatToolsError('Twitch did not return a clip editing URL.', 502)
          return { message: `Clip creation requested: ${clip.edit_url}` }
        }
        case 'marker': {
          if (argument) boundedText(argument, 140, 'Marker description')
          const result = await request(
            input,
            'streams/markers',
            'POST',
            {},
            { user_id: broadcasterId, ...(argument ? { description: argument } : {}) },
          )
          const marker = z
            .union([
              z.array(z.object({ id: z.string(), position_seconds: z.number() })),
              z.undefined(),
            ])
            .parse(result.data)?.[0]
          if (!marker) throw new ChatToolsError('Twitch did not return a stream marker.', 502)
          return { message: `Marker ${marker.id} created at ${marker.position_seconds}s.` }
        }
        case 'title':
        case 'category': {
          if (!argument) {
            const result = await request(input, 'channels', 'GET', {
              broadcaster_id: broadcasterId,
            })
            const channel = z
              .union([
                z.array(z.object({ title: z.string(), game_name: z.string() })),
                z.undefined(),
              ])
              .parse(result.data)?.[0]
            if (!channel) throw new ChatToolsError('Twitch returned no channel information.', 502)
            return {
              message: name === 'title' ? channel.title : channel.game_name || 'No category.',
            }
          }
          requireScope(input, ['channel:manage:broadcast'])
          let gameId = argument
          if (name === 'category' && !/^\d+$/.test(argument)) {
            const result = await request(input, 'search/categories', 'GET', {
              query: argument,
              first: '100',
            })
            const game = z
              .union([z.array(z.object({ id: z.string(), name: z.string() })), z.undefined()])
              .parse(result.data)
              ?.find((item) => item.name.toLowerCase() === argument.toLowerCase())
            if (!game) throw new ChatToolsError('No exact category match. Use its Twitch game ID.')
            gameId = game.id
          }
          await request(
            input,
            'channels',
            'PATCH',
            { broadcaster_id: broadcasterId },
            name === 'title' ? { title: boundedText(argument, 140, 'Title') } : { game_id: gameId },
          )
          break
        }
        case 'uptime': {
          requireArguments(args, 0, 0, usage)
          const result = await request(input, 'streams', 'GET', { user_id: broadcasterId })
          const stream = z
            .union([z.array(z.object({ started_at: z.string() })), z.undefined()])
            .parse(result.data)?.[0]
          if (!stream) return { message: 'Channel is offline.' }
          const start = Date.parse(stream.started_at)
          if (!Number.isFinite(start))
            throw new ChatToolsError('Twitch returned an invalid stream start time.', 502)
          const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000))
          return {
            message: `Live for ${Math.floor(minutes / 60)}h ${minutes % 60}m (started ${stream.started_at}).`,
          }
        }
        case 'ban':
        case 'timeout': {
          requireArguments(
            args,
            1,
            Infinity,
            `/${name} user ${name === 'timeout' ? '[seconds] ' : ''}[reason]`,
          )
          const userId = await twitchUser(args[0], input)
          const hasDuration =
            name === 'timeout' && args[1] !== undefined && /^[+-]?\d/.test(args[1])
          const seconds =
            name === 'timeout'
              ? hasDuration
                ? duration(args[1] ?? '', 'timeout duration', 1209600)
                : 600
              : undefined
          const reason = args.slice(hasDuration ? 2 : 1).join(' ')
          if (reason) boundedText(reason, 500, 'Reason')
          await request(input, 'moderation/bans', 'POST', moderated, {
            data: {
              user_id: userId,
              ...(seconds === undefined ? {} : { duration: seconds }),
              ...(reason ? { reason } : {}),
            },
          })
          break
        }
        case 'unban':
        case 'untimeout':
          requireArguments(args, 1, 1, `/${name} user`)
          await request(input, 'moderation/bans', 'DELETE', {
            ...moderated,
            user_id: await twitchUser(args[0], input),
          })
          break
        case 'delete':
        case 'clear':
          requireArguments(
            args,
            name === 'delete' ? 1 : 0,
            name === 'delete' ? 1 : 0,
            name === 'delete' ? '/delete message-id' : usage,
          )
          await request(input, 'moderation/chat', 'DELETE', {
            ...moderated,
            ...(name === 'delete' ? { message_id: args[0] } : {}),
          })
          break
        case 'slow':
        case 'slowoff':
        case 'followers':
        case 'followersoff':
        case 'subscribers':
        case 'subscribersoff':
        case 'emoteonly':
        case 'emoteonlyoff':
        case 'uniquechat':
        case 'uniquechatoff': {
          const acceptsDuration = name === 'slow' || name === 'followers'
          requireArguments(
            args,
            0,
            acceptsDuration ? 1 : 0,
            `${usage}${acceptsDuration ? ' [duration]' : ''}`,
          )
          const settings: Record<string, boolean | number> = {}
          if (name === 'slow') {
            settings.slow_mode = true
            if (args[0]) settings.slow_mode_wait_time = duration(args[0], 'slow duration', 120, 3)
          } else if (name === 'slowoff') settings.slow_mode = false
          else if (name === 'followers') {
            settings.follower_mode = true
            if (args[0])
              settings.follower_mode_duration = /^\d+$/.test(args[0])
                ? positiveInteger(args[0], 'follow duration in minutes', 129600, 0)
                : Math.ceil(duration(args[0], 'follow duration', 7776000, 0) / 60)
          } else if (name === 'followersoff') settings.follower_mode = false
          else if (name.startsWith('subscribers')) settings.subscriber_mode = name === 'subscribers'
          else if (name.startsWith('emoteonly')) settings.emote_mode = name === 'emoteonly'
          else settings.unique_chat_mode = name === 'uniquechat'
          await request(input, 'chat/settings', 'PATCH', moderated, settings)
          break
        }
        case 'announce':
        case 'announceblue':
        case 'announcegreen':
        case 'announceorange':
        case 'announcepurple':
          await request(input, 'chat/announcements', 'POST', moderated, {
            message: boundedText(argument, 500, 'Announcement'),
            color: name.slice('announce'.length) || 'primary',
          })
          break
        case 'commercial': {
          requireArguments(args, 0, 1, '/commercial [30|60|90|120|150|180]')
          const length = args[0] ? positiveInteger(args[0], 'commercial length', 180) : 30
          if (![30, 60, 90, 120, 150, 180].includes(length))
            throw new ChatToolsError(
              'Commercial length must be 30, 60, 90, 120, 150 or 180 seconds.',
            )
          await request(
            input,
            'channels/commercial',
            'POST',
            {},
            { broadcaster_id: broadcasterId, length },
          )
          break
        }
        case 'raid':
        case 'shoutout':
          requireArguments(args, 1, 1, `/${name} channel`)
          await request(input, name === 'raid' ? 'raids' : 'chat/shoutouts', 'POST', {
            from_broadcaster_id: broadcasterId,
            to_broadcaster_id: await twitchUser(args[0], input),
            ...(name === 'shoutout' ? { moderator_id: input.platformUserId } : {}),
          })
          break
        case 'unraid':
          requireArguments(args, 0, 0, usage)
          await request(input, 'raids', 'DELETE', { broadcaster_id: broadcasterId })
          break
        case 'mod':
        case 'unmod':
        case 'vip':
        case 'unvip':
          requireArguments(args, 1, 1, `/${name} user`)
          await request(
            input,
            name.endsWith('mod') ? 'moderation/moderators' : 'channels/vips',
            name.startsWith('un') ? 'DELETE' : 'POST',
            { broadcaster_id: broadcasterId, user_id: await twitchUser(args[0], input) },
          )
          break
        case 'mods':
        case 'vips': {
          requireArguments(args, 0, 0, usage)
          const users: string[] = []
          let cursor: string | undefined
          do {
            // Pagination is sequential: each page supplies the next cursor.
            // eslint-disable-next-line no-await-in-loop
            const result = await request(
              input,
              name === 'mods' ? 'moderation/moderators' : 'channels/vips',
              'GET',
              { broadcaster_id: broadcasterId, first: '100', ...(cursor ? { after: cursor } : {}) },
            )
            for (const user of z
              .array(z.object({ user_name: z.string(), user_login: z.string() }))
              .parse(result.data ?? []))
              users.push(user.user_name || user.user_login)
            const next = z
              .union([z.object({ cursor: z.string().optional() }), z.undefined()])
              .parse(result.pagination)?.cursor
            if (next === cursor) break
            cursor = next
          } while (cursor)
          return {
            message: `${name === 'mods' ? 'Moderators' : 'VIPs'}: ${users.length ? users.join(', ') : 'none'}`,
          }
        }
      }
      return { message: `/${name} accepted by Twitch.` }
    },
  }
}
