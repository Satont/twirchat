import { Tooltip, TooltipContent, TooltipTrigger, useWindowSize } from '@gpuix/react'
import type { Badge, Platform } from '@twirchat/shared/types'
import { useState, type ReactNode } from 'react'

import { sanitizeDisplayText } from '../../../views/shared/utils/display-text'
import { useTheme } from '../../theme-context'
import { Text } from './Text'

function badgeSource(badge: Badge, platform?: Platform): string {
  switch (badge.type) {
    case 'seventv':
      return '7TV'
    case 'bttv':
      return 'BetterTTV'
    case 'ffz':
      return 'FrankerFaceZ'
    default:
      return platform === 'twitch'
        ? 'Twitch'
        : platform === 'youtube'
          ? 'YouTube'
          : platform === 'kick'
            ? 'Kick'
            : ''
  }
}

function BadgeDetails({ badge, platform }: { badge: Badge; platform?: Platform }) {
  const theme = useTheme()
  const windowSize = useWindowSize()
  const title = sanitizeDisplayText(badge.text).trim() || badge.type
  const description = sanitizeDisplayText(badge.description ?? '').trim()
  const source = badgeSource(badge, platform)
  return (
    <TooltipContent
      testId={`badge-tooltip-${badge.id}`}
      role="tooltip"
      side="top"
      sideOffset={6}
      style={{
        width: Math.min(280, Math.max(0, windowSize.width - 24)),
        maxHeight: Math.max(0, Math.min(240, windowSize.height - 24)),
        overflowX: 'hidden',
        overflowY: 'scroll',
        backgroundColor: theme.popover,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        boxShadow: {
          offsetX: 0,
          offsetY: 4,
          blurRadius: 16,
          spreadRadius: 0,
          color: '#00000060',
        },
      }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: 600, color: theme.text }}>
        {title}
      </Text>
      {source ? (
        <Text style={{ fontSize: 12, lineHeight: 16, color: theme.text2 }}>{source}</Text>
      ) : null}
      {description && description !== title ? (
        <Text style={{ fontSize: 12, lineHeight: 17, color: theme.text }}>{description}</Text>
      ) : null}
    </TooltipContent>
  )
}

export function BadgeTooltip({
  badge,
  platform,
  children,
}: {
  badge: Badge
  platform?: Platform
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={300} style={{ flexShrink: 0 }}>
      <TooltipTrigger asChild tabIndex={-1}>
        <div
          testId={`badge-trigger-${badge.id}`}
          aria-label={badge.text || badge.type}
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0, userSelect: 'none' }}
        >
          {children}
        </div>
      </TooltipTrigger>
      {open ? <BadgeDetails badge={badge} platform={platform} /> : null}
    </Tooltip>
  )
}
