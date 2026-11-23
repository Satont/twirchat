import { useTheme } from '@gpuix/theme-context'

import type { UserCardSectionHeaderProps } from './types'

export function UserCardSectionHeader({ text }: UserCardSectionHeaderProps) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 4,
        fontSize: 18,
        fontWeight: 700,
        color: theme.text2,
      }}
    >
      {text}
    </div>
  )
}
