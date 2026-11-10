import { chatMessageIdentity } from '@twirchat/shared/message-identity'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { compareMessages } from '../../views/main/utils/chat-message-buffer'
import { persistentResource } from './persistent-resources'

const FEED_LIMIT = 500
type Buffer = readonly NormalizedChatMessage[]
type WatchedBuffers = ReadonlyMap<string, Buffer>

interface FeedSnapshot {
  messages: NormalizedChatMessage[]
  sourceByKey: ReadonlyMap<string, string>
  hasDuplicates: boolean
}

interface SourceTail {
  channelId: string
  buffer: readonly NormalizedChatMessage[]
  index: number
  message: NormalizedChatMessage
}

const EMPTY_FEED: FeedSnapshot = { messages: [], sourceByKey: new Map(), hasDuplicates: false }
const lineage = persistentResource('watchedFeedLineage', () => ({
  readers: new Map(),
  parents: new WeakMap(),
}))

export function observeWatchedFeedSources(channelIds: readonly string[]): () => void {
  for (const id of channelIds) lineage.readers.set(id, (lineage.readers.get(id) ?? 0) + 1)
  return () => {
    for (const id of channelIds) {
      const count = lineage.readers.get(id) ?? 0
      if (count <= 1) lineage.readers.delete(id)
      else lineage.readers.set(id, count - 1)
    }
  }
}

/** A live append can only add messages and evict an oldest prefix. */
export function recordWatchedFeedAppend(id: string, previous: Buffer, next: Buffer): void {
  if (lineage.readers.has(id)) lineage.parents.set(next, new WeakRef(previous))
}

function lowerBound(messages: Buffer, message: NormalizedChatMessage): number {
  let low = 0
  let high = messages.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const candidate = messages[middle]
    if (candidate && compareMessages(candidate, message) < 0) low = middle + 1
    else high = middle
  }
  return low
}

function mergeTails(
  channelIds: readonly string[],
  buffers: readonly (readonly NormalizedChatMessage[] | undefined)[],
): FeedSnapshot {
  const sourceTails: SourceTail[] = []
  channelIds.forEach((channelId, sourceIndex) => {
    const buffer = buffers[sourceIndex]
    const message = buffer?.at(-1)
    if (buffer && message)
      sourceTails.push({ channelId, buffer, index: buffer.length - 1, message })
  })
  if (!sourceTails.length) return EMPTY_FEED
  const tails = sourceTails.toSorted((left, right) => compareMessages(left.message, right.message))
  const messages: NormalizedChatMessage[] = []
  const sourceByKey = new Map<string, string>()
  let hasDuplicates = false
  // Only read the newest retained rows. Older rows are already sorted in each source.
  while (messages.length < FEED_LIMIT) {
    const tail = tails.pop()
    if (!tail) break
    const key = chatMessageIdentity(tail.message)
    if (!sourceByKey.has(key)) {
      sourceByKey.set(key, tail.channelId)
      messages.push(tail.message)
    } else hasDuplicates = true
    const next = tail.buffer[--tail.index]
    if (!next) continue
    tail.message = next
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const candidate = tails[middle]
      if (candidate && compareMessages(candidate.message, next) < 0) low = middle + 1
      else high = middle
    }
    tails.splice(low, 0, tail)
  }
  return { messages: messages.toReversed(), sourceByKey, hasDuplicates }
}

function extendFeed(
  current: FeedSnapshot,
  channelIds: readonly string[],
  previous: readonly (Buffer | undefined)[],
  next: readonly (Buffer | undefined)[],
): FeedSnapshot | undefined {
  const cutoff = current.messages[0]
  if (!cutoff || current.hasDuplicates) return undefined
  const full = current.messages.length >= FEED_LIMIT
  const expired: number[] = []
  const additions = new Map<string, { message: NormalizedChatMessage; source: string }>()
  for (const [index, source] of channelIds.entries()) {
    const before = previous[index]
    const after = next[index]
    if (before === after) continue
    if (!after) return undefined
    let start = 0
    const last = before?.at(-1)
    if (before && last) {
      if (lineage.parents.get(after)?.deref() !== before) return undefined
      const first = after[0]
      if (!first) return undefined
      const dropped = lowerBound(before, first)
      start = before.length - dropped
      // Late inserts between retained messages require a fresh tail merge.
      if (before[dropped] !== first || after[start - 1] !== last) return undefined
      for (let i = lowerBound(before, cutoff); i < dropped; i++) {
        const message = before[i]
        if (!message) continue
        const row = lowerBound(current.messages, message)
        if (current.messages[row] === message) expired.push(row)
      }
    }
    for (let i = start; i < after.length; i++) {
      const message = after[i]
      if (!message || (full && compareMessages(message, cutoff) < 0)) continue
      const key = chatMessageIdentity(message)
      if (current.sourceByKey.has(key) || additions.has(key)) return undefined
      additions.set(key, { message, source })
    }
  }
  if (!expired.length && !additions.size) return current
  // Refill from older rows only if evictions move the retained boundary backwards.
  if (full && current.messages.length - expired.length + additions.size < FEED_LIMIT)
    return undefined
  const messages = current.messages.slice()
  const sourceByKey = new Map(current.sourceByKey)
  for (const index of expired.toSorted((a, b) => b - a)) {
    const message = messages[index]
    if (message) sourceByKey.delete(chatMessageIdentity(message))
    messages.splice(index, 1)
  }
  for (const [key, { message, source }] of additions) {
    messages.splice(lowerBound(messages, message), 0, message)
    sourceByKey.set(key, source)
  }
  if (messages.length <= FEED_LIMIT) return { messages, sourceByKey, hasDuplicates: false }
  for (const message of messages.splice(0, messages.length - FEED_LIMIT))
    sourceByKey.delete(chatMessageIdentity(message))
  return { messages, sourceByKey, hasDuplicates: false }
}

export function readWatchedFeed(
  channelIds: readonly string[],
  buffers: WatchedBuffers,
): FeedSnapshot {
  return mergeTails(
    channelIds,
    channelIds.map((id) => buffers.get(id)),
  )
}

/** Keep a mounted feed's snapshot stable when other watched channels receive messages. */
export function createWatchedFeedReader(channelIds: readonly string[]) {
  if (!channelIds.length) return () => EMPTY_FEED
  let previous: WatchedBuffers | undefined
  let buffers = channelIds.map<Buffer | undefined>(() => undefined)
  let snapshot = EMPTY_FEED
  return (next: WatchedBuffers): FeedSnapshot => {
    if (previous !== next) {
      previous = next
      if (channelIds.some((id, index) => next.get(id) !== buffers[index])) {
        const selected = channelIds.map((id) => next.get(id))
        snapshot =
          extendFeed(snapshot, channelIds, buffers, selected) ?? mergeTails(channelIds, selected)
        buffers = selected
      }
    }
    return snapshot
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    watchedFeedLineage: {
      readers: Map<string, number>
      parents: WeakMap<Buffer, WeakRef<Buffer>>
    }
  }
}
