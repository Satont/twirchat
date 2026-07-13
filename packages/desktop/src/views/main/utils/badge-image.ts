import { getKickBadgeSvg } from '../../../platforms/kick/badges'

const KICK_EMBEDDED_BADGE_PREFIX = 'embedded:kick:'

export function resolveBadgeImage(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) {
    return undefined
  }
  if (!imageUrl.startsWith(KICK_EMBEDDED_BADGE_PREFIX)) {
    return imageUrl
  }
  return getKickBadgeSvg(imageUrl.slice(KICK_EMBEDDED_BADGE_PREFIX.length))
}
