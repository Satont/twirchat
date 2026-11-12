import type { LinearGradientBackground } from '@gpuix/react'
import { withAlpha, type Theme } from '@gpuix/theme'
import type { Badge, NormalizedChatMessage, Platform } from '@twirchat/shared/types'
import { initialsOf } from '@views/shared/utils/display-text'

import { hexMix } from '../user-card/format'

export function initials(name: string): string {
  return initialsOf(name, 2)
}

/** Badge set IDs that are global (not tied to a specific channel). */
export const GLOBAL_BADGE_SETS = new Set<string>([
  'staff',
  'admin',
  'global_mod',
  'turbo',
  'premium',
  'partner',
])

/** Extracts badge set ID from badge id (format: "twitch:setId/version" or "type:id"). */
export function getBadgeSetId(badge: Badge): string | null {
  // badge.id format: "twitch:setId/version" or "twitch:id" or "seventv:..." etc.
  const parts = badge.id.split(':')
  if (parts.length >= 2 && parts[0] === 'twitch') {
    const twitchPart = parts[1]
    if (!twitchPart) return null
    const slashIdx = twitchPart.indexOf('/')
    if (slashIdx > 0) return twitchPart.slice(0, slashIdx)
    return twitchPart
  }
  return null
}

/** Checks if a badge is global (should show in any channel). */
export function isGlobalBadge(badge: Badge): boolean {
  const setId = getBadgeSetId(badge)
  return setId !== null && GLOBAL_BADGE_SETS.has(setId)
}

/** Merges platform and cosmetic badges without dropping distinct badges that share an id. */
export function mergeBadges(...collections: Array<readonly Badge[] | undefined>): Badge[] {
  const merged: Badge[] = []
  const seen = new Set<string>()
  for (const collection of collections) {
    for (const badge of collection ?? []) {
      const key = `${badge.type}:${badge.id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(badge)
    }
  }
  return merged
}

/**
 * Collects every distinct badge a user displayed in the given messages.
 * Pass messages newest-first so the most recently used badge appearance wins.
 */
export function collectUserBadges(
  messages: Iterable<NormalizedChatMessage>,
  platform: Platform,
  userId: string,
): Badge[] {
  const badges: Badge[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.platform !== platform || message.author.id !== userId) continue
    for (const badge of message.author.badges) {
      const key = `${badge.type}:${badge.id}`
      if (seen.has(key)) continue
      seen.add(key)
      badges.push(badge)
    }
  }
  return badges
}

export function formatDisplayUsername(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function userCardPanelColor(theme: Theme): string {
  return theme.isLight ? theme.surface : hexMix(theme.accent.deep, theme.surface, 0.05)
}

export function userCardWellColor(theme: Theme): string {
  return theme.isLight ? theme.fill : hexMix(theme.accent.deep, theme.bg, 0.05)
}

export function accentGradient(theme: Theme): LinearGradientBackground {
  return {
    type: 'linear-gradient',
    angle: 135,
    stops: [
      { color: theme.accent.primary, position: 0 },
      { color: theme.accent.deep, position: 1 },
    ],
  }
}

export function accentGlow(theme: Theme) {
  return {
    offsetX: 0,
    offsetY: 0,
    blurRadius: 14,
    spreadRadius: 0,
    color: withAlpha(theme.accent.primary, 0.32),
  }
}
