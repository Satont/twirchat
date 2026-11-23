const FONT_SIZE = 12
const AVG_CHAR_WIDTH = FONT_SIZE * 0.58
const MENU_CHROME = 8 + 16 + 2 + 20
const MIN_WIDTH = 120
const MAX_WIDTH = 320

/** GPUIX has no text-measurement API, so size the menu from its longest option. */
export function reasonMenuWidth(reasons: string[]): number {
  const longest = reasons.reduce((max, reason) => Math.max(max, reason.length), 0)
  const estimated = longest * AVG_CHAR_WIDTH + MENU_CHROME
  return Math.round(Math.min(Math.max(estimated, MIN_WIDTH), MAX_WIDTH))
}
