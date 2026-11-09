import { chatMessageIdentity, normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { getLanguage, t } from '../../../gpuix/i18n'
import type { UserChatHistoryPage } from '../../../shared/rpc'
import { sanitizeDisplayText, truncateGraphemes } from '../../shared/utils/display-text'
import { mergeChatMessageSnapshot } from './chat-message-buffer'

export const HISTORY_DISPLAY_LIMIT = 2000
const liveIndexes = new WeakMap<NormalizedChatMessage[], Map<string, NormalizedChatMessage>>()
const historyTimestampFormatters = new Map<string, Intl.DateTimeFormat>()

function historyTimestampFormatter(): Intl.DateTimeFormat {
  const language = getLanguage()
  let formatter = historyTimestampFormatters.get(language)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    historyTimestampFormatters.set(language, formatter)
  }
  return formatter
}

export interface HistoryUserTarget {
  platform: Platform
  platformUserId: string
  channelId?: string
}
export interface HistoryVisibleRange {
  start: number
  end: number
}

export function mergeHistoryMessages(
  current: NormalizedChatMessage[],
  incoming: NormalizedChatMessage[],
): NormalizedChatMessage[] {
  return mergeChatMessageSnapshot(current, incoming, HISTORY_DISPLAY_LIMIT)
}

export function appendLiveHistoryMessage(
  current: NormalizedChatMessage[],
  message: NormalizedChatMessage,
): NormalizedChatMessage[] {
  const identities =
    liveIndexes.get(current) ?? new Map(current.map((entry) => [chatMessageIdentity(entry), entry]))
  const identity = chatMessageIdentity(message)
  const existing = identities.get(identity)
  liveIndexes.set(current, identities)
  if (existing === message) return current
  const first = current[0]
  if (
    !existing &&
    current.length >= HISTORY_DISPLAY_LIMIT &&
    first &&
    compareHistoryMessages(message, first) <= 0
  )
    return current
  liveIndexes.delete(current)
  const next = current.slice()
  if (existing) next.splice(next.indexOf(existing), 1)
  let low = 0
  let high = next.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const candidate = next[middle]
    if (candidate && compareHistoryMessages(candidate, message) < 0) low = middle + 1
    else high = middle
  }
  next.splice(low, 0, message)
  identities.set(identity, message)
  if (next.length > HISTORY_DISPLAY_LIMIT)
    for (const removed of next.splice(0, next.length - HISTORY_DISPLAY_LIMIT))
      identities.delete(chatMessageIdentity(removed))
  liveIndexes.set(next, identities)
  return next
}

function compareHistoryMessages(left: NormalizedChatMessage, right: NormalizedChatMessage): number {
  const byTimestamp = left.timestamp.getTime() - right.timestamp.getTime()
  if (byTimestamp !== 0) return byTimestamp
  const a = chatMessageIdentity(left)
  const b = chatMessageIdentity(right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function matchesHistoryUser(
  message: NormalizedChatMessage,
  target: HistoryUserTarget,
): boolean {
  return (
    message.platform === target.platform &&
    message.author.id === target.platformUserId &&
    (!target.channelId ||
      normalizeMessageChannel(message.platform, message.channelId) ===
        normalizeMessageChannel(target.platform, target.channelId))
  )
}

export function formatHistoryTimestamp(timestamp: Date): string {
  return historyTimestampFormatter().format(timestamp)
}

export function historySourceNotice(history: UserChatHistoryPage['history']): string | null {
  if (!history) return null
  if (history.error)
    return t('commands.history.externalError', {
      error: truncateGraphemes(sanitizeDisplayText(history.error), 240),
    })
  if (history.sources.length && history.sources.every((source) => source.status !== 'ok'))
    return t('commands.history.unavailable')
  if (history.partial) return t('commands.history.partial')
  return t('commands.history.limited')
}

export function historyRowVisible(
  index: number,
  count: number,
  range: HistoryVisibleRange | null,
  leadingRows = 0,
): boolean {
  const row = index + leadingRows
  return range ? row >= range.start - 4 && row <= range.end + 4 : index >= count - 32
}
