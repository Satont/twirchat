import { icons, platformIconNames } from '../../icons'
import { platformColor } from '../../theme'
import type { IconName } from '../../icons'

export type { IconName }

export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color: string }) {
  return <svg source={icons[name]} style={{ width: size, height: size, flexShrink: 0, color }} />
}

/** Platform logo tinted with the platform brand color. */
export function PlatformIcon({
  platform,
  size = 12,
  color,
}: {
  platform: string
  size?: number
  color?: string
}) {
  const name = platformIconNames[platform]
  if (!name) return null
  return <Icon name={name} size={size} color={color ?? platformColor(platform)} />
}
