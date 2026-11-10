import { normalizeSettingsSearchText } from './settings-search'

export interface HighlightPart {
  readonly text: string
  readonly highlighted: boolean
}

const WORD_PATTERN = /[\p{L}\p{N}\p{M}]+/gu
const NORMALIZED_WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * Length in UTF-16 units of the source word covered by the longest query token
 * that prefix-matches its normalized form. Zero when nothing matches.
 *
 * A normalized character can come from several source characters (`ﬁ` → `fi`)
 * or from one character with marks, so keep an end offset per normalized
 * character and map the matched prefix back to the original text.
 */
function matchedSourceLength(word: string, tokens: readonly string[]): number {
  let normalized = ''
  const sourceEnds: number[] = []
  let offset = 0
  for (const character of word) {
    offset += character.length
    const folded = character.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    let produced = false
    for (const normalizedCharacter of folded) {
      if (!NORMALIZED_WORD_CHARACTER.test(normalizedCharacter)) continue
      normalized += normalizedCharacter
      sourceEnds.push(offset)
      produced = true
    }
    // A combining mark belongs to the previous base character.
    if (!produced && sourceEnds.length) sourceEnds[sourceEnds.length - 1] = offset
  }
  let matched = 0
  for (const token of tokens) {
    if (token.length > matched && normalized.startsWith(token)) matched = token.length
  }
  return matched ? (sourceEnds[matched - 1] ?? 0) : 0
}

/**
 * Splits visible settings text into plain and highlighted runs using the same
 * word-prefix matching as `searchSettings`, so the highlight always explains
 * why a section was found. Case, diacritics and punctuation are ignored.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = normalizeSettingsSearchText(query).split(/\s+/u).filter(Boolean)
  if (!tokens.length) return [{ text, highlighted: false }]

  const matches: Array<{ start: number; end: number }> = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    if (match.index === undefined) continue
    const word = match.at(0)
    if (!word) continue
    const length = matchedSourceLength(word, tokens)
    if (length) matches.push({ start: match.index, end: match.index + length })
  }
  if (!matches.length) return [{ text, highlighted: false }]

  const parts: HighlightPart[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ text: text.slice(cursor, match.start), highlighted: false })
    }
    parts.push({ text: text.slice(match.start, match.end), highlighted: true })
    cursor = match.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false })
  return parts
}
