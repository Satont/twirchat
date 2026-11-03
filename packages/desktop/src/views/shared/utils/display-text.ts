/**
 * Display-safe text helpers for untrusted chat content.
 *
 * Every string handed to GPUI crosses into Rust, where a lone UTF-16
 * surrogate breaks the render — so anything that cuts text must cut on
 * grapheme boundaries, never on code units. Chat is also hostile input:
 * "zalgo" stacks hundreds of combining marks on one letter so it paints
 * over neighbouring rows.
 */

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Combining marks kept per base character. Real scripts stack at most two or
 * three (Vietnamese tone + vowel marks, Arabic shadda + haraka, Devanagari);
 * zalgo stacks dozens.
 */
const MAX_COMBINING_MARKS = 3
const COMBINING_RUN = new RegExp(`(\\p{M}{${MAX_COMBINING_MARKS}})\\p{M}+`, 'gu')

/**
 * Makes untrusted text safe to render: repairs lone surrogates, trims zalgo
 * mark stacks and collapses whitespace runs (newlines, tabs) to one space —
 * chat rows are single-flow, a raw newline would split a token in two.
 */
export function sanitizeDisplayText(text: string): string {
  return text.toWellFormed().replace(COMBINING_RUN, '$1').replace(/\s+/g, ' ')
}

/** Splits text into user-perceived characters (emoji ZWJ sequences stay whole). */
export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment)
}

/** Cuts `text` into pieces of at most `max` graphemes. */
export function* chunkGraphemes(text: string, max: number): Generator<string> {
  let piece = ''
  let count = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    piece += segment
    count += 1
    if (count === max) {
      yield piece
      piece = ''
      count = 0
    }
  }
  if (piece) yield piece
}

/** Shortens to `max` graphemes with a trailing ellipsis. */
export function truncateGraphemes(text: string, max: number): string {
  const all = graphemes(text)
  return all.length > max ? `${all.slice(0, max).join('')}…` : text
}

/** First `count` graphemes, upper-cased — avatar initials. */
export function initialsOf(text: string, count = 1): string {
  return graphemes(sanitizeDisplayText(text).trim()).slice(0, count).join('').toUpperCase()
}

/**
 * Twitch IRC emote offsets count Unicode code points; JS strings index UTF-16
 * code units. Converts an inclusive code-point range to code units so an emoji
 * before an emote doesn't shift (and split) the slice.
 */
export function codePointRangeToUtf16(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let unit = 0
  let point = 0
  let startUnit = -1
  for (const char of text) {
    if (point === start) startUnit = unit
    if (point === end) return { start: startUnit, end: unit + char.length - 1 }
    unit += char.length
    point += 1
  }
  // Out of range — keep the original numbers, the caller's slice clamps.
  return { start, end }
}
