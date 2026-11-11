/**
 * Moderation drag rail — port of MessageModerationRail.vue.
 * Grab the 14px strip on the message's left edge and drag right:
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
import { createDragMotion, useDragCancellation } from '../hooks/use-drag-motion'
import { withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Text } from './ui/Text'

const MAX_DISTANCE = 420

interface RailDrag {
  startX: number
  motion: ReturnType<typeof createDragMotion>
}

function dragDistance(startX: number, x: number | undefined): number {
  return Math.min(MAX_DISTANCE, Math.max(0, (x ?? startX) - startX))
}

/** Mounted only during a drag, so idle rows hold no window-activity subscription. */
function RailDragCancellation({ onCancel }: { onCancel: () => void }) {
  useDragCancellation(true, 'moderation-rail', onCancel)
  return null
}

export function MessageModerationRail({
  platform,
  messageDeleted,
  disabled,
  rowHovered,
  onModerate,
}: {
  platform: 'twitch' | 'kick'
  messageDeleted?: boolean
  disabled?: boolean
  /** The grip only shows while its message row is hovered. */
  rowHovered: boolean
  onModerate: (action: ModerationDragAction) => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  // null while idle; the drag preview is painted from this coalesced value.
  const [distance, setDistance] = useState<number | null>(null)
  const drag = useRef<RailDrag | null>(null)

  const preview =
    distance === null ? null : moderationActionForDrag(platform, distance, { messageDeleted })
  const color = moderationActionColor(preview?.action ?? null)

  const cancel = () => {
    drag.current?.motion.cancel()
    drag.current = null
    setDistance(null)
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(event) => {
        if (disabled || event.button !== 0) return
        cancel()
        const startX = event.x ?? 0
        drag.current = {
          startX,
          motion: createDragMotion(({ x }) => setDistance(dragDistance(startX, x))),
        }
        setDistance(0)
      }}
      onMouseMove={(event) => {
        const current = drag.current
        if (!current) return
        // A release we never saw (outside the window) must not leave the gesture armed.
        if (event.pressedButton !== 0 || disabled) {
          cancel()
          return
        }
        current.motion.schedule({ x: event.x ?? current.startX, y: event.y ?? 0 })
      }}
      onMouseUp={(event) => {
        const current = drag.current
        if (event.button !== 0 || !current) return
        // Commit what the pointer points at now, not the last coalesced frame.
        const action = moderationActionForDrag(platform, dragDistance(current.startX, event.x), {
          messageDeleted,
        })
        cancel()
        if (action) onModerate(action)
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
      {distance !== null ? <RailDragCancellation onCancel={cancel} /> : null}
      {/* Grip line — painted transparent (not unmounted) outside row hover,
          so GPUI sees no mount churn. A painted child takes the hit test from
          its parent, so it must not catch the pointer or the rail's middle
          goes dead. */}
      <div
        style={{
          position: 'absolute',
          left: 5,
          top: 5,
          bottom: 5,
          width: 3,
          borderRadius: 2,
          backgroundColor:
            distance !== null || hovered
              ? theme.text2
              : rowHovered
                ? withAlpha(theme.text2, 0.35)
                : 'transparent',
          pointerEvents: 'none',
        }}
      />
      {distance !== null && distance > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: distance,
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
