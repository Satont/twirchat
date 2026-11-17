import { Text } from '@gpuix/components/ui/Text'
import { useTheme } from '@gpuix/theme-context'
import { initialsOf } from '@views/shared/utils/display-text'

import { accentGradient } from '../utils'

interface ProfileAvatarFallbackProps {
  name: string
  size: number
}

export function ProfileAvatarFallback({ name, size }: ProfileAvatarFallbackProps) {
  const theme = useTheme()
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: accentGradient(theme),
      }}
    >
      <Text
        style={{
          fontSize: (size * 0.28 + 0.5) | 0,
          fontWeight: 800,
          color: theme.accent.onDeep,
        }}
      >
        {initialsOf(name, 2)}
      </Text>
    </div>
  )
}
