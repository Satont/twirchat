import officialIcons from './badge-icons.json'

// Source URLs and checksums for these official Kick assets are pinned beside the data.
export const KICK_BADGE_SVGS: Readonly<Record<string, string>> = officialIcons.roles
const giftBadges: Readonly<Record<string, string>> = officialIcons.gifts
const giftTiers = Object.keys(giftBadges)
  .map(Number)
  .sort((left, right) => left - right)

export function getKickBadgeSvg(badgeType: string, giftCount?: number): string | undefined {
  const [rawType = '', encodedCount] = badgeType.toLowerCase().split(':')
  const type = rawType === 'subgifter' ? 'sub_gifter' : rawType
  const count = giftCount ?? (encodedCount ? Number(encodedCount) : undefined)
  if (type === 'sub_gifter' && count !== undefined && count > 0) {
    let tier = 1
    for (const candidate of giftTiers) {
      if (candidate > count) break
      tier = candidate
    }
    return giftBadges[tier]
  }
  return KICK_BADGE_SVGS[type]
}
