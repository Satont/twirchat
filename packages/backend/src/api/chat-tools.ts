import { PLATFORM_COMMAND_NAMES, type PlatformCommandResult } from '@twirchat/shared/channel-tools'
import { z } from 'zod'

import { handleKickChatroom } from './kick-chatroom'

export interface ChatToolsInput {
  platform: 'kick'
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

function isKickCommand(
  value: string,
): value is 'ban' | 'timeout' | 'unban' | 'untimeout' | 'delete' {
  return (
    value === 'ban' ||
    value === 'timeout' ||
    value === 'unban' ||
    value === 'untimeout' ||
    value === 'delete'
  )
}

export interface ChatToolsDependencies {
  fetch(input: string, init?: RequestInit): Promise<Response>
  resolveKickUserId(identifier: string): Promise<number>
}

const defaultDependencies: ChatToolsDependencies = {
  fetch: (...args) => fetch(...args),
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
  minimum: 1,
  maximum: number,
  usage: string,
): asserts args is [string, ...string[]] {
  if (args.length < minimum || args.length > maximum) throw new ChatToolsError(`Usage: ${usage}`)
}

function boundedText(text: string, maximum: number, label: string): string {
  if (!text || Array.from(text).length > maximum)
    throw new ChatToolsError(`${label} must contain 1–${maximum} characters.`)
  return text
}

function assertInput(input: ChatToolsInput): void {
  if (!input.accessToken || !input.platformUserId || !input.channelSlug)
    throw new ChatToolsError('An authenticated account and channel are required.', 401)
  if (!Array.isArray(input.scopes) || !input.scopes.every((scope) => typeof scope === 'string'))
    throw new ChatToolsError('Account scopes are required.')
}

export function createChatToolsService(dependencies: ChatToolsDependencies = defaultDependencies) {
  async function request(
    input: ChatToolsInput,
    path: string,
    method: string,
    body?: unknown,
  ): Promise<void> {
    const url = `https://api.kick.com/public/v1/${path}`
    const response = await dependencies.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
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
  }

  return {
    async execute(input: ChatToolsInput & { text: string }): Promise<PlatformCommandResult> {
      assertInput(input)
      if (typeof input.text !== 'string' || input.text.length > 12000)
        throw new ChatToolsError('Command is too long.')
      const parsed = input.text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i)
      const name = parsed?.[1]?.toLowerCase()
      if (!name || !PLATFORM_COMMAND_NAMES.some((command) => command === name))
        throw new ChatToolsError('Unknown platform command. It was not sent to chat.')
      if (!isKickCommand(name))
        throw new ChatToolsError(`/${name} is unavailable through the Kick public API.`)
      const args = words(parsed?.[2]?.trim() ?? '')
      requireScope(input, [name === 'delete' ? 'moderation:chat_message:manage' : 'moderation:ban'])
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
          body,
        )
      }
      return { message: `/${name} accepted by Kick.` }
    },
  }
}
