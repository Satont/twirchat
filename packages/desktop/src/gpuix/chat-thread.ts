import { normalizeMessageChannel } from '@twirchat/shared/message-identity'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

const MAX_RETAINED_THREAD_REPLIES = 500

type ThreadRoot =
  | { id: string; kind: 'message' | 'preview'; message: NormalizedChatMessage }
  | { id: string; kind: 'unavailable' }

interface TwitchThread {
  root: ThreadRoot
  replies: readonly NormalizedChatMessage[]
}

function findRootId(
  selected: NormalizedChatMessage,
  messagesById: ReadonlyMap<string, NormalizedChatMessage>,
): string {
  const visited = new Set<string>()
  let id = selected.id
  let reply = selected.reply
  while (reply && !visited.has(id)) {
    if (reply.threadRootMessageId) return reply.threadRootMessageId
    visited.add(id)
    id = reply.parentMessageId
    reply = messagesById.get(id)?.reply
  }
  return id
}

export function selectTwitchThread(
  selected: NormalizedChatMessage,
  messages: readonly NormalizedChatMessage[],
  retained?: TwitchThread,
): TwitchThread {
  const channel = normalizeMessageChannel('twitch', selected.channelId)
  const messagesById = new Map<string, NormalizedChatMessage>()
  for (const reply of retained?.replies ?? []) messagesById.set(reply.id, reply)
  for (const message of messages) {
    if (
      message.platform === 'twitch' &&
      normalizeMessageChannel('twitch', message.channelId) === channel
    ) {
      messagesById.set(message.id, message)
    }
  }
  const selectedRetained = messagesById.has(selected.id)
  if (!selectedRetained) messagesById.set(selected.id, selected)
  const rootId = retained?.root.id ?? findRootId(selected, messagesById)
  const rootMessage = messagesById.get(rootId)
  let root: ThreadRoot = rootMessage
    ? { id: rootId, kind: 'message', message: rootMessage }
    : (retained?.root ?? { id: rootId, kind: 'unavailable' })
  const children = new Map<string, string[]>()
  for (const message of messagesById.values()) {
    const reply = message.reply
    if (!reply || (reply.threadRootMessageId && reply.threadRootMessageId !== rootId)) continue
    if (root.kind === 'unavailable' && reply.parentMessageId === rootId) {
      root = {
        id: rootId,
        kind: 'preview',
        message: {
          id: rootId,
          platform: 'twitch',
          channelId: channel,
          author: { ...reply.parentAuthor, badges: [] },
          text: reply.parentMessageText,
          emotes: [],
          // The parent predates the reply; use a conservative timestamp for moderation.
          timestamp: new Date(0),
          type: 'message',
        },
      }
    }
    const parentId = reply.threadRootMessageId ?? reply.parentMessageId
    const siblings = children.get(parentId)
    if (siblings) siblings.push(message.id)
    else children.set(parentId, [message.id])
  }

  // The clicked row remains an anchor even after the chat buffer evicts its ancestors.
  const visited = new Set<string>([rootId, selected.id])
  for (const id of visited) {
    for (const child of children.get(id) ?? []) visited.add(child)
  }
  const replies = [...messagesById.values()].filter(
    (message) => message.id !== rootId && visited.has(message.id),
  )
  if (!selectedRetained || retained?.replies.length)
    replies.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const boundedReplies =
    replies.length > MAX_RETAINED_THREAD_REPLIES
      ? replies.slice(-MAX_RETAINED_THREAD_REPLIES)
      : replies
  return {
    root,
    replies:
      retained?.replies.length === boundedReplies.length &&
      boundedReplies.every((reply, index) => reply === retained.replies[index])
        ? retained.replies
        : boundedReplies,
  }
}
