import { RemoteImage } from '@gpuix/components/ui/RemoteImage'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import type { Badge } from '@twirchat/shared/types'

export interface UserBadgesProps {
  badges: readonly Badge[]
  size?: number
}

export function UserBadges({ badges, size = 20 }: UserBadgesProps) {
  const theme = useTheme()
  const headerText = theme.isLight ? theme.text : '#ffffff'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
      }}
    >
      {badges.map((badge, index) => (
        <div
          key={`${badge.type}:${badge.id}:${index}`}
          style={{
            width: size,
            height: size,
            borderRadius: 5,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {badge.imageUrl ? (
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
                fontSize: 10,
                fontWeight: 700,
                backgroundColor: withAlpha('#000000', 0.2),
                color: headerText,
              }}
            >
              {badge.text[0]?.toUpperCase() ?? '?'}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
