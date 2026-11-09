import { Tooltip, TooltipContent, TooltipTrigger, type StyleDesc } from '@gpuix/react'

import type { StreamerModeStatus } from '../../../services/streamer-mode'
import { t, useT } from '../../i18n'
import { useStoreSelector } from '../../state/create-store'
import { streamerModeStore } from '../../state/streamer-mode'
import { semantic } from '../../theme'
import { useTheme } from '../../theme-context'
import { Text } from './Text'

export function describeStreamerMode(
  { effectiveEnabled, mode }: StreamerModeStatus,
  translate: typeof t = t,
): string {
  return `${translate(
    effectiveEnabled ? 'misc.streamerMode.enabled' : 'misc.streamerMode.disabled',
  )}${mode === 'auto' ? translate('misc.streamerMode.automaticSuffix') : ''}`
}

export function StreamerModeDot({ style }: { style?: StyleDesc }) {
  return (
    <div
      testId="streamer-mode-dot"
      style={{
        width: 6,
        height: 6,
        flexShrink: 0,
        borderRadius: 3,
        backgroundColor: semantic.error,
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}

export function StreamerModeIndicator() {
  const theme = useTheme()
  const { t: translate } = useT()
  const status = useStoreSelector(streamerModeStore, (state) => state)
  const label = status.effectiveEnabled ? describeStreamerMode(status, translate) : null
  if (!label) return null

  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div
          testId="streamer-mode-indicator"
          role="img"
          aria-label={label}
          tabIndex={0}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 20,
            flexShrink: 0,
            borderRadius: 4,
            focusVisible: { outlineWidth: 1, outlineColor: theme.link },
          }}
        >
          <StreamerModeDot />
        </div>
      </TooltipTrigger>
      <TooltipContent
        testId="streamer-mode-tooltip"
        side="bottom"
        align="start"
        sideOffset={6}
        style={{
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 6,
          padding: 6,
        }}
      >
        <Text style={{ fontSize: 11, color: theme.text }}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  )
}
