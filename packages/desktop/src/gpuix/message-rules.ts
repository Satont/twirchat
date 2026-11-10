import type { Account, NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { createMentionMatcher } from './chat-tools'
import { compileFilterExpression, compileRuleRegex, type FilterContext } from './filter-expression'
import { t } from './i18n'
import type { RuleRegex } from './rule-regex'

export interface TextRule {
  id: string
  name?: string
  pattern: string
  enabled: boolean
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}
export interface HighlightRule extends TextRule {
  target: 'message' | 'user' | 'badge' | 'filter'
  color: string
  mentions: boolean
  sound: boolean
  flash: boolean
}
export interface IgnoreRule extends TextRule {
  target: 'message' | 'user'
  platform?: Platform
  userId?: string
  placeholder: boolean
  replacement?: string
  action?: 'hide' | 'replace' | 'suppress-highlights'
}
export interface SavedFilter {
  id: string
  name: string
  expression: string
}
export interface ChatRules {
  highlights: HighlightRule[]
  ignores: IgnoreRule[]
  filters: SavedFilter[]
  paneFilters: Record<string, string[]>
  highlightOwnMessages: boolean
  highlightReplies: boolean
  providerHighlights: boolean
  filterOwnMessages?: boolean
}
export const DEFAULT_CHAT_RULES: ChatRules = {
  highlights: [],
  ignores: [],
  filters: [],
  paneFilters: {},
  highlightOwnMessages: false,
  highlightReplies: true,
  providerHighlights: true,
  filterOwnMessages: true,
}

function compilePattern(rule: TextRule): RuleRegex {
  if (!rule.pattern) throw new Error(t('commands.rule.enterPattern'))
  const escaped = rule.regex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = rule.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${escaped})(?![\\p{L}\\p{N}_])` : escaped
  return compileRuleRegex(pattern, !rule.caseSensitive)
}

const textRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100).optional(),
  pattern: z.string(),
  enabled: z.boolean(),
  regex: z.boolean(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
})
const highlightRuleSchema = textRuleSchema.extend({
  target: z.enum(['message', 'user', 'badge', 'filter']),
  color: z.string().regex(/^#[\da-f]{6}(?:[\da-f]{2})?$/iu),
  mentions: z.boolean(),
  sound: z.boolean(),
  flash: z.boolean(),
})
const ignoreRuleSchema = textRuleSchema
  .extend({
    target: z.enum(['message', 'user']),
    platform: z.enum(['twitch', 'kick', 'youtube', 'vkplay']).optional(),
    userId: z.string().optional(),
    placeholder: z.boolean(),
    replacement: z.string().max(1000).optional(),
    action: z.enum(['hide', 'replace', 'suppress-highlights']).optional(),
  })
  .refine((rule) => rule.action !== 'replace' || rule.target === 'message', {
    error: () => t('commands.rule.invalidIgnoreFields'),
  })
function booleanSetting(fallback: boolean) {
  return z.preprocess((value) => (typeof value === 'boolean' ? value : fallback), z.boolean())
}
const chatRulesSchema = z.object({
  highlights: z.array(highlightRuleSchema).max(1000),
  ignores: z.array(ignoreRuleSchema).max(1000),
  filters: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z
          .string()
          .max(100)
          .refine((name) => !!name.trim()),
        expression: z.string(),
      }),
    )
    .max(1000),
  paneFilters: z.record(z.string().max(500), z.array(z.string())),
  highlightOwnMessages: booleanSetting(false),
  highlightReplies: booleanSetting(true),
  providerHighlights: booleanSetting(true),
  filterOwnMessages: booleanSetting(true),
})
export function validateChatRules(value: unknown): ChatRules {
  const result = chatRulesSchema.parse(value)
  const ids = new Set<string>()
  for (const rule of [...result.highlights, ...result.ignores]) {
    if (ids.has(rule.id)) throw new Error(t('commands.rule.duplicateFields'))
    ids.add(rule.id)
    if (rule.target === 'filter') {
      const compiled = compileFilterExpression(rule.pattern)
      if (compiled.error) throw new Error(compiled.error)
    } else compilePattern(rule)
  }
  for (const filter of result.filters) {
    if (ids.has(filter.id)) throw new Error(t('commands.rule.uniqueFilter'))
    ids.add(filter.id)
    const compiled = compileFilterExpression(filter.expression)
    if (compiled.error) throw new Error(`${filter.name}: ${compiled.error}`)
  }
  const filterIds = new Set(result.filters.map((filter) => filter.id))
  for (const [pane, filters] of Object.entries(result.paneFilters))
    result.paneFilters[pane] = filters.filter((id) => filterIds.has(id))
  return result
}

export interface MessageClassification {
  message: NormalizedChatMessage
  hidden: boolean
  placeholder: boolean
  highlighted: boolean
  mention: boolean
  color?: string
  sound: boolean
  flash: boolean
  rules: string[]
}

/** Replacements keep emote offsets valid and remove emotes overlapping a replaced range. */
export function replaceMessageText(
  message: NormalizedChatMessage,
  pattern: RuleRegex | RegExp,
  replacement: string,
): NormalizedChatMessage {
  const compiled =
    pattern instanceof RegExp ? compileRuleRegex(pattern.source, pattern.ignoreCase) : pattern
  const ranges = compiled
    .matchAll(message.text)
    .filter((match) => match.text.length > 0)
    .map((match) => ({ start: match.index, end: match.index + match.text.length }))
  if (!ranges.length) return message
  let text = ''
  let end = 0
  for (const range of ranges) {
    text += message.text.slice(end, range.start) + replacement
    end = range.end
  }
  text += message.text.slice(end)
  const emotes = message.emotes
    .map((emote) => ({
      ...emote,
      positions: emote.positions.flatMap((position) => {
        if (ranges.some((range) => position.start < range.end && position.end >= range.start))
          return []
        const shift = ranges
          .filter((range) => range.end <= position.start)
          .reduce((delta, range) => delta + replacement.length - (range.end - range.start), 0)
        return [{ start: position.start + shift, end: position.end + shift }]
      }),
    }))
    .filter((emote) => emote.positions.length > 0)
  return { ...message, text, emotes }
}

export function compileMessageRules(
  rules: ChatRules,
  accounts: Account[],
  contextFor?: (message: NormalizedChatMessage) => FilterContext,
) {
  const ownMention = createMentionMatcher(accounts)
  const highlights = rules.highlights
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      rule,
      pattern: rule.target === 'filter' ? null : compilePattern(rule),
      filter: rule.target === 'filter' ? compileFilterExpression(rule.pattern) : null,
    }))
  const ignores = rules.ignores
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, pattern: compilePattern(rule) }))
  const filters = new Map(
    rules.filters.map((filter) => [filter.id, compileFilterExpression(filter.expression)]),
  )
  const cache = new WeakMap<NormalizedChatMessage, MessageClassification>()
  return {
    classify(original: NormalizedChatMessage): MessageClassification {
      const previous = cache.get(original)
      if (previous) return previous
      const own = accounts.some(
        (account) =>
          account.platform === original.platform && account.platformUserId === original.author.id,
      )
      const mention = ownMention(
        rules.highlightReplies ? original : { ...original, reply: undefined },
      )
      const result: MessageClassification = {
        message: original,
        hidden: false,
        placeholder: false,
        highlighted:
          mention || (rules.providerHighlights && original.metadata?.highlighted === true),
        mention,
        sound: false,
        flash: false,
        rules: [],
      }
      let suppressHighlights = false
      for (const { rule, pattern } of ignores) {
        if (rule.platform && rule.platform !== original.platform) continue
        const value =
          rule.target === 'user'
            ? (original.author.username ?? original.author.displayName)
            : result.message.text
        if (!(rule.userId ? rule.userId === original.author.id : pattern.test(value))) continue
        const action = rule.action ?? (rule.replacement !== undefined ? 'replace' : 'hide')
        if (action === 'suppress-highlights') suppressHighlights = true
        else if (rule.target === 'message' && action === 'replace')
          result.message = replaceMessageText(result.message, pattern, rule.replacement ?? '')
        else {
          result.hidden = true
          result.placeholder ||= rule.placeholder
        }
      }
      if (!own || rules.highlightOwnMessages)
        for (const { rule, pattern, filter } of highlights) {
          const values =
            rule.target === 'user'
              ? [original.author.username ?? original.author.displayName]
              : rule.target === 'badge'
                ? original.author.badges.flatMap((badge) => [badge.type, badge.id, badge.text])
                : [result.message.text]
          const matched = filter
            ? filter.matches(result.message, {
                ...contextFor?.(original),
                highlighted: result.highlighted,
              })
            : values.some((value) => pattern!.test(value))
          if (!matched) continue
          result.highlighted = true
          result.mention ||= rule.mentions
          result.color = rule.color
          result.sound ||= rule.sound
          result.flash ||= rule.flash
          result.rules.push(rule.id)
        }
      if (suppressHighlights) {
        result.highlighted = false
        result.mention = false
        result.color = undefined
        result.sound = false
        result.flash = false
        result.rules = []
      }
      cache.set(original, result)
      return result
    },
    matchesFilters(
      message: NormalizedChatMessage,
      paneId: string,
      context: FilterContext = {},
    ): boolean {
      const classification = this.classify(message)
      if (
        rules.filterOwnMessages === false &&
        accounts.some(
          (account) =>
            account.platform === message.platform && account.platformUserId === message.author.id,
        )
      )
        return true
      return (rules.paneFilters[paneId] ?? []).every(
        (id) =>
          filters.get(id)?.matches(classification.message, {
            ...contextFor?.(message),
            ...context,
            highlighted: classification.highlighted,
          }) ?? true,
      )
    },
  }
}
