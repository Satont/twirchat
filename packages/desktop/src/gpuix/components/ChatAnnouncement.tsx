import type { ReactNode } from 'react'

import { useT } from '../i18n'
import { readableOn, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

function announcementColor(color: string): string {
  switch (color) {
    case 'blue':
      return '#1e69ff'
    case 'green':
      return '#00a86b'
    case 'orange':
      return '#ffb31a'
    case 'purple':
    case 'primary':
    default:
      // The channel's profile accent is not available for PRIMARY announcements.
      return '#9146ff'
  }
}

export function ChatAnnouncement({
  id,
  color,
  fontSize,
  children,
}: {
  id: string
  color: string
  fontSize: number
  children: ReactNode
}) {
  const theme = useTheme()
  const { t } = useT()
  const accent = announcementColor(color)
  const foreground = readableOn(accent, theme.bg)
  return (
    <div
      testId={`chat-announcement-${id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flexShrink: 0,
        backgroundColor: withAlpha(accent, theme.isLight ? 0.12 : 0.2),
        borderWidth: 1,
        borderColor: withAlpha(accent, 0.65),
      }}
    >
      <div
        testId={`chat-announcement-header-${id}`}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 4,
        }}
      >
        <Icon name="twitch" size={Math.max(10, Math.round(fontSize * 0.85))} color={foreground} />
        <Text style={{ fontSize, fontWeight: 700, color: theme.text }}>
          {t('chatMessages.announcement')}
        </Text>
      </div>
      {children}
    </div>
  )
}
