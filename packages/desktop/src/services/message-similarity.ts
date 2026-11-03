import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'
import { z } from 'zod'

import { deleteOldestEntry } from './bounded-cache'

export interface MessageSimilaritySettings {
  enabled: boolean
  hideSimilar: boolean
  threshold: number
  maxMessages: number
  delaySeconds: number
  sameUserOnly: boolean
  excludeOwn: boolean
  graySimilar: boolean
  shownSimilarTriggerHighlights: boolean
}
export const DEFAULT_MESSAGE_SIMILARITY_SETTINGS: MessageSimilaritySettings = {
  enabled: false,
  hideSimilar: false,
  threshold: 0.9,
  maxMessages: 3,
  delaySeconds: 5,
  sameUserOnly: true,
  excludeOwn: true,
  graySimilar: true,
  shownSimilarTriggerHighlights: false,
}
const similaritySettingsSchema = z.toZod<MessageSimilaritySettings>()(
  z.object({
    enabled: z.boolean(),
    hideSimilar: z.boolean(),
    sameUserOnly: z.boolean(),
    excludeOwn: z.boolean(),
    graySimilar: z.boolean(),
    shownSimilarTriggerHighlights: z.boolean(),
    threshold: z.number().min(0).max(1),
    maxMessages: z.number().int().min(0).max(100),
    delaySeconds: z.number().int().min(0).max(3600),
  }),
)
export function validateMessageSimilaritySettings(value: unknown): MessageSimilaritySettings {
  const parsed = similaritySettingsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Invalid message similarity settings.')
  return parsed.data
}
/** Exact longest common CONTIGUOUS UTF-16 substring score, case-sensitive. */
export function messageSimilarityScore(first: string, second: string): number {
  if (!first.length || !second.length) return 0
  if (first === second) return 1
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first]
  const row = new Uint32Array(shorter.length + 1)
  let longest = 0
  for (let outer = 0; outer < longer.length; outer++) {
    for (let inner = shorter.length; inner > 0; inner--) {
      const length =
        longer.charCodeAt(outer) === shorter.charCodeAt(inner - 1) ? (row[inner - 1] ?? 0) + 1 : 0
      row[inner] = length
      if (length > longest) longest = length
    }
  }
  return longest / Math.max(1, first.length, second.length)
}
/** Testing a score threshold only needs to find a substring of this minimum length. */
export function exceedsMessageSimilarity(
  first: string,
  second: string,
  threshold: number,
): boolean {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return false
  if (!first.length || !second.length) return false
  const length = Math.max(first.length, second.length)
  let required = Math.floor(threshold * length) + 1
  // Keep division-boundary behavior identical even when multiplication rounds across an integer.
  while (required > 1 && (required - 1) / length > threshold) required--
  while (required / length <= threshold) required++
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first]
  if (required > shorter.length) return false
  if (first === second) return true
  for (let start = 0; start <= shorter.length - required; start++) {
    if (longer.includes(shorter.slice(start, start + required))) return true
  }
  return false
}
export interface MessageSimilarityFlags {
  similar: boolean
  gray: boolean
  triggerHighlights: boolean
}
interface PreviousMessage {
  id: string
  text: string
  timestamp: number
  author: string
}
type OwnAccount = Pick<Account, 'platform' | 'platformUserId' | 'username'>
export const similarityChannelKey = (message: NormalizedChatMessage): string =>
  JSON.stringify([message.platform, message.channelId])
const authorKey = (message: NormalizedChatMessage) =>
  `${message.platform}:${message.author.username ?? message.author.id ?? message.author.displayName}`
const messageKey = (message: NormalizedChatMessage): string =>
  `${message.platform}:${message.channelId.length}:${message.channelId}${message.id}`
const CLASSIFICATION_LIMIT = 25000
export function createMessageSimilarityClassifier(
  settings = DEFAULT_MESSAGE_SIMILARITY_SETTINGS,
  ownAccounts: readonly OwnAccount[] = [],
  now = Date.now,
) {
  let configuration = validateMessageSimilaritySettings(settings)
  let accounts = ownAccounts
  const history = new Map<string, PreviousMessage[]>()
  const classifications = new Map<string, { channelKey: string; similar: boolean }>()
  let classificationKeys: string[] = []
  let classificationCursor = 0
  const derived = (similar: boolean): Readonly<MessageSimilarityFlags> =>
    Object.freeze({
      similar,
      gray: similar && configuration.graySimilar,
      triggerHighlights:
        !similar || (!configuration.hideSimilar && configuration.shownSimilarTriggerHighlights),
    })
  let normalFlags = derived(false)
  let similarFlags = derived(true)
  const previous = (message: NormalizedChatMessage, id: string): PreviousMessage => {
    const timestamp = message.timestamp.getTime()
    return {
      id,
      text: message.text,
      timestamp: Number.isFinite(timestamp) ? timestamp : now(),
      author: authorKey(message),
    }
  }
  const remember = (key: string, messages: PreviousMessage[]) => {
    history.delete(key)
    history.set(
      key,
      messages.length > configuration.maxMessages
        ? messages.slice(0, configuration.maxMessages)
        : messages,
    )
    if (history.size > 256) deleteOldestEntry(history)
  }
  const rememberClassification = (id: string, channelKey: string, similar: boolean): void => {
    if (classificationKeys.length < CLASSIFICATION_LIMIT) {
      classificationKeys.push(id)
    } else {
      const oldest = classificationKeys[classificationCursor]
      if (oldest !== undefined) classifications.delete(oldest)
      classificationKeys[classificationCursor] = id
      classificationCursor = (classificationCursor + 1) % CLASSIFICATION_LIMIT
    }
    classifications.set(id, { channelKey, similar })
  }
  return {
    getSimilarity(message: NormalizedChatMessage): boolean | undefined {
      return classifications.get(messageKey(message))?.similar
    },
    seedClassification(
      message: NormalizedChatMessage,
      channelKey: string,
      similar: boolean,
    ): boolean {
      const id = messageKey(message)
      if (classifications.has(id)) return false
      rememberClassification(id, channelKey, similar)
      return true
    },
    classifyIncoming(
      message: NormalizedChatMessage,
      channelKey = similarityChannelKey(message),
    ): Readonly<MessageSimilarityFlags> {
      const id = messageKey(message)
      const known = classifications.get(id)
      if (known) return known.similar ? similarFlags : normalFlags
      const incoming = previous(message, id)
      const priorMessages = history.get(channelKey) ?? []
      let similar = false
      if (
        configuration.enabled &&
        message.type !== 'system' &&
        (message.platform === 'twitch' || message.platform === 'kick') &&
        !(
          configuration.excludeOwn &&
          accounts.some(
            (account) =>
              account.platform === message.platform &&
              (account.platformUserId === message.author.id ||
                (message.author.username !== undefined &&
                  account.username === message.author.username)),
          )
        )
      ) {
        // The underlying snapshot is limited BEFORE applying the user condition.
        for (const prior of priorMessages) {
          if (
            Math.trunc((incoming.timestamp - prior.timestamp) / 1000) >= configuration.delaySeconds
          )
            break
          if (configuration.sameUserOnly && prior.author !== incoming.author) continue
          if (exceedsMessageSimilarity(incoming.text, prior.text, configuration.threshold)) {
            similar = true
            break
          }
        }
      }
      const nextHistory = configuration.maxMessages > 0 ? [incoming] : []
      for (
        let index = 0;
        index < Math.min(priorMessages.length, configuration.maxMessages - 1);
        index++
      ) {
        const prior = priorMessages[index]
        if (prior) nextHistory.push(prior)
      }
      remember(channelKey, nextHistory)
      rememberClassification(id, channelKey, similar)
      return similar ? similarFlags : normalFlags
    },
    hydrate(channelKey: string, newestFirstMessages: readonly NormalizedChatMessage[]): void {
      const merged = new Map<string, PreviousMessage>()
      for (const entry of [
        ...(history.get(channelKey) ?? []),
        ...newestFirstMessages
          .slice(0, configuration.maxMessages)
          .map((message) => previous(message, messageKey(message))),
      ])
        if (!merged.has(entry.id)) merged.set(entry.id, entry)
      remember(
        channelKey,
        [...merged.values()].sort((a, b) => b.timestamp - a.timestamp),
      )
    },
    reset(channelKey?: string): void {
      if (channelKey === undefined) {
        history.clear()
        classifications.clear()
        classificationKeys = []
      } else {
        history.delete(channelKey)
        for (const [id, entry] of classifications)
          if (entry.channelKey === channelKey) classifications.delete(id)
        classificationKeys = Array.from(classifications.keys())
      }
      classificationCursor = 0
    },
    configure(next: MessageSimilaritySettings, own?: readonly OwnAccount[]): void {
      configuration = validateMessageSimilaritySettings(next)
      normalFlags = derived(false)
      similarFlags = derived(true)
      if (own) accounts = own
      for (const [key, messages] of history)
        history.set(key, messages.slice(0, configuration.maxMessages))
    },
  }
}
