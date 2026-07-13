import type { NormalizedChatMessage } from '@twirchat/shared/types'

function messageTimestamp(message: NormalizedChatMessage): number {
  return message.timestamp instanceof Date
    ? message.timestamp.getTime()
    : new Date(message.timestamp).getTime()
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
  for (const message of snapshot) messagesByID.set(message.id, message)
  for (const message of current) messagesByID.set(message.id, message)

  const messages = [...messagesByID.values()].sort((left, right) => {
    const byTimestamp = messageTimestamp(left) - messageTimestamp(right)
    return byTimestamp === 0 ? left.id.localeCompare(right.id) : byTimestamp
  })
  return limit > 0 && messages.length > limit ? messages.slice(-limit) : messages
}
