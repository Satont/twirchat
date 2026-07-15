import { computed, onMounted, type ComputedRef } from 'vue'

import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { rpc } from '../main'
import { buildMessageParts, type MessagePart } from '../../shared/utils/messageParts'
import { renderMessageText } from '../../shared/utils/message-text'

const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

export const mentionColorCache = new Map<string, string | null>()

function makeMentionKey(platform: string, username: string): string {
  return `${platform}:${username.toLowerCase()}`
}

async function fetchMentionColor(platform: string, username: string): Promise<void> {
  const key = makeMentionKey(platform, username)
  if (mentionColorCache.has(key)) {
    return
  }

  try {
    const color = await rpc.request.getUsernameColor({
      platform: platform as Platform,
      username,
    })
    if (mentionColorCache.size > 2000) {
      mentionColorCache.clear()
    }
    mentionColorCache.set(key, color)
  } catch (error) {
    console.warn('[useMessageParsing] Failed to fetch color for:', platform, username, error)
    if (mentionColorCache.size > 2000) {
      mentionColorCache.clear()
    }
    mentionColorCache.set(key, null)
  }
}

export function useMessageParsing(message: NormalizedChatMessage): {
  messageParts: ComputedRef<MessagePart[]>
  processText: (text: string) => string
} {
  const messageParts = computed((): MessagePart[] => buildMessageParts(message))

  function processText(text: string): string {
    return renderMessageText(text, message.platform, mentionColorCache)
  }

  onMounted(() => {
    const mentions = message.text.match(MENTION_REGEX)
    if (mentions) {
      const uniqueUsers = new Set(mentions.map((m) => m.slice(1)))
      for (const username of uniqueUsers) {
        void fetchMentionColor(message.platform, username)
      }
    }
  })

  return { messageParts, processText }
}
