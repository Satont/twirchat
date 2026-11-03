import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'

export interface MessagePart {
  type: 'text' | 'emote'
  content?: string
  emote?: Emote
}

export function buildMessageParts(message: NormalizedChatMessage): MessagePart[] {
  if (!message.emotes.length) {
    return [{ content: message.text, type: 'text' }]
  }

  const parts: MessagePart[] = []
  const ranges: { start: number; end: number; emote: Emote }[] = []

  for (const emote of message.emotes) {
    for (const position of emote.positions) {
      ranges.push({ emote, ...position })
    }
  }

  ranges.sort((a, b) => a.start - b.start)

  let index = 0

  for (const range of ranges) {
    // Overlapping or out-of-range positions (bad upstream offsets) would
    // duplicate text or emit an emote past the end — skip them.
    if (range.start < index || range.start >= message.text.length) continue
    if (index < range.start) {
      parts.push({ content: message.text.slice(index, range.start), type: 'text' })
    }

    parts.push({ emote: range.emote, type: 'emote' })
    index = range.end + 1
  }

  if (index < message.text.length) {
    parts.push({ content: message.text.slice(index), type: 'text' })
  }

  return parts
}
