import { computed, onMounted, type ComputedRef } from 'vue'

import type { Emote, NormalizedChatMessage, Platform } from '@twirchat/shared/types'

import { rpc } from '../main'

const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

export const mentionColorCache = new Map<string, string | null>()

export interface MessagePart {
  type: 'text' | 'emote'
  content?: string
  emote?: Emote
}

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function linkifyText(escaped: string): string {
  return escaped.replace(URL_REGEX, (url) => {
    const safeUrl = url.replace(/"/g, '&quot;')
    return `<a class="msg-link" href="#" data-href="${safeUrl}" title="${safeUrl}">${url}</a>`
  })
}

function highlightMentions(escaped: string, platform: string): string {
  return escaped.replace(MENTION_REGEX, (match, username) => {
    const key = makeMentionKey(platform, username)
    const color = mentionColorCache.get(key)
    if (color) {
      return `<span class="mention" style="color: ${color}; font-weight: 600;">${match}</span>`
    }

    void fetchMentionColor(platform, username)
    return match
  })
}

export function useMessageParsing(message: NormalizedChatMessage): {
  messageParts: ComputedRef<MessagePart[]>
  processText: (text: string) => string
} {
  const messageParts = computed((): MessagePart[] => {
    const parts: MessagePart[] = []

    if (!message.emotes.length) {
      return [{ content: message.text, type: 'text' }]
    }

    const chars = [...message.text]
    let i = 0

    const ranges: { start: number; end: number; emote: Emote }[] = []
    for (const emote of message.emotes) {
      for (const pos of emote.positions) {
        ranges.push({ ...pos, emote })
      }
    }
    ranges.sort((a, b) => a.start - b.start)

    for (const range of ranges) {
      if (i < range.start) {
        parts.push({ content: chars.slice(i, range.start).join(''), type: 'text' })
      }
      parts.push({ emote: range.emote, type: 'emote' })
      i = range.end + 1
    }

    if (i < chars.length) {
      parts.push({ content: chars.slice(i).join(''), type: 'text' })
    }

    return parts
  })

  function processText(text: string): string {
    let result = escapeHtml(text)
    result = linkifyText(result)
    result = highlightMentions(result, message.platform)
    return result
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
