import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useTheme } from '@gpuix/theme-context'

import type { MetadataItem } from '../types'
import { userCardWellColor } from '../utils'
import type { SkeletonColors } from './skeleton-colors'
import type { MetadataTileProps } from './types'

export function MetadataTile(props: MetadataTileProps) {
  const theme = useTheme()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexGrow: 1,
        flexBasis: 150,
        minWidth: 0,
        padding: 14,
        borderWidth: 1,
        borderColor: theme.hairline,
        borderRadius: 12,
        backgroundColor: userCardWellColor(theme),
        minHeight: 72,
      }}
    >
      {props.variant === 'skeleton' ? (
        <SkeletonContent colors={props.colors} />
      ) : (
        <DataContent label={props.label} icon={props.icon} value={props.value} />
      )}
    </div>
  )
}

function SkeletonContent({ colors }: { colors: SkeletonColors }) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.iconBg,
          }}
        >
          <div
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              backgroundColor: colors.iconInner,
            }}
          />
        </div>

        <div
          style={{
            width: 60,
            height: 10,
            borderRadius: 2,
            backgroundColor: colors.labelBar,
            marginTop: 2,
          }}
        />
      </div>

      <div
        style={{
          width: '100%',
          height: 18,
          borderRadius: 2,
          backgroundColor: colors.valueBar,
        }}
      />
    </>
  )
}

function DataContent(props: MetadataItem) {
  const theme = useTheme()

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.accent.tint12,
          }}
        >
          <Icon name={props.icon} size={13} color={theme.accent.primary} />
        </div>

        <Text
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: theme.text2,
          }}
        >
          {props.label.toUpperCase()}
        </Text>
      </div>

      <Text style={{ fontSize: 12, lineHeight: 18, color: theme.text }}>{props.value ?? ''}</Text>
    </>
  )
}
