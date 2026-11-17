import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import type { ProfileEntry } from './types'

interface ProfileInfoRowProps {
  entry: ProfileEntry
  first: boolean
}

export const ProfileInfoRow = memo(function ProfileInfoRow({ entry, first }: ProfileInfoRowProps) {
  const theme = useTheme()
  const isStringValue = typeof entry.value === 'string'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingTop: 9,
        paddingBottom: 9,
        paddingLeft: 12,
        paddingRight: 12,
        borderTopWidth: first ? 0 : 1,
        borderColor: theme.hairline,
      }}
    >
      <Icon name={entry.icon} size={14} color={theme.accent.primary} />
      <Text
        style={{ width: 104, flexShrink: 0, fontSize: 11, fontWeight: 600, color: theme.text2 }}
      >
        {entry.label}
      </Text>
      {entry.color ? (
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            flexShrink: 0,
            backgroundColor: entry.color,
            borderWidth: 1,
            borderColor: withAlpha('#ffffff', 0.25),
          }}
        />
      ) : null}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {isStringValue ? (
          <Text
            style={{
              fontSize: 12,
              lineHeight: 18,
              color: theme.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entry.value}
          </Text>
        ) : (
          entry.value
        )}
      </div>
    </div>
  )
})
