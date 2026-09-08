/**
 * Tokenizer for chat message text.
 *
 * The Vue app rendered message HTML (linkified + mention-colored) inline.
 * GPUIX has no HTML and no inline images in text runs, so a message becomes
 * a flat list of tokens rendered as a wrapping flex row (see MessageText).
 *
 * Text runs keep their trailing whitespace inside the token — GPUI's text
 * layout measures it, which gives exact font-metric word spacing with
 * `columnGap: 0`.
 */

import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'
import { buildMessageParts } from '../views/shared/utils/messageParts'
import { mentionColor } from './state/caches'

export type MessageToken =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; color: string | null }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'emote'; emote: Emote }

const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

/** Break long unbreakable words (URLs) so the flex row can wrap them. */
const MAX_WORD_LENGTH = 28

function* wordsOf(segment: string): Generator<string> {
  // Split after each whitespace run: ["hello ", "world"].
  for (const match of segment.matchAll(/\S+\s*|\s+/g)) {
    let piece = match[0]
    while (piece.length > MAX_WORD_LENGTH) {
      yield piece.slice(0, MAX_WORD_LENGTH)
      piece = piece.slice(MAX_WORD_LENGTH)
    }
    if (piece) yield piece
  }
}

function pushSegment(
  tokens: MessageToken[],
  segment: string,
  platform: string,
  decorate: (word: string) => MessageToken,
): void {
  for (const word of wordsOf(segment)) {
    tokens.push(decorate(word))
  }
}

export function buildMessageTokens(message: NormalizedChatMessage): MessageToken[] {
  const parts = buildMessageParts(message)
  const tokens: MessageToken[] = []

  for (const part of parts) {
    if (part.type === 'emote' && part.emote) {
      tokens.push({ kind: 'emote', emote: part.emote })
      continue
    }
    const content = part.content
    if (!content) continue

    // Split out links first, then mentions inside the remaining text.
    let cursor = 0
    for (const match of content.matchAll(URL_REGEX)) {
      const before = content.slice(cursor, match.index)
      pushMentions(tokens, before, message.platform)
      pushSegment(tokens, match[0], message.platform, (word) => ({
        kind: 'link',
        text: word,
        url: match[0],
      }))
      cursor = match.index + match[0].length
    }
    pushMentions(tokens, content.slice(cursor), message.platform)
  }

  // Normalize whitespace at token boundaries: a text token following a
  // non-text token (emote/link/mention) donates its leading whitespace to
  // that token, so spacing survives wrapping without a line-start indent.
  const normalized: MessageToken[] = []
  for (const token of tokens) {
    const prev = normalized[normalized.length - 1]
    if (token.kind === 'text' && prev && prev.kind !== 'text') {
      const match = token.text.match(/^\s+/)
      if (match) {
        if (prev.kind === 'link' || prev.kind === 'mention') {
          prev.text += match[0]
        }
        // Emotes carry marginRight instead.
        const rest = token.text.slice(match[0].length)
        if (rest) normalized.push({ kind: 'text', text: rest })
        continue
      }
    }
    normalized.push(token)
  }

  // Drop whitespace-only tokens that directly follow an emote (the emote
  // carries its own trailing margin, so the extra gap would double up).
  return normalized.filter((token, index) => {
    if (token.kind !== 'text') return true
    if (token.text.trim() !== '') return true
    const prev = normalized[index - 1]
    return prev?.kind !== 'emote'
  })
}

function pushMentions(tokens: MessageToken[], segment: string, platform: string): void {
  if (!segment) return
  let cursor = 0
  for (const match of segment.matchAll(MENTION_REGEX)) {
    const before = segment.slice(cursor, match.index)
    pushSegment(tokens, before, platform, (word) => ({ kind: 'text', text: word }))
    const username = match[1] ?? ''
    pushSegment(tokens, match[0], platform, (word) => ({
      kind: 'mention',
      text: word,
      color: mentionColor(platform, username) ?? null,
    }))
    cursor = match.index + match[0].length
  }
  pushSegment(tokens, segment.slice(cursor), platform, (word) => ({ kind: 'text', text: word }))
}
