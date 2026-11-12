import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'

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
