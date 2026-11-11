import { withAlpha, type Theme } from '@gpuix/theme'
import type { LinearGradientBackground } from '@gpuix/react'
import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'
import { initialsOf } from '@views/shared/utils/display-text'

import { hexMix } from '../user-card/format'

export function initials(name: string): string {
  return initialsOf(name, 2)
}

export function formatDisplayUsername(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function badgeKey(badge: Badge): string {
  return `${badge.type}/${badge.id}`
}

/**
 * Merges platform and cosmetic badges into one list.
 *
 * Deduplicates by (type, id) keeping the first occurrence. Badges that share an
 * id but have different types are both kept.
 */
export function mergeBadges(
  platform: Badge[] | undefined,
  cosmetics: Badge[] | undefined,
): Badge[] {
  const result: Badge[] = []
  const seen = new Set<string>()

  for (const badge of [...(platform ?? []), ...(cosmetics ?? [])]) {
    const key = badgeKey(badge)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(badge)
  }

  return result
}

/**
 * Collects every badge a user displayed across messages on a given platform,
 * preserving first-seen order.
 */
export function collectUserBadges(
  messages: NormalizedChatMessage[],
  platform: string,
  userId: string,
): Badge[] {
  const result: Badge[] = []
  const seen = new Set<string>()

  for (const msg of messages) {
    if (msg.platform !== platform || msg.author.id !== userId) continue
    for (const badge of msg.author.badges ?? []) {
      const key = badgeKey(badge)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(badge)
    }
  }

  return result
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