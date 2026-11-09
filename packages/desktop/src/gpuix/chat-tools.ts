import { normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { t } from './i18n'
import { compileRuleRegex } from './rule-regex'

export function chatMessageKey(message: NormalizedChatMessage): string {
  return `${message.platform}:${normalizeMessageChannel(message.platform, message.channelId)}:${message.id}`
}

/** Compile once per account change, rather than once per rendered row. */
export function createMentionMatcher(
  accounts: Account[],
): (message: NormalizedChatMessage) => boolean {
  const matchers = accounts.map((account) => {
    const names = [
      ...new Set([account.username, account.displayName].map((n) => n.trim()).filter(Boolean)),
    ]
    const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return {
      account,
      pattern: escaped.length
        ? new RegExp(`(?:^|[^\\p{L}\\p{N}_])@?(?:${escaped.join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'iu')
        : null,
    }
  })
  return (message) => {
    if (message.type === 'system') return false
    return matchers.some(({ account, pattern }) => {
      if (message.platform !== account.platform) return false
      if (
        message.author.id === account.platformUserId ||
        message.author.username?.toLowerCase() === account.username.toLowerCase()
      )
        return false
      const parent = message.reply?.parentAuthor
      if (
        parent &&
        ((parent.id && parent.id === account.platformUserId) ||
          (parent.username && parent.username.toLowerCase() === account.username.toLowerCase()))
      )
        return true
      // A username inside a link is not a mention.
      return pattern?.test(message.text.replace(/(?:https?:\/\/|www\.)\S+/giu, ' ')) ?? false
    })
  }
}

export interface SearchDetails {
  alias?: string
  similar?: boolean
  highlighted?: boolean
  deleted?: boolean
  channelName?: string
}

export type SearchableChatMessage = Omit<NormalizedChatMessage, 'platform' | 'timestamp'> & {
  platform: string
}

type Predicate = (message: SearchableChatMessage, details: SearchDetails) => boolean

/** Predicates are compiled once; regular expressions use bounded PCRE2 matching. */
export function compileChatSearch(query: string): {
  matches: Predicate
  error?: string
} {
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let escaped = false
  for (const char of query.slice(0, 2000)) {
    if (escaped) {
      token += char === '"' ? char : `\\${char}`
      escaped = false
    } else if (char === '\\' && quoted) escaped = true
    else if (char === '"') quoted = !quoted
    else if (/\s/u.test(char) && !quoted) {
      if (token) tokens.push(token)
      token = ''
    } else token += char
  }
  if (escaped) token += '\\'
  if (token) tokens.push(token)
  let error: string | undefined
  const predicates: Predicate[] = tokens.map((raw) => {
    const negate = raw.length > 1 && (raw.startsWith('!') || raw.startsWith('-'))
    const original = negate ? raw.slice(1) : raw
    const term = original.toLowerCase()
    const colon = term.indexOf(':')
    const key = colon > 0 ? term.slice(0, colon) : ''
    const value = term.slice(colon + 1)
    const values = value.split(',').map((part) => part.replace(/^[@#]/u, ''))
    let predicate: Predicate
    switch (key) {
      case 'regex':
        try {
          const regex = compileRuleRegex(original.slice(colon + 1), true)
          predicate = (m) => regex.test(m.text)
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
          return () => false
        }
        break
      case 'subtier':
        predicate = (m) =>
          m.author.badges.some((badge) => {
            if (badge.type !== 'subscriber') return false
            const version = badge.id.replace(/^subscriber[/:]/u, '')
            return values.includes(version.length > 3 ? version[0]! : '1')
          })
        break
      case 'client':
        predicate = (m) => values.includes(m.metadata?.clientDetection?.toLowerCase() ?? '')
        break
      case 'from':
        predicate = (m, d) =>
          values.some((v) =>
            [m.author.username, m.author.displayName, m.author.id, d.alias].some(
              (name) => name?.toLowerCase() === v,
            ),
          )
        break
      case 'in':
        predicate = (m, d) =>
          values.some((v) =>
            [m.channelId, d.channelName].some(
              (name) => name?.replace(/^#/u, '').toLowerCase() === v,
            ),
          )
        break
      case 'platform':
        predicate = (m) => values.includes(m.platform)
        break
      case 'badge':
        predicate = (m) =>
          m.author.badges.some((b) =>
            values.some((v) => [b.id, b.type, b.text].some((name) => name.toLowerCase() === v)),
          )
        break
      case 'has':
        predicate = (m) =>
          values.some((v) =>
            v === 'link'
              ? /(?:https?:\/\/|www\.)\S+/iu.test(m.text)
              : v === 'emote'
                ? m.emotes.length > 0
                : v === 'reply'
                  ? !!m.reply
                  : false,
          )
        break
      case 'is':
        predicate = (m, d) => {
          const flags = m.metadata?.flags ?? {}
          const timeout = flags.timeout === true || flags.ban === true
          // Upstream excludes moderation notices from is:system unless timeout
          // or ban was explicitly included in the same OR predicate.
          if (
            values.includes('system') &&
            !values.some((v) => v === 'timeout' || v === 'ban') &&
            timeout
          )
            return false
          return values.some((value) => {
            const aliases: Record<string, string> = {
              disabled: 'deleted',
              sub: 'sub_message',
              subscription: 'sub_message',
              ban: 'timeout',
              'first-msg': 'first_message',
              'cheer-msg': 'cheer_message',
              'watch-streak': 'watch_streak',
              repeated: 'repeated_message',
              'repeated-message': 'repeated_message',
              'repeated-messages': 'repeated_message',
              repeated_messages: 'repeated_message',
            }
            const flag = aliases[value] ?? value
            switch (flag) {
              case 'similar':
                return d.similar ?? flags.similar ?? false
              case 'reply':
                return !!m.reply
              case 'highlighted':
              case 'mention':
                return d.highlighted ?? m.metadata?.highlighted ?? flags.highlighted ?? false
              case 'deleted':
                return d.deleted ?? flags.deleted ?? false
              case 'action':
              case 'system':
                return m.type === flag
              case 'failed':
                return m.delivery?.state === 'failed'
              case 'first_message':
                return m.metadata?.firstMessage ?? flags.first_message ?? false
              case 'cheer_message':
                return (m.metadata?.bits ?? 0) > 0 || flags.cheer_message === true
              case 'redemption':
                return (
                  !!m.metadata?.rewardId ||
                  flags.points_redeemed === true ||
                  flags.redeemed_highlight === true
                )
              case 'shared':
                return !!m.metadata?.sharedChat || flags.shared === true
              case 'announcement':
                return !!m.metadata?.announcement || flags.announcement === true
              case 'timeout':
                return timeout
              case 'repeated_message':
                return flags.repeated_message ?? flags.repeated_messages ?? false
              default:
                return flags[flag] === true
            }
          })
        }
        break
      default:
        predicate = (m, d) =>
          [m.text, m.author.username, m.author.displayName, d.alias].some((text) =>
            text?.toLowerCase().includes(term),
          )
    }
    return negate ? (m, d) => !predicate(m, d) : predicate
  })
  return {
    matches: (message, details) => predicates.every((predicate) => predicate(message, details)),
    ...(quoted ? { error: t('misc.chatSearch.closeQuote') } : error ? { error } : {}),
  }
}

type TranscriptMessage = Pick<SearchableChatMessage, 'platform' | 'author' | 'text'> & {
  timestamp: Date | number
}

export function formatChatTranscript(messages: readonly TranscriptMessage[]): string {
  return messages
    .map((message) => {
      const date = new Date(message.timestamp)
      const time = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString([], { hour12: false })
      return `[${time}] [${message.platform}] ${message.author.displayName}: ${message.text}`
    })
    .join('\n')
}
