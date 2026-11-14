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

import { domainToASCII } from 'node:url'

import type { Emote, NormalizedChatMessage } from '@twirchat/shared/types'
import tlds from 'tlds'

import { chunkGraphemes, sanitizeDisplayText } from '../views/shared/utils/display-text'
import { buildMessageParts } from '../views/shared/utils/messageParts'

export type EmoteModifier =
  | 'wide'
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'zero-space'
  | 'cursed'
  | 'rotate-left'
  | 'rotate-right'
  | 'party'
  | 'shake'

export type MessageToken =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; username: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'emote'; emote: Emote; alias?: string; overlays?: Emote[]; modifiers?: EmoteModifier[] }

export const PREFIX_MODIFIERS: Readonly<Record<string, EmoteModifier>> = {
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
export const SUFFIX_MODIFIERS: Readonly<Record<string, EmoteModifier>> = {
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
  let prefixes: Array<{ token: MessageToken; modifier: EmoteModifier }> = []
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
const DOMAIN_CANDIDATE = /\.[\p{L}\p{N}]/u
const DOMAIN_CHAR = String.raw`\p{L}\p{M}\p{N}`
const DOMAIN_LABEL = `[${DOMAIN_CHAR}](?:[${DOMAIN_CHAR}-]{0,61}[${DOMAIN_CHAR}])?`
const DOMAIN_PATH = String.raw`(?:[/?#][^\s<>"'\\]*[^\s<>"'\\.,;:!?)\]]|/)?`
const URL_OR_DOMAIN_REGEX = new RegExp(
  String.raw`${URL_REGEX.source}|(?<![${DOMAIN_CHAR}_.@:/\\%+=?#&-])` +
    String.raw`((?:${DOMAIN_LABEL}\.)+${DOMAIN_LABEL}(?::\d+)?${DOMAIN_PATH})` +
    String.raw`(?![${DOMAIN_CHAR}_@\\%-]|\.[${DOMAIN_CHAR}_.-])`,
  'gu',
)
const PUBLIC_TLDS = new Set(tlds.map(domainToASCII))
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g
const ENCODED_UNICODE_RUN = /(?:%[89a-f][\da-f])+/gi
const INVISIBLE_UNICODE = /[\p{C}\p{Z}]/u

function bareDomainUrl(domain: string): string | undefined {
  const url = `https://${domain}`
  const parsed = URL.parse(url)
  if (!parsed) return undefined
  const tld = parsed.hostname.slice(parsed.hostname.lastIndexOf('.') + 1)
  return PUBLIC_TLDS.has(tld) ? url : undefined
}

function linkDisplayText(url: string): string {
  if (!url.includes('%')) return url
  return sanitizeDisplayText(
    url.replace(ENCODED_UNICODE_RUN, (encoded) => {
      try {
        const decoded = decodeURIComponent(encoded)
        return INVISIBLE_UNICODE.test(decoded) ? encoded : decoded
      } catch (error) {
        if (error instanceof URIError) return encoded
        throw error
      }
    }),
  )
}

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
  decorate: (word: string) => MessageToken,
): void {
  for (const word of wordsOf(segment)) {
    tokens.push(decorate(word))
  }
}

/**
 * Words are separate flex items only so they can wrap around emotes. A plain message
 * can be one text element, which costs a fraction of the native work per repaint.
 */
export function mergePlainText(tokens: MessageToken[]): MessageToken[] {
  if (tokens.length < 2 || tokens.some((token) => token.kind !== 'text')) return tokens
  return [
    {
      kind: 'text',
      text: tokens.map((token) => (token.kind === 'text' ? token.text : '')).join(''),
    },
  ]
}

export function buildMessageTokens(
  message: NormalizedChatMessage,
  options: { zeroWidth?: boolean; modifiers?: boolean } = {},
): MessageToken[] {
  const parts = buildMessageParts(message, true)
  const tokens: MessageToken[] = []

  for (const part of parts) {
    if (part.type === 'emote' && part.emote) {
      const token: MessageToken = { kind: 'emote', emote: part.emote }
      if (part.alias) token.alias = part.alias
      tokens.push(token)
      continue
    }
    // Sanitize per part, after emote ranges are resolved against raw text.
    const content = part.content ? sanitizeDisplayText(part.content) : ''
    if (!content) continue

    // Split out links first, then mentions inside the remaining text.
    let cursor = 0
    const urls = DOMAIN_CANDIDATE.test(content) ? URL_OR_DOMAIN_REGEX : URL_REGEX
    for (const match of content.matchAll(urls)) {
      const [label, bareDomain] = match
      const url = bareDomain === undefined ? label : bareDomainUrl(bareDomain)
      if (!url) continue
      const before = content.slice(cursor, match.index)
      pushMentions(tokens, before)
      pushSegment(tokens, linkDisplayText(label), (word) => ({
        kind: 'link',
        text: word,
        url,
      }))
      cursor = match.index + label.length
    }
    pushMentions(tokens, content.slice(cursor))
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

function pushMentions(tokens: MessageToken[], segment: string): void {
  if (!segment) return
  let cursor = 0
  for (const match of segment.matchAll(MENTION_REGEX)) {
    const before = segment.slice(cursor, match.index)
    pushSegment(tokens, before, (word) => ({ kind: 'text', text: word }))
    const username = match[1] ?? ''
    pushSegment(tokens, match[0], (word) => ({
      kind: 'mention',
      text: word,
      username,
    }))
    cursor = match.index + match[0].length
  }
  pushSegment(tokens, segment.slice(cursor), (word) => ({ kind: 'text', text: word }))
}
