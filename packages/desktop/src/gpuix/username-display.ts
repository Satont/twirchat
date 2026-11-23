import type { UsernameDisplayMode } from '@twirchat/shared/types'

import { sanitizeDisplayText, truncateGraphemes } from '../views/shared/utils/display-text'

export const MAX_NAME_GRAPHEMES = 32

export interface ChatAuthorNameInput {
  displayName: string
  username?: string
}

/** Sample localized Twitch author used in settings hints and live previews. */
export const PREVIEW_LOCALIZED_AUTHOR: ChatAuthorNameInput = {
  displayName: 'テスト',
  username: 'viewer42',
}

function cleanName(name: string): string {
  return sanitizeDisplayText(name).trim()
}

function clampName(name: string): string {
  return truncateGraphemes(name, MAX_NAME_GRAPHEMES)
}

/**
 * Formats a chat author name according to the user's username display mode.
 *
 * A non-empty custom alias always wins. Otherwise, when `displayName` differs
 * from `username` case-insensitively (a localized display name):
 * - `'localized-and-username'`: `Localized (username)`
 * - `'localized'`: `Localized`
 * - `'username'`: `username`
 *
 * Non-localized authors (where `displayName` only differs from `username` in
 * casing, or where the platform has no separate `username`) render `displayName`.
 */
export function formatChatAuthorName(
  author: ChatAuthorNameInput,
  mode: UsernameDisplayMode = 'localized-and-username',
  alias?: string,
): string {
  if (alias !== undefined) {
    const cleanAlias = cleanName(alias)
    if (cleanAlias) return clampName(cleanAlias)
  }

  const display = cleanName(author.displayName)
  const rawUsername = author.username
  if (!rawUsername) return clampName(display)

  if (display === rawUsername) return clampName(display)
  if (mode === 'localized' && display) return clampName(display)

  const username = cleanName(rawUsername)
  if (!display) return clampName(username)
  if (!username) return clampName(display)

  if (display.toLowerCase() === username.toLowerCase()) return clampName(display)

  switch (mode) {
    case 'localized-and-username':
      return `${clampName(display)} (${clampName(username)})`
    case 'localized':
      return clampName(display)
    case 'username':
      return clampName(username)
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}
