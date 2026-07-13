const DEFAULT_FONT_SIZE = 14
const MINIMUM_BADGE_SIZE = 12
const BADGE_TO_FONT_RATIO = 1.15
const MINIMUM_PLATFORM_ICON_SIZE = 9
const PLATFORM_ICON_TO_FONT_RATIO = 0.85

export function chatMessageStyle(fontSize = DEFAULT_FONT_SIZE): Record<string, string> {
  const badgeSize = Math.max(MINIMUM_BADGE_SIZE, Math.round(fontSize * BADGE_TO_FONT_RATIO))
  const platformIconSize = Math.max(
    MINIMUM_PLATFORM_ICON_SIZE,
    Math.round(fontSize * PLATFORM_ICON_TO_FONT_RATIO),
  )

  return {
    '--font-size': `${fontSize}px`,
    '--badge-size': `${badgeSize}px`,
    '--platform-icon-size': `${platformIconSize}px`,
  }
}
