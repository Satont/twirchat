import { describe, expect, test } from 'bun:test'

import type { JeetbotArgument, JeetbotCommand } from '../src/services/jeetbot-commands'
import {
  mergeBotCommandMatches,
  replaceToken,
  type BotCommandSource,
  type CommandSuggestion,
} from '../src/views/main/utils/autocompleteUtils'
import {
  argumentHintText,
  argumentSignature,
  argumentSummary,
  findBotCommand,
  matchArgumentOptions,
  matchSubcommands,
  parseBotInvocation,
  resolveArgumentPosition,
  suggestedCommandName,
  type BotArgumentPosition,
} from '../src/views/main/utils/botCommandArguments'

function argument(
  name: string,
  type: string,
  extra: Partial<JeetbotArgument> = {},
): JeetbotArgument {
  return { name, type, required: false, description: '', options: [], examples: [], ...extra }
}

const VOICES = [
  { value: 'default', label: 'Голос канала', aliases: ['Сброс', 'Дефолт'] },
  { value: 'random', label: 'Случайный голос', aliases: ['Рандом'] },
  { value: 'aidar', label: 'Айдар', aliases: [] },
]
const TIMEOUT: JeetbotCommand = {
  names: ['to', 'timeout'],
  description: 'Таймаут',
  args: [
    argument('username', 'mention', { required: true, description: 'Ник' }),
    argument('seconds', 'number'),
    argument('reason', 'string', { description: 'Причина' }),
  ],
  subcommands: [],
}
const VIP: JeetbotCommand = {
  names: ['vip'],
  description: 'Управление ВИПами',
  args: [],
  subcommands: [
    {
      name: 'add',
      description: 'Дать ВИПку',
      args: [
        argument('username', 'mention', { required: true }),
        argument('expiration', 'duration', { description: 'Срок', examples: ['1h', '1d'] }),
      ],
    },
    { name: 'list', description: 'Список', args: [] },
  ],
}
const VOICE: JeetbotCommand = {
  names: ['tts'],
  description: 'Сменить голос',
  args: [argument('voice', 'voice', { options: VOICES })],
  subcommands: [],
}

function position(command: JeetbotCommand, text: string): BotArgumentPosition | null {
  const invocation = parseBotInvocation(text)
  if (!invocation) throw new Error(`not an invocation: ${text}`)
  return resolveArgumentPosition(command, invocation)
}

describe('parseBotInvocation', () => {
  test('needs a command followed by whitespace', () => {
    expect(parseBotInvocation('!tts')).toBeNull()
    expect(parseBotInvocation('hello !tts ')).toBeNull()
    expect(parseBotInvocation('  !TTS ')).toEqual({ name: 'tts', words: [], partial: '' })
  })

  test('separates finished words from the word being typed', () => {
    expect(parseBotInvocation('!vip add @someone 1')).toEqual({
      name: 'vip',
      words: ['add', '@someone'],
      partial: '1',
    })
    expect(parseBotInvocation('!vip add  ')).toEqual({ name: 'vip', words: ['add'], partial: '' })
  })
})

describe('suggestedCommandName', () => {
  test('suggests a command once, under its own prefix unless only an alias matches', () => {
    const top: JeetbotCommand = { ...TIMEOUT, names: ['топ', 'top'] }
    expect(suggestedCommandName(top, '')).toBe('top')
    expect(suggestedCommandName(top, 'T')).toBe('top')
    expect(suggestedCommandName(top, 'то')).toBe('топ')
    expect(suggestedCommandName(top, 'x')).toBeUndefined()
  })
})

describe('resolveArgumentPosition', () => {
  test('finds commands by any alias, case-insensitively', () => {
    expect(findBotCommand([VIP, TIMEOUT], 'timeout')).toBe(TIMEOUT)
    expect(findBotCommand([VIP, TIMEOUT], 'nope')).toBeUndefined()
  })

  test('walks arguments and lets a trailing text argument take the rest of the line', () => {
    expect(position(TIMEOUT, '!to ')).toMatchObject({ kind: 'argument', index: 0 })
    expect(position(TIMEOUT, '!to @a 60 ')).toMatchObject({ kind: 'argument', index: 2 })
    expect(position(TIMEOUT, '!to @a 60 spam and more')).toMatchObject({ index: 2 })
    expect(position(VOICE, '!tts aidar ')).toBeNull()
  })

  test('offers subcommands first, then their arguments', () => {
    expect(position(VIP, '!vip a')).toMatchObject({ kind: 'subcommand' })
    expect(position(VIP, '!vip add @a ')).toMatchObject({ kind: 'argument', index: 1 })
    expect(position(VIP, '!vip list ')).toBeNull()
    expect(position(VIP, '!vip unknown ')).toBeNull()
    expect(matchSubcommands(VIP.subcommands, 'A').map((subcommand) => subcommand.name)).toEqual([
      'add',
    ])
  })
})

describe('signature help', () => {
  test('summarizes a command for its suggestion row', () => {
    expect(argumentSummary(TIMEOUT)).toBe('<username> [seconds] [reason]')
    expect(argumentSummary(VIP)).toBe('<add|list>')
  })

  test('marks the active argument and describes it with examples', () => {
    const vip = position(VIP, '!vip add @a ')
    if (!vip) throw new Error('expected a position')
    expect(argumentSignature(vip)).toEqual([
      { text: '!vip', active: false },
      { text: 'add', active: false },
      { text: '<username>', active: false },
      { text: '[expiration]', active: true },
    ])
    expect(argumentHintText(vip)).toBe('Срок (1h, 1d)')
    const subcommand = position(VIP, '!vip ')
    if (!subcommand) throw new Error('expected a position')
    expect(argumentHintText(subcommand)).toBe('Управление ВИПами')
  })
})

describe('argument options', () => {
  test('match value, label or alias, prefix matches first', () => {
    expect(matchArgumentOptions(VOICES, '').map((option) => option.value)).toEqual([
      'default',
      'random',
      'aidar',
    ])
    expect(matchArgumentOptions(VOICES, 'ран').map((option) => option.value)).toEqual(['random'])
    expect(matchArgumentOptions(VOICES, 'голос').map((option) => option.value)).toEqual([
      'default',
      'random',
    ])
    expect(matchArgumentOptions(VOICES, 'дар').map((option) => option.value)).toEqual(['aidar'])
  })

  test('an argument suggestion replaces only the word being typed', () => {
    const suggestion = { type: 'argument', label: 'Айдар', insertText: 'aidar', description: '' }
    expect(replaceToken('!tts ai', { ...suggestion, type: 'argument' })).toBe('!tts aidar ')
    expect(replaceToken('!vip add ', { ...suggestion, type: 'argument' })).toBe('!vip add aidar ')
  })
})

describe('mergeBotCommandMatches', () => {
  const command = (label: string, source: BotCommandSource): CommandSuggestion => ({
    type: 'command',
    label,
    insertText: label,
    description: '',
    source,
  })

  test('keeps Twir order and puts a same-named jeetbot command right after its twin', () => {
    const merged = mergeBotCommandMatches(
      [command('!b', 'twir'), command('!Top', 'twir'), command('!a', 'twir')],
      [command('!z', 'jeetbot'), command('!top', 'jeetbot')],
    )
    expect(merged.map(({ label, source }) => `${label}:${source}`)).toEqual([
      '!b:twir',
      '!Top:twir',
      '!top:jeetbot',
      '!a:twir',
      '!z:jeetbot',
    ])
  })
})
