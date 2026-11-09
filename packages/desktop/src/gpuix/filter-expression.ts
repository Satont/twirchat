import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { t } from './i18n'
import { compileRuleRegex, RuleRegex } from './rule-regex'

type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | RuleRegex
  | { color: string }
  | { strings: string[] }
interface Token {
  kind: 'value' | 'identifier' | 'operator' | 'end'
  text: string
  value?: Value
  at: number
}
type Node =
  | { kind: 'value'; value: Value }
  | { kind: 'identifier'; name: string }
  | { kind: 'unary'; value: Node }
  | { kind: 'list'; values: Node[] }
  | { kind: 'binary'; operator: string; left: Node; right: Node }

export interface FilterContext {
  channelName?: string
  channelLive?: boolean
  channelWatching?: boolean
  highlighted?: boolean
  deleted?: boolean
  whispered?: boolean
  similar?: boolean
  externalBadges?: string[]
  subscriptionMonths?: number
  rewardCost?: number
}

const VARIABLES = new Set([
  'author.badges',
  'author.external_badges',
  'author.color',
  'author.name',
  'author.user_id',
  'author.no_color',
  'author.subbed',
  'author.sub_length',
  'bits.amount',
  'channel.name',
  'channel.watching',
  'channel.live',
  'message.content',
  'message.length',
  'reward.title',
  'reward.cost',
  'reward.id',
  'flags.action',
  'flags.automod',
  'flags.cheer_message',
  'flags.first_message',
  'flags.highlighted',
  'flags.points_redeemed',
  'flags.reply',
  'flags.restricted',
  'flags.monitored',
  'flags.reward_message',
  'flags.shared',
  'flags.sub_message',
  'flags.system_message',
  'flags.whisper',
  'flags.similar',
  'flags.watch_streak',
  'flags.announcement',
  'flags.elevated_message',
  'flags.hype_chat',
  'flags.deleted',
  'flags.follow_message',
  'flags.repeated_message',
  'flags.repeated_messages',
  'flags.webchat_detected',
  'leafyrino.client_detection',
  'moltorino.client_detection',
  'dankerino.client_detection',
  'platform.name',
])

function tokenize(source: string): Token[] {
  if (source.length > 8192) throw new Error(t('commands.filter.tooLong'))
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    if (tokens.length >= 1024) throw new Error(t('commands.filter.tooManyTerms'))
    const char = source[i]!
    if (/\s/u.test(char)) {
      i++
      continue
    }
    const at = i
    const regexPrefix = source.slice(i).match(/^(ri|r)"/u)?.[1]
    if (char === '"' || regexPrefix) {
      i += regexPrefix ? regexPrefix.length + 1 : 1
      let text = ''
      let closed = false
      while (i < source.length) {
        const next = source[i++]!
        if (next === '"') {
          closed = true
          break
        }
        if (next === '\\' && i < source.length) {
          const escaped = source[i++]!
          if (regexPrefix) text += escaped === '"' ? '"' : `\\${escaped}`
          else
            text +=
              escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped
        } else text += next
      }
      if (!closed) throw new Error(t('commands.filter.unclosedString', { position: at + 1 }))
      tokens.push({
        kind: 'value',
        text,
        value: regexPrefix ? compileRuleRegex(text, regexPrefix === 'ri') : text,
        at,
      })
      continue
    }
    const number = source.slice(i).match(/^\d+/u)?.[0]
    if (number) {
      const value = Number(number)
      if (!Number.isSafeInteger(value))
        throw new Error(t('commands.filter.integerTooLarge', { position: i + 1 }))
      tokens.push({ kind: 'value', text: number, value, at })
      i += number.length
      continue
    }
    const identifier = source.slice(i).match(/^[a-zA-Z_][\w.]*/u)?.[0]
    if (identifier) {
      const kind = ['contains', 'startswith', 'endswith', 'match'].includes(identifier)
        ? 'operator'
        : 'identifier'
      tokens.push({ kind, text: identifier, at })
      i += identifier.length
      continue
    }
    const operator = [
      '&&',
      '||',
      '==',
      '!=',
      '<=',
      '>=',
      '<',
      '>',
      '!',
      '+',
      '-',
      '*',
      '/',
      '%',
      '(',
      ')',
      '{',
      '}',
      ',',
    ].find((op) => source.startsWith(op, i))
    if (!operator) throw new Error(t('commands.filter.unexpectedChar', { char, position: i + 1 }))
    tokens.push({ kind: 'operator', text: operator, at })
    i += operator.length
  }
  tokens.push({ kind: 'end', text: '', at: source.length })
  return tokens
}

function parse(source: string): Node {
  const tokens = tokenize(source)
  let index = 0
  let depth = 0
  const peek = () => tokens[index]!
  const take = (text: string) => {
    if (peek().text !== text) return false
    index++
    return true
  }
  const binary = (left: Node, operator: string, right: Node): Node => ({
    kind: 'binary',
    left,
    operator,
    right,
  })
  const expect = (text: string) => {
    if (!take(text))
      throw new Error(t('commands.filter.expected', { text, position: peek().at + 1 }))
  }
  function primary(): Node {
    if (++depth > 64) throw new Error(t('commands.filter.tooDeep'))
    try {
      if (take('(')) {
        const result = or()
        expect(')')
        return result
      }
      if (take('{')) {
        const values: Node[] = []
        if (!take('}')) {
          do {
            values.push(or())
          } while (take(','))
          expect('}')
        }
        return { kind: 'list', values }
      }
      const token = tokens[index++]!
      if (token.kind === 'value') return { kind: 'value', value: token.value ?? null }
      if (token.kind === 'identifier') {
        if (!VARIABLES.has(token.text))
          throw new Error(t('commands.filter.unknownVariable', { name: token.text }))
        return { kind: 'identifier', name: token.text }
      }
      throw new Error(t('commands.filter.expectedValue', { position: token.at + 1 }))
    } finally {
      depth--
    }
  }
  function arithmetic(): Node {
    let result = primary()
    // Chatterino evaluates all arithmetic operators left to right.
    while (['+', '-', '*', '/', '%'].includes(peek().text)) {
      const operator = tokens[index++]!.text
      result = binary(result, operator, primary())
    }
    return result
  }
  function condition(): Node {
    let result = arithmetic()
    if (
      ['==', '!=', '<', '<=', '>', '>=', 'contains', 'startswith', 'endswith', 'match'].includes(
        peek().text,
      )
    ) {
      const operator = tokens[index++]!.text
      result = binary(result, operator, arithmetic())
    }
    return result
  }
  function unary(): Node {
    if (!take('!')) return condition()
    if (++depth > 64) throw new Error(t('commands.filter.tooDeep'))
    try {
      return { kind: 'unary', value: unary() }
    } finally {
      depth--
    }
  }
  function and(): Node {
    let result = unary()
    while (take('&&')) result = binary(result, '&&', unary())
    return result
  }
  function or(): Node {
    let result = and()
    while (take('||')) result = binary(result, '||', and())
    return result
  }
  const result = or()
  if (peek().kind !== 'end')
    throw new Error(
      t('commands.filter.unexpectedToken', { text: peek().text, position: peek().at + 1 }),
    )
  return result
}

function variable(name: string, m: NormalizedChatMessage, c: FilterContext): Value {
  const metadata = m.metadata
  switch (name) {
    case 'author.badges':
      return { strings: m.author.badges.map((badge) => badge.type) }
    case 'author.external_badges':
      return { strings: c.externalBadges ?? [] }
    case 'author.color':
      return { color: m.author.color?.toLowerCase() ?? '' }
    case 'author.name':
      return m.author.username ?? m.author.displayName
    case 'author.user_id':
      return m.author.id
    case 'author.no_color':
      return !m.author.color
    case 'author.subbed':
      return m.author.badges.some(
        (badge) => badge.type === 'subscriber' || badge.type === 'founder',
      )
    case 'author.sub_length':
      return c.subscriptionMonths ?? metadata?.subscriptionMonths ?? 0
    case 'bits.amount':
      return metadata?.bits ?? 0
    case 'channel.name':
      return c.channelName ?? m.channelId
    case 'channel.watching':
      return c.channelWatching ?? false
    case 'channel.live':
      return c.channelLive ?? false
    case 'platform.name':
      return m.platform
    case 'message.content':
      return m.text
    case 'message.length':
      return Array.from(m.text).length
    case 'reward.title':
      return metadata?.rewardTitle ?? ''
    case 'reward.cost':
      return c.rewardCost ?? metadata?.rewardCost ?? 0
    case 'reward.id':
      return metadata?.rewardId ?? ''
    case 'flags.action':
      return m.type === 'action'
    case 'flags.cheer_message':
      return (metadata?.bits ?? 0) > 0
    case 'flags.first_message':
      return metadata?.firstMessage ?? metadata?.flags?.first_message ?? false
    case 'flags.highlighted':
      return c.highlighted ?? metadata?.highlighted ?? metadata?.flags?.highlighted ?? false
    case 'flags.points_redeemed':
    case 'flags.reward_message':
      return !!metadata?.rewardId
    case 'flags.reply':
      return !!m.reply
    case 'flags.shared':
      return !!metadata?.sharedChat
    case 'flags.system_message':
      return m.type === 'system'
    case 'flags.whisper':
      return c.whispered ?? metadata?.flags?.whisper ?? false
    case 'flags.similar':
      return c.similar ?? metadata?.flags?.similar ?? false
    case 'flags.announcement':
      return !!metadata?.announcement || metadata?.flags?.announcement === true
    case 'flags.deleted':
      return c.deleted ?? metadata?.flags?.deleted ?? false
    case 'leafyrino.client_detection':
    case 'moltorino.client_detection':
    case 'dankerino.client_detection':
      return metadata?.clientDetection ?? ''
    case 'flags.repeated_message':
    case 'flags.repeated_messages':
      return metadata?.flags?.repeated_message ?? metadata?.flags?.repeated_messages ?? false
    default:
      return name.startsWith('flags.') ? (metadata?.flags?.[name.slice(6)] ?? false) : false
  }
}

function equal(a: Value, b: Value): boolean {
  if (a && typeof a === 'object' && 'strings' in a) return equal(a.strings, b)
  if (b && typeof b === 'object' && 'strings' in b) return equal(a, b.strings)
  if (a && typeof a === 'object' && !Array.isArray(a) && 'color' in a)
    return typeof b === 'string' && a.color === b.toLowerCase()
  if (b && typeof b === 'object' && !Array.isArray(b) && 'color' in b)
    return typeof a === 'string' && b.color === a.toLowerCase()
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i] ?? null))
  return a === b
}

function compareEqual(a: Value, b: Value): boolean {
  if (typeof a === 'string') {
    if (typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean')
      return a.toLowerCase() === String(b).toLowerCase()
  }
  if (typeof a === 'number' && typeof b === 'string')
    return /^[+-]?\d+$/u.test(b.trim()) && a === Number(b)
  if (typeof a === 'boolean' && (typeof b === 'number' || typeof b === 'string'))
    return a === (typeof b === 'number' ? b !== 0 : !['', '0', 'false'].includes(b.toLowerCase()))
  return equal(a, b)
}

function evaluate(node: Node, message: NormalizedChatMessage, context: FilterContext): Value {
  if (node.kind === 'value') return node.value
  if (node.kind === 'identifier') return variable(node.name, message, context)
  if (node.kind === 'list') return node.values.map((value) => evaluate(value, message, context))
  if (node.kind === 'unary') return evaluate(node.value, message, context) === false
  const a = evaluate(node.left, message, context)
  if (node.operator === '&&') return a === true && evaluate(node.right, message, context) === true
  if (node.operator === '||') return a === true || evaluate(node.right, message, context) === true
  const b = evaluate(node.right, message, context)
  switch (node.operator) {
    case '==':
      return compareEqual(a, b)
    case '!=':
      return !compareEqual(a, b)
    case '<':
      return typeof a === 'number' && typeof b === 'number' && a < b
    case '<=':
      return typeof a === 'number' && typeof b === 'number' && a <= b
    case '>':
      return typeof a === 'number' && typeof b === 'number' && a > b
    case '>=':
      return typeof a === 'number' && typeof b === 'number' && a >= b
    case 'contains':
      return typeof a === 'string' && typeof b === 'string'
        ? a.toLowerCase().includes(b.toLowerCase())
        : a && typeof a === 'object' && 'strings' in a && typeof b === 'string'
          ? a.strings.some((value) => value.toLowerCase() === b.toLowerCase())
          : Array.isArray(a) && a.some((value) => equal(value, b))
    case 'startswith':
      return typeof a === 'string' && typeof b === 'string'
        ? a.toLowerCase().startsWith(b.toLowerCase())
        : a && typeof a === 'object' && 'strings' in a && typeof b === 'string'
          ? a.strings[0]?.toLowerCase() === b.toLowerCase()
          : Array.isArray(a) && equal(a[0] ?? null, b)
    case 'endswith':
      return typeof a === 'string' && typeof b === 'string'
        ? a.toLowerCase().endsWith(b.toLowerCase())
        : a && typeof a === 'object' && 'strings' in a && typeof b === 'string'
          ? a.strings.at(-1)?.toLowerCase() === b.toLowerCase()
          : Array.isArray(a) && equal(a.at(-1) ?? null, b)
    case 'match': {
      if (typeof a !== 'string') return false
      if (b instanceof RuleRegex) return b.test(a.slice(0, 8192))
      if (Array.isArray(b) && b[0] instanceof RuleRegex && typeof b[1] === 'number')
        return b[0].exec(a.slice(0, 8192))?.[b[1]] ?? ''
      return false
    }
    case '+':
      return typeof a === 'string'
        ? (a + String(b)).slice(0, 8192)
        : typeof a === 'number' && typeof b === 'number'
          ? a + b
          : null
    case '-':
      return typeof a === 'number' && typeof b === 'number' ? a - b : null
    case '*':
      return typeof a === 'number' && typeof b === 'number' ? a * b : null
    case '/':
      return typeof a === 'number' && typeof b === 'number' && b !== 0 ? Math.trunc(a / b) : null
    case '%':
      return typeof a === 'number' && typeof b === 'number' && b !== 0 ? a % b : null
    default:
      return null
  }
}

type ValueType = 'string' | 'number' | 'boolean' | 'list' | 'regex' | 'color' | 'null'

function returnType(node: Node): ValueType {
  if (node.kind === 'value')
    return node.value instanceof RuleRegex
      ? 'regex'
      : node.value === null
        ? 'null'
        : typeof node.value === 'object'
          ? 'list'
          : typeof node.value === 'string'
            ? 'string'
            : typeof node.value === 'number'
              ? 'number'
              : 'boolean'
  if (node.kind === 'list') {
    node.values.forEach(returnType)
    return 'list'
  }
  if (node.kind === 'identifier') {
    if (
      node.name.startsWith('flags.') ||
      ['author.no_color', 'author.subbed', 'channel.watching', 'channel.live'].includes(node.name)
    )
      return 'boolean'
    if (['message.length', 'bits.amount', 'reward.cost', 'author.sub_length'].includes(node.name))
      return 'number'
    if (['author.badges', 'author.external_badges'].includes(node.name)) return 'list'
    return node.name === 'author.color' ? 'color' : 'string'
  }
  if (node.kind === 'unary') {
    if (returnType(node.value) !== 'boolean') throw new Error(t('commands.filter.negationBoolean'))
    return 'boolean'
  }
  const left = returnType(node.left)
  const right = returnType(node.right)
  if (['&&', '||'].includes(node.operator)) {
    if (left !== 'boolean' || right !== 'boolean')
      throw new Error(t('commands.filter.logicalBoolean'))
    return 'boolean'
  }
  if (['==', '!='].includes(node.operator)) return 'boolean'
  if (['<', '<=', '>', '>='].includes(node.operator)) {
    if (left !== 'number' || right !== 'number')
      throw new Error(t('commands.filter.orderedIntegers'))
    return 'boolean'
  }
  if (['contains', 'startswith', 'endswith'].includes(node.operator)) {
    if (left !== 'list' && !(left === 'string' && right === 'string'))
      throw new Error(t('commands.filter.textComparison'))
    return 'boolean'
  }
  if (node.operator === 'match') {
    if (left !== 'string') throw new Error(t('commands.filter.regexText'))
    if (right === 'regex') return 'boolean'
    if (
      node.right.kind === 'list' &&
      node.right.values.length === 2 &&
      returnType(node.right.values[0]!) === 'regex' &&
      returnType(node.right.values[1]!) === 'number'
    )
      return 'string'
    throw new Error(t('commands.filter.regexAfterMatch'))
  }
  if (node.operator === '+' && left === 'string') return 'string'
  if (left !== 'number' || right !== 'number')
    throw new Error(t('commands.filter.arithmeticIntegers'))
  return 'number'
}

export function compileFilterExpression(source: string): {
  matches: (message: NormalizedChatMessage, context?: FilterContext) => boolean
  error?: string
} {
  try {
    const node = parse(source)
    if (returnType(node) !== 'boolean') throw new Error(t('commands.filter.mustReturnBoolean'))
    return { matches: (message, context = {}) => evaluate(node, message, context) === true }
  } catch (error) {
    return { matches: () => false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const FILTER_VARIABLES = [...VARIABLES]
export { compileRuleRegex }
