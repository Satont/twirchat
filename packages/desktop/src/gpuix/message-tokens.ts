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

import { chunkGraphemes, sanitizeDisplayText } from '../views/shared/utils/display-text'
import { buildMessageParts } from '../views/shared/utils/messageParts'
import { mentionColor } from './state/caches'

export type MessageToken =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; username: string; color: string | null }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'emote'; emote: Emote; overlays?: Emote[]; modifiers?: string[] }

const PREFIX_MODIFIERS: Record<string, string> = {
  'w!': 'wide',
  'h!': 'flip-horizontal',
  'v!': 'flip-vertical',
  'z!': 'zero-space',
  'c!': 'cursed',
  'l!': 'rotate-left',
  'r!': 'rotate-right',
  'p!': 'party',
  's!': 'shake',
}
const SUFFIX_MODIFIERS: Record<string, string> = {
  ffzW: 'wide',
  ffzX: 'flip-horizontal',
  ffzY: 'flip-vertical',
  ffzCursed: 'cursed',
}

export function layerEmoteTokens(
  tokens: MessageToken[],
  options: { zeroWidth?: boolean; modifiers?: boolean } = {},
): MessageToken[] {
  const result: MessageToken[] = []
  let prefixes: Array<{ token: MessageToken; modifier: string }> = []
  for (const token of tokens) {
    const text = token.kind === 'text' ? token.text.trim() : ''
    const prefix = options.modifiers !== false ? PREFIX_MODIFIERS[text] : undefined
    if (prefix) {
      prefixes.push({ token, modifier: prefix })
      continue
    }
    const previous = result.at(-1)
    const suffix = options.modifiers !== false ? SUFFIX_MODIFIERS[text] : undefined
    if (suffix && previous?.kind === 'emote') {
      previous.modifiers = [...(previous.modifiers ?? []), suffix]
      continue
    }
    if (token.kind === 'emote') {
      const emote: Extract<MessageToken, { kind: 'emote' }> = {
        ...token,
        ...(prefixes.length ? { modifiers: prefixes.map((item) => item.modifier) } : {}),
      }
      prefixes = []
      if (
        options.zeroWidth !== false &&
        emote.emote.zeroWidth &&
        previous?.kind === 'emote' &&
        (previous.overlays?.length ?? 0) < 8
      )
        previous.overlays = [...(previous.overlays ?? []), emote.emote]
      else result.push(emote)
    } else {
      result.push(...prefixes.map((item) => item.token), token)
      prefixes = []
    }
  }
  result.push(...prefixes.map((item) => item.token))
  return result
}

const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

/**
 * Break long unbreakable words (URLs, emoji walls) so the flex row can wrap
 * them. Counted in graphemes — cutting UTF-16 units would split surrogate
 * pairs, and a lone surrogate stalls GPUI's text layout.
 */
const MAX_WORD_GRAPHEMES = 28

function* wordsOf(segment: string): Generator<string> {
  // Split after each whitespace run: ["hello ", "world"].
  for (const match of segment.matchAll(/\S+\s*|\s+/g)) {
    yield* chunkGraphemes(match[0], MAX_WORD_GRAPHEMES)
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

export function buildMessageTokens(
  message: NormalizedChatMessage,
  options: { zeroWidth?: boolean; modifiers?: boolean } = {},
): MessageToken[] {
  const parts = buildMessageParts(message)
  const tokens: MessageToken[] = []

  for (const part of parts) {
    if (part.type === 'emote' && part.emote) {
      tokens.push({ kind: 'emote', emote: part.emote })
      continue
    }
    // Sanitize per part, after emote ranges are resolved against raw text.
    const content = part.content ? sanitizeDisplayText(part.content) : ''
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
  return layerEmoteTokens(
    normalized.filter((token, index) => {
      if (token.kind !== 'text') return true
      if (token.text.trim() !== '') return true
      const prev = normalized[index - 1]
      return prev?.kind !== 'emote'
    }),
    options,
  )
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
      username,
      color: mentionColor(platform, username) ?? null,
    }))
    cursor = match.index + match[0].length
  }
  pushSegment(tokens, segment.slice(cursor), platform, (word) => ({ kind: 'text', text: word }))
}
