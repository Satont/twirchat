import type { TwitchNoticeKind } from '@twirchat/shared/types'
import type { ReactNode } from 'react'

import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import type { IconName } from '../icons'
import { withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

const palette = {
  subscription: { dark: '#c4a9ff', light: '#6635a8' },
  gift: { dark: '#f2a9dc', light: '#913a77' },
  raid: { dark: '#77ddca', light: '#236a62' },
  bits: { dark: '#f6ca78', light: '#855018' },
  moderation: { dark: '#f5aaa1', light: '#903e37' },
}

const notices = {
  sub: { label: 'Subscription', icon: 'star', tone: 'subscription' },
  resub: { label: 'Resub', icon: 'star', tone: 'subscription' },
  gift_sub: { label: 'Gift sub', icon: 'gift', tone: 'gift' },
  community_gift: { label: 'Community gift', icon: 'gift', tone: 'gift' },
  raid: { label: 'Raid', icon: 'users', tone: 'raid' },
  reward_gift: { label: 'Cheer gift', icon: 'gift', tone: 'bits' },
  cheer: { label: 'Cheer', icon: 'sparkle', tone: 'bits' },
  moderation: { label: 'Moderation', icon: 'lock', tone: 'moderation' },
} satisfies Record<
  TwitchNoticeKind | 'cheer',
  { label: string; icon: IconName; tone: keyof typeof palette }
>

export function TwitchChatNotice({
  id,
  kind,
  fontSize,
  summary,
  detail,
  time,
  children,
}: {
  id: string
  kind: TwitchNoticeKind | 'cheer'
  fontSize: number
  summary: string
  detail?: string
  time?: string
  children?: ReactNode
}) {
  const theme = useTheme()
  const { label, icon, tone } = notices[kind]
  const color = palette[tone][theme.isLight ? 'light' : 'dark']
  const iconSize = Math.max(12, Math.round(fontSize * 0.9))
  const labelSize = Math.max(10, Math.round(fontSize * 0.86))
  return (
    <div
      testId={`twitch-notice-${id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        borderLeftWidth: 1,
        borderColor: withAlpha(color, 0.85),
        backgroundColor: withAlpha(color, theme.isLight ? 0.09 : 0.12),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          paddingLeft: 11,
          paddingRight: 12,
          paddingTop: 5,
          paddingBottom: children ? 0 : 5,
        }}
      >
        <div style={{ display: 'flex', flexShrink: 0, paddingTop: 2 }}>
          <Icon name={icon} size={iconSize} color={color} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 8,
              minWidth: 0,
            }}
          >
            <Text style={{ color, fontWeight: 700, fontSize: labelSize }}>{label}</Text>
            <Text style={{ color: theme.text, fontSize, minWidth: 0, flexShrink: 1 }}>
              {sanitizeDisplayText(summary)}
            </Text>
          </div>
          {detail ? (
            <Text style={{ color: theme.text, fontSize, paddingTop: 2, minWidth: 0 }}>
              {sanitizeDisplayText(detail)}
            </Text>
          ) : null}
        </div>
        {time ? (
          <Text style={{ color: theme.text2, fontSize: labelSize, flexShrink: 0, paddingTop: 1 }}>
            {time}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  )
}
