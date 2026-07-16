export const CHAT_TEXTAREA_MIN_HEIGHT = 36
export const CHAT_TEXTAREA_MAX_HEIGHT = 120
export const CHAT_TEXTAREA_MAX_LINES = 5

export interface TextareaHeightBounds {
  minHeight: number
  maxHeight: number
}

type TextareaComputedStyle = Pick<
  CSSStyleDeclaration,
  'borderBottomWidth' | 'borderTopWidth' | 'lineHeight' | 'paddingBottom' | 'paddingTop'
>

const DEFAULT_BOUNDS: TextareaHeightBounds = {
  minHeight: CHAT_TEXTAREA_MIN_HEIGHT,
  maxHeight: CHAT_TEXTAREA_MAX_HEIGHT,
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function textareaHeightBounds(style: TextareaComputedStyle): TextareaHeightBounds {
  const lineHeight = cssPixels(style.lineHeight)
  if (lineHeight <= 0) return DEFAULT_BOUNDS

  const verticalExtras =
    cssPixels(style.paddingTop) +
    cssPixels(style.paddingBottom) +
    cssPixels(style.borderTopWidth) +
    cssPixels(style.borderBottomWidth)
  const minHeight = lineHeight + verticalExtras
  const maxHeight = Math.min(
    CHAT_TEXTAREA_MAX_HEIGHT,
    lineHeight * CHAT_TEXTAREA_MAX_LINES + verticalExtras,
  )

  return { minHeight, maxHeight: Math.max(minHeight, maxHeight) }
}

export function textareaHeight(
  scrollHeight: number,
  bounds: TextareaHeightBounds = DEFAULT_BOUNDS,
): number {
  return Math.min(bounds.maxHeight, Math.max(bounds.minHeight, scrollHeight))
}
