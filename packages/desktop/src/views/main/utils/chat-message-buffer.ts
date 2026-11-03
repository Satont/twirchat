import type { NormalizedChatMessage } from '@twirchat/shared/types'

function messageTimestamp(message: NormalizedChatMessage): number {
  const timestamp =
    message.timestamp instanceof Date
      ? message.timestamp.getTime()
      : new Date(message.timestamp).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function messageKey(message: NormalizedChatMessage): string {
  return `${message.platform}:${message.id}`
}

function compareMessages(left: NormalizedChatMessage, right: NormalizedChatMessage): number {
  const byTimestamp = messageTimestamp(left) - messageTimestamp(right)
  if (byTimestamp !== 0) return byTimestamp
  const leftKey = messageKey(left)
  const rightKey = messageKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** Append live messages without rebuilding and sorting the entire buffer. */
export function appendLiveChatMessages(
  current: NormalizedChatMessage[],
  incoming: readonly NormalizedChatMessage[],
  limit = 500,
): NormalizedChatMessage[] {
  if (incoming.length === 0) return current
  // A batch pays for one identity index and one array copy. For a single
  // message a linear identity check avoids allocating an index altogether.
  const keys = incoming.length > 1 ? new Set(current.map(messageKey)) : null
  let next = current
  for (const message of incoming) {
    const key = messageKey(message)
    if (
      keys
        ? keys.has(key)
        : current.some((entry) => entry.platform === message.platform && entry.id === message.id)
    )
      continue
    keys?.add(key)
    const first = next[0]
    if (limit > 0 && next.length >= limit && first && compareMessages(message, first) <= 0) {
      continue
    }
    if (next === current) next = current.slice()
    const last = next.at(-1)
    if (!last || compareMessages(last, message) < 0) {
      next.push(message)
      continue
    }
    // Late delivery is uncommon; binary insertion keeps chronology without
    // penalizing the normal append-only path with a full sort.
    let low = 0
    let high = next.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const candidate = next[middle]
      if (candidate && compareMessages(candidate, message) < 0) low = middle + 1
      else high = middle
    }
    next.splice(low, 0, message)
  }
  return limit > 0 && next.length > limit ? next.slice(-limit) : next
}

// A history request is only a snapshot: live Wails events can arrive while it
// is in flight. Merge instead of replacing the buffer, otherwise a late
// snapshot can erase messages that were just rendered.
export function mergeChatMessageSnapshot(
  current: NormalizedChatMessage[],
  snapshot: NormalizedChatMessage[],
  limit = 500,
): NormalizedChatMessage[] {
  const messagesByID = new Map<string, NormalizedChatMessage>()
  for (const message of snapshot) messagesByID.set(messageKey(message), message)
  for (const message of current) messagesByID.set(messageKey(message), message)

  const messages = [...messagesByID.values()].sort(compareMessages)
  const next = limit > 0 && messages.length > limit ? messages.slice(-limit) : messages
  return next.length === current.length &&
    next.every((message, index) => message === current[index])
    ? current
    : next
}
