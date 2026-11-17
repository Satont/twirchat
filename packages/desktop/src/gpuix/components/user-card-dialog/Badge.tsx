import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { Badge as BadgeData } from '@twirchat/shared/types'
import { memo } from 'react'

interface BadgeProps {
  badge: BadgeData
  size?: number
  showTooltip?: boolean
}

export const Badge = memo(function Badge({ badge, size = 20, showTooltip = false }: BadgeProps) {
  const theme = useTheme()
  const headerText = theme.isLight ? theme.text : '#ffffff'

  const content = badge.imageUrl ? (
    <RemoteImage
      url={badge.imageUrl}
      objectFit="cover"
      style={{ width: size - 2, height: size - 2 }}
    />
  ) : (
    <div
      style={{
        width: size - 2,
        height: size - 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(8, size * 0.5),
        fontWeight: 700,
        backgroundColor: withAlpha('#000000', 0.2),
        color: headerText,
      }}
    >
      {badge.text[0]?.toUpperCase() ?? '?'}
    </div>
  )

  const badgeElement = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {content}
    </div>
  )

  if (!showTooltip) return badgeElement

  return <BadgeTooltip badge={badge}>{badgeElement}</BadgeTooltip>
})

import { BadgeTooltip } from '@gpuix/components/ui/BadgeTooltip'
