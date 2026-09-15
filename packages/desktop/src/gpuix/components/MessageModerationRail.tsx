/**
 * Moderation drag rail — port of MessageModerationRail.vue.
 * Grab the 16px strip on the message's left edge and drag right:
 * ≥32px delete, then timeout presets every 42px, then ban.
 * GPUIX pointer capture (onMouseDown + onMouseMove) keeps the gesture alive
 * after the pointer leaves the rail.
 */

import { useRef, useState } from 'react'

import {
  moderationActionColor,
  moderationActionForDrag,
  type ModerationDragAction,
} from '../../views/main/utils/moderation-drag'
import { withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Text } from './ui/Text'

const MAX_DISTANCE = 420

export function MessageModerationRail({
  platform,
  disabled,
  onModerate,
}: {
  platform: 'twitch' | 'kick'
  disabled?: boolean
  onModerate: (action: ModerationDragAction) => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  const [distance, setDistance] = useState(0)
  const dragStartX = useRef<number | null>(null)

  const preview = moderationActionForDrag(platform, distance)
  const color = moderationActionColor(preview?.action ?? null)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(event) => {
        if (disabled || event.button !== 0) return
        dragStartX.current = event.x ?? 0
        setDistance(0)
      }}
      onMouseMove={(event) => {
        if (dragStartX.current === null) return
        setDistance(Math.min(MAX_DISTANCE, Math.max(0, (event.x ?? 0) - dragStartX.current)))
      }}
      onMouseUp={() => {
        if (dragStartX.current === null) return
        dragStartX.current = null
        setDistance(0)
        if (preview) onModerate(preview)
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 14,
        cursor: disabled ? 'default' : 'ew-resize',
        userSelect: 'none',
      }}
    >
      {/* Always-visible grip line, centered vertically */}
      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: 2,
          backgroundColor:
            dragStartX.current !== null || hovered ? theme.text2 : 'rgba(139, 139, 153, 0.35)',
        }}
      />
      {distance > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: Math.min(distance, MAX_DISTANCE),
            backgroundColor: withAlpha(color, 0.18),
            borderLeftWidth: 3,
            borderColor: color,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {preview ? (
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              backgroundColor: color,
              borderRadius: 4,
              paddingTop: 3,
              paddingBottom: 3,
              paddingLeft: 6,
              paddingRight: 6,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' }}>
              {preview.label}
            </Text>
          </div>
        </div>
      ) : null}
    </div>
  )
}
