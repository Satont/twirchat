import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'

import { useStore } from '../../state/create-store'
import { streamerModeStore } from '../../state/streamer-mode'
import { accent, semantic } from '../../theme'
import { useTheme } from '../../theme-context'
import { Icon } from './Icon'
import { Text } from './Text'

export function AppStatusIcon({
  size = 24,
  compact = false,
}: {
  size?: number
  compact?: boolean
}) {
  const theme = useTheme()
  const status = useStore(streamerModeStore)
  const state = `Streamer mode ${status.effectiveEnabled ? 'enabled' : 'disabled'}${status.mode === 'auto' ? ' (automatic)' : ''}`
  const dotSize = compact ? 6 : 8
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div
          testId="app-status-icon"
          role="img"
          aria-label={`TwirChat. ${state}.`}
          tabIndex={0}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size + (compact ? 8 : 16),
            height: size + (compact ? 8 : 16),
            flexShrink: 0,
            borderRadius: 5,
            focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 1 },
          }}
        >
          <div style={{ position: 'relative', width: size, height: size, display: 'flex' }}>
            <Icon name="logo" size={size} color={accent.primary} />
            {status.effectiveEnabled ? (
              <div
                testId="streamer-mode-dot"
                style={{
                  position: 'absolute',
                  top: -1,
                  right: -2,
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor: semantic.error,
                  borderWidth: 1,
                  borderColor: theme.bg,
                }}
              />
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        testId="app-status-tooltip"
        side={compact ? 'bottom' : 'right'}
        sideOffset={6}
        style={{
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 6,
          padding: 8,
          maxWidth: 280,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>TwirChat</Text>
        <Text style={{ fontSize: 12, color: theme.text2 }}>{state}</Text>
      </TooltipContent>
    </Tooltip>
  )
}
