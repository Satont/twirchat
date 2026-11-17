import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { userCardWellColor } from '../utils'
import { NAME_HISTORY_SKELETON_ROWS } from './constants'
import type { ProfileNameHistoryProps } from './types'

export const ProfileNameHistory = memo(function ProfileNameHistory({
  profile,
  loading,
}: ProfileNameHistoryProps) {
  const theme = useTheme()
  const { t, language } = useT()

  const formatDate = (date: string | undefined, locale: string) => {
    if (date === undefined || date === null) return '?'
    return new Date(date).toLocaleDateString(locale)
  }

  if (profile?.nameHistory?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon name="clock" size={14} color={theme.accent.primary} />
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text2 }}>
            {t('userCard.profile.nameHistory')}
          </Text>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.hairline,
            borderRadius: 10,
            backgroundColor: userCardWellColor(theme),
          }}
        >
          {profile.nameHistory.map((entry) => {
            const firstSeen = formatDate(entry.firstSeen, language)
            const lastSeen = formatDate(entry.lastSeen, language)

            return (
              <div
                key={`${entry.login}:${entry.firstSeen ?? ''}:${entry.lastSeen ?? ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottomWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    fontSize: 18,
                    fontWeight: 600,
                    color: theme.text,
                    paddingBottom: 4,
                  }}
                >
                  {entry.login}:
                </div>

                <div style={{ display: 'flex', flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', fontSize: 18, color: theme.text2 }}>
                    {firstSeen}
                  </div>
                  <div style={{ fontSize: 18, color: theme.text2 }}>-</div>
                  <div style={{ display: 'flex', fontSize: 18, color: theme.text2 }}>
                    {lastSeen}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!loading) return null

  const skel = getSkeletonColors(theme)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            backgroundColor: skel.iconBg,
          }}
        />
        <div
          style={{
            width: 120,
            height: 16,
            borderRadius: 3,
            backgroundColor: skel.labelBar,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: 10,
          borderWidth: 1,
          borderColor: theme.hairline,
          borderRadius: 10,
          backgroundColor: userCardWellColor(theme),
        }}
      >
        {NAME_HISTORY_SKELETON_ROWS.map((row) => (
          <div
            key={row}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div
              style={{
                width: 100,
                height: 20,
                borderRadius: 3,
                backgroundColor: skel.labelBar,
              }}
            />
            <div
              style={{
                width: 140,
                height: 20,
                borderRadius: 3,
                backgroundColor: skel.valueBar,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
})
