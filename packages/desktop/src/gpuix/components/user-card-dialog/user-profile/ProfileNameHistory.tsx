import { t, useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'
import { memo, useState } from 'react'

import { getSkeletonColors } from '../metadata-section/skeleton-colors'
import { SectionHeader, UserCardPanel } from '../UserCardUI'
import { userCardWellColor } from '../utils'
import { NAME_HISTORY_SKELETON_ROWS } from './constants'
import type { ProfileNameHistoryProps } from './types'

function currentDayKey(): string {
  return new Date().toDateString()
}

function formatDate(inputDate: string | undefined, locale: string, today: string): string {
  if (inputDate === undefined || inputDate === null) return '?'
  const date = new Date(inputDate)
  const isEnLocale = locale === 'en'
  if (date.toDateString() === today)
    return isEnLocale ? t('userCard.history.names.now') : t('userCard.history.names.now')

  return new Date(inputDate).toLocaleDateString(isEnLocale ? 'en-GB' : locale, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const ProfileNameHistory = memo(function ProfileNameHistory({
  profile,
  loading,
}: ProfileNameHistoryProps) {
  const theme = useTheme()
  const { t, language } = useT()
  const [today] = useState(currentDayKey)

  if (profile?.nameHistory?.length) {
    return (
      <UserCardPanel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionHeader icon="clock" title={t('userCard.profile.nameHistory')} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              paddingTop: 4,
              paddingBottom: 4,
              paddingLeft: 10,
              paddingRight: 10,

              borderWidth: 1,
              borderColor: theme.hairline,
              borderRadius: 10,
              backgroundColor: userCardWellColor(theme),
            }}
          >
            {profile.nameHistory.map((entry) => {
              const firstSeen = formatDate(entry.firstSeen, language, today)
              const lastSeen = formatDate(entry.lastSeen, language, today)

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
                    {entry.login !== '' ? entry.login : language === 'en' ? 'Unknown' : 'Без имени'}
                    :
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', fontSize: 16, color: theme.text2 }}>
                      {firstSeen}
                    </div>
                    <div style={{ fontSize: 16, color: theme.text2 }}>-</div>
                    <div style={{ display: 'flex', fontSize: 16, color: theme.text2 }}>
                      {lastSeen}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </UserCardPanel>
    )
  }

  if (!loading) return null

  const skel = getSkeletonColors(theme)

  return (
    <UserCardPanel>
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
    </UserCardPanel>
  )
})
