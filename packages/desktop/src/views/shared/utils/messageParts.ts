import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'

export interface MessagePart {
  type: 'text' | 'emote'
  content?: string
  emote?: Emote
}

interface MessagePartWithAlias extends MessagePart {
  alias?: string
}

export function buildMessageParts(
  message: NormalizedChatMessage,
  includeAliases = false,
): MessagePartWithAlias[] {
  if (!message.emotes.length) {
    return [{ content: message.text, type: 'text' }]
  }

  const parts: MessagePartWithAlias[] = []
  const ranges: { start: number; end: number; emote: Emote }[] = []

  for (const emote of message.emotes) {
    for (const position of emote.positions) {
      ranges.push({ emote, ...position })
    }
  }

  ranges.sort((a, b) => a.start - b.start)

  // 7TV notices use a synthetic :alias: placeholder for the emote image.
  const readAliases = includeAliases && !message.metadata?.sevenTvAction
  let index = 0

  for (const range of ranges) {
    // Overlapping or out-of-range positions (bad upstream offsets) would
    // duplicate text or emit an emote past the end — skip them.
    if (range.start < index || range.start >= message.text.length) continue
    if (index < range.start) {
      parts.push({ content: message.text.slice(index, range.start), type: 'text' })
    }

    const part: MessagePartWithAlias = { emote: range.emote, type: 'emote' }
    if (readAliases && range.end >= range.start && range.end < message.text.length) {
      const provider = range.emote.provider ?? range.emote.source
      if (
        provider === 'seventv' ||
        provider === 'bttv' ||
        provider === 'ffz' ||
        provider === 'personal'
      ) {
        const alias = message.text.slice(range.start, range.end + 1)
        if (alias && alias !== range.emote.name) part.alias = alias
      }
    }
    parts.push(part)
    index = range.end + 1
  }

  if (index < message.text.length) {
    parts.push({ content: message.text.slice(index), type: 'text' })
  }

  return parts
}
