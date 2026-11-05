import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

export interface CustomCommandDefinition {
  id: string
  name: string
  template: string
  platform?: Platform
  channel?: string
  showInMessageMenu: boolean
}

export interface CommandContext {
  platform?: Platform
  channel?: { name: string; id?: string }
  my?: { name: string; id?: string }
  user?: { name: string; id?: string }
  message?: { id: string; text: string }
  stream?: { title?: string; game?: string }
  inputText?: string
  elementCopyText?: string
}

export const CUSTOM_COMMAND_OUTPUT_LIMIT = 5
export const CUSTOM_COMMAND_PACING_MS = 1700

export function parsePluginCommand(text: string): { name: string; args: string[] } | null {
  const [command, ...args] = text.trim().split(/\s+/u)
  if (!command?.startsWith('/') || command.length === 1) return null
  return { name: command.slice(1).toLowerCase(), args }
}
const MAX_TEMPLATE_LENGTH = 4000
const MAX_EXPANDED_LENGTH = 20_000
const MAX_DEPTH = 8
const LOCAL_NAMES = new Set([
  'user',
  'search',
  'mentions',
  'pause',
  'resume',
  'copy',
  'clearmessages',
])
const CONTEXT_KEYS = new Set([
  'channel.name',
  'channel.id',
  'my.name',
  'my.id',
  'user.name',
  'user.id',
  'msg.id',
  'msg.text',
  'stream.title',
  'stream.game',
  'input.text',
  'element.copytext',
  'channel',
  'user',
  'msg-id',
  'message',
])

export function commandApplies(command: CustomCommandDefinition, context: CommandContext): boolean {
  return (
    (!command.platform || command.platform === context.platform) &&
    (!command.channel ||
      command.channel.replace(/^#/, '').toLowerCase() ===
        context.channel?.name.replace(/^#/, '').toLowerCase())
  )
}

function placeholderValue(key: string, args: string[], context: CommandContext): string {
  const positional = key.match(/^([1-9]\d?)(\+)?(?:[;=]([\s\S]*))?$/)
  if (positional) {
    const index = Number(positional[1]) - 1
    const value = positional[2] ? args.slice(index).join(' ') : args[index]
    if (value) return value.replace(/[\r\n]+/g, ' ')
    return positional[3] ?? ''
  }
  const separator = key.search(/[;=]/)
  const variable = separator === -1 ? key : key.slice(0, separator)
  const fallback = separator === -1 ? '' : key.slice(separator + 1)
  const values: Record<string, string | undefined> = {
    'channel.name': context.channel?.name,
    'channel.id': context.channel?.id,
    'my.name': context.my?.name,
    'my.id': context.my?.id,
    'user.name': context.user?.name,
    'user.id': context.user?.id,
    'msg.id': context.message?.id,
    'msg.text': context.message?.text,
    'stream.title': context.stream?.title,
    'stream.game': context.stream?.game,
    'input.text': context.inputText,
    'element.copytext': context.elementCopyText,
    channel: context.channel?.name,
    user: context.user?.name,
    'msg-id': context.message?.id,
    message: context.message?.text,
  }
  if (!CONTEXT_KEYS.has(variable)) return `{${key}}`
  const value = values[variable] || fallback
  // A value is data inside one output, never another command line.
  return value.replace(/[\r\n]+/g, ' ')
}

function expandTemplate(template: string, args: string[], context: CommandContext): string {
  let output = ''
  for (let index = 0; index < template.length; index++) {
    const char = template[index]!
    if ((char === '{' || char === '}') && template[index + 1] === char) {
      output += char
      index++
    } else if (char === '{') {
      const end = template.indexOf('}', index + 1)
      if (end === -1) {
        output += char
        continue
      }
      const key = template.slice(index + 1, end)
      output += placeholderValue(key, args, context)
      index = end
    } else output += char
    if (output.length > MAX_EXPANDED_LENGTH) throw new Error('Expanded command is too long.')
  }
  return output
}

const customCommandRecord = z.record(z.string(), z.unknown())

export function validateCustomCommands(value: unknown): CustomCommandDefinition[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Use a list of at most 100 commands.')
  const seenIds = new Set<string>()
  const seenScopes = new Set<string>()
  return value.map((entry: unknown, index) => {
    const decoded = customCommandRecord.safeParse(entry)
    if (!decoded.success) throw new Error(`Command ${index + 1} is invalid.`)
    const row = decoded.data
    if (typeof row.id !== 'string' || !row.id || row.id.length > 100 || seenIds.has(row.id))
      throw new Error(`Command ${index + 1} needs a unique ID.`)
    seenIds.add(row.id)
    if (typeof row.name !== 'string') throw new Error(`Command ${index + 1} needs a name.`)
    const name = row.name.trim().replace(/^\//, '').toLowerCase().replace(/\s+/g, ' ')
    if (name.length > 64 || !/^[a-z][a-z0-9_-]*(?: [a-z0-9_-]+)*$/.test(name))
      throw new Error(
        'Command names use up to 64 letters, numbers, spaces, _ or -, starting with a letter.',
      )
    if (LOCAL_NAMES.has(name))
      throw new Error(`/${name} is a built-in local command. Choose another name.`)
    if (
      typeof row.template !== 'string' ||
      !row.template.trim() ||
      row.template.length > MAX_TEMPLATE_LENGTH
    )
      throw new Error(`/${name} needs a template of 1–${MAX_TEMPLATE_LENGTH} characters.`)
    if (
      row.template.split(/\r?\n/).filter((line) => line.trim()).length > CUSTOM_COMMAND_OUTPUT_LIMIT
    ) {
      throw new Error(`/${name} may produce at most ${CUSTOM_COMMAND_OUTPUT_LIMIT} messages.`)
    }
    const platform = row.platform
    if (
      platform !== undefined &&
      platform !== 'twitch' &&
      platform !== 'youtube' &&
      platform !== 'kick'
    )
      throw new Error(`/${name} has an invalid platform.`)
    if (
      row.channel !== undefined &&
      (typeof row.channel !== 'string' || row.channel.length > 100 || /\s/.test(row.channel.trim()))
    )
      throw new Error(`/${name} has an invalid channel name.`)
    if (typeof row.showInMessageMenu !== 'boolean')
      throw new Error(`/${name} needs a message-menu setting.`)
    const channel =
      typeof row.channel === 'string' ? row.channel.trim().replace(/^#/, '').toLowerCase() : ''
    const scope = `${name}:${platform ?? ''}:${channel}`
    if (seenScopes.has(scope)) throw new Error(`/${name} is defined twice in the same scope.`)
    seenScopes.add(scope)
    return {
      id: row.id,
      name,
      template: row.template,
      ...(platform ? { platform } : {}),
      ...(channel ? { channel } : {}),
      showInMessageMenu: row.showInMessageMenu,
    }
  })
}

function splitArguments(input: string): string[] {
  const args: string[] = []
  let value = ''
  let quoted: string | null = null
  let started = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (char === '\\' && quoted && (input[i + 1] === quoted || input[i + 1] === '\\')) {
      value += input[++i]
      started = true
    } else if (char === quoted) quoted = null
    else if (!quoted && !started && (char === '"' || char === "'")) {
      quoted = char
      started = true
    } else if (!quoted && /\s/.test(char)) {
      if (started) args.push(value)
      value = ''
      started = false
    } else {
      value += char
      started = true
    }
  }
  if (quoted) throw new Error('Close the quotation mark in the command arguments.')
  if (started) args.push(value)
  return args
}

export type CommandExpansion =
  | { ok: true; outputs: string[]; matched: boolean }
  | { ok: false; error: string }

export function expandCustomCommand(
  input: string,
  definitions: CustomCommandDefinition[],
  context: CommandContext,
): CommandExpansion {
  let matched = false
  const outputs: string[] = []
  let visits = 0
  const visit = (text: string, path: string[]): void => {
    if (++visits > 100)
      throw new Error('Command expansion is too complex (more than 100 alias steps).')
    if (text.length > MAX_EXPANDED_LENGTH) throw new Error('Expanded command is too long.')
    const invocationText = text.trim()
    const candidates = definitions
      .map((command) => {
        const escaped = command.name
          .trim()
          .split(/\s+/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s+')
        return { command, match: invocationText.match(new RegExp(`^/${escaped}(?=\\s|$)`, 'i')) }
      })
      .filter((candidate) => candidate.match)
      .sort((a, b) => b.command.name.length - a.command.name.length)
    const trigger = candidates[0]?.command.name
    const named = candidates.filter((candidate) => candidate.command.name === trigger)
    if (named.length === 0) {
      if (outputs.length >= CUSTOM_COMMAND_OUTPUT_LIMIT)
        throw new Error(`A command may produce at most ${CUSTOM_COMMAND_OUTPUT_LIMIT} messages.`)
      if (text.length > MAX_EXPANDED_LENGTH) throw new Error('Expanded command is too long.')
      if (text.trim()) outputs.push(text.trim())
      return
    }
    const selected = named.find((candidate) => commandApplies(candidate.command, context))
    if (!selected) throw new Error(`/${trigger} is unavailable in this platform/channel scope.`)
    const { command, match } = selected
    if (path.includes(command.id))
      throw new Error(`Command alias cycle: ${[...path, command.id].join(' → ')}.`)
    if (path.length >= MAX_DEPTH)
      throw new Error(`Command aliases may nest at most ${MAX_DEPTH} levels.`)
    matched = true
    const args = splitArguments(invocationText.slice(match![0].length).trimStart())
    const expanded = expandTemplate(command.template, args, context)
    for (const line of expanded.split(/\r?\n/)) {
      if (line.trim()) visit(line, [...path, command.id])
    }
  }
  try {
    visit(input, [])
    if (matched && outputs.length === 0)
      return { ok: false, error: 'The command produced no messages.' }
    return { ok: true, outputs, matched }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runCommandActions(
  actions: Array<() => void | Promise<void>>,
  options: { signal?: AbortSignal; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<void> {
  if (actions.length > CUSTOM_COMMAND_OUTPUT_LIMIT)
    throw new Error(`A command may produce at most ${CUSTOM_COMMAND_OUTPUT_LIMIT} messages.`)
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve, reject) => {
        const signal = options.signal
        const cancel = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          reject(new Error('Command cancelled.'))
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', cancel)
          resolve()
        }, milliseconds)
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
      }))
  for (let index = 0; index < actions.length; index++) {
    options.signal?.throwIfAborted()
    // The order and delay are part of the chat-rate contract.
    // eslint-disable-next-line no-await-in-loop
    if (index > 0) await wait(CUSTOM_COMMAND_PACING_MS)
    options.signal?.throwIfAborted()
    // eslint-disable-next-line no-await-in-loop
    await actions[index]!()
  }
}
