import { useMemo, memo } from 'react'

import { Badge } from '../Badge'
import { mergeBadges } from '../utils'
import type { BadgeInventoryProps } from './types'

export const BadgeInventory = memo(function BadgeInventory({
  badges,
  inventoryBadges,
}: BadgeInventoryProps) {
  const cosmeticBadges = useMemo(
    () => mergeBadges(badges, inventoryBadges),
    [badges, inventoryBadges],
  )
  return (
    <>
      {cosmeticBadges.map((badge) => (
        <Badge key={`${badge.type}:${badge.id}`} badge={badge} size={24} showTooltip />
      ))}
    </>
  )
})
