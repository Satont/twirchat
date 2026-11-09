import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useRef, useState } from 'react'

import { useDragCancellation, useDragMotion } from '../../hooks/use-drag-motion'
import { nativeWindow, type NativePaintedElementBounds } from '../../native-window'
import { accent } from '../../theme'
import { useTheme } from '../../theme-context'

const THUMB_WIDTH = 14

interface FaderDrag {
  bounds: NativePaintedElementBounds
  value: number
}

function clampVolume(value: number): number {
  return Math.round(Math.max(-100, Math.min(26, value)) * 2) / 2
}

export function Fader({
  name,
  value,
  width,
  disabled,
  onCommit,
}: {
  name: string
  value: number
  width: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const renderer = useGpuixRequired()
  const native = nativeWindow(renderer)
  const theme = useTheme()
  const element = useRef<PublicInstance | null>(null)
  const drag = useRef<FaderDrag | null>(null)
  const [transient, setTransient] = useState<number | null>(null)
  const motion = useDragMotion(({ x }) => {
    const current = drag.current
    if (!current) return
    current.value = clampVolume(-100 + ((x - current.bounds.x) / current.bounds.width) * 126)
    setTransient(current.value)
  })
  const cancel = () => {
    motion.cancel()
    drag.current = null
    setTransient(null)
  }
  useDragCancellation(transient !== null, `obs-fader:${name}`, cancel)
  const percent = ((clampVolume(transient ?? value) + 100) / 126) * 100
  return (
    <div
      ref={element}
      testId={`obs-fader-${name}`}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={(event) => {
        if (event.key === 'escape') {
          cancel()
          event.preventDefault()
          return
        }
        if (disabled) return
        if (event.key && ['left', 'right', 'up', 'down', 'home'].includes(event.key)) {
          event.preventDefault()
          cancel()
          onCommit(
            event.key === 'home'
              ? 0
              : clampVolume(
                  value +
                    (event.key === 'left' || event.key === 'down' ? -1 : 1) *
                      (event.modifiers?.shift ? 0.5 : 1),
                ),
          )
        }
      }}
      onMouseDown={(event) => {
        if (disabled || event.button !== 0) return
        cancel()
        const bounds = element.current ? native.getPaintedElementBounds(element.current.id) : null
        if (!bounds || bounds.width <= 0) return
        drag.current = { bounds, value }
        motion.schedule({ x: event.x ?? bounds.x, y: event.y ?? bounds.y })
        motion.flush()
      }}
      onMouseMove={(event) => {
        const current = drag.current
        if (!current) return
        if (event.pressedButton !== 0 || disabled) {
          cancel()
          return
        }
        motion.schedule({ x: event.x ?? current.bounds.x, y: event.y ?? current.bounds.y })
      }}
      onMouseUp={(event) => {
        const current = drag.current
        if (event.button !== 0 || !current) return
        const point = { x: event.x ?? current.bounds.x, y: event.y ?? current.bounds.y }
        const window = native.getWindowBounds()
        if (
          disabled ||
          !window ||
          point.x < 0 ||
          point.y < 0 ||
          point.x >= window.width ||
          point.y >= window.height
        ) {
          cancel()
          return
        }
        motion.schedule(point)
        motion.flush()
        const committed = current.value
        cancel()
        onCommit(committed)
      }}
      style={{
        width,
        height: 26,
        position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: 1 },
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          height: 6,
          width: '100%',
          borderRadius: 3,
          backgroundColor: theme.border,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 10,
          height: 6,
          width: `${percent}%`,
          borderRadius: 3,
          backgroundColor: accent.primary,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: (percent / 100) * (width - THUMB_WIDTH),
          width: THUMB_WIDTH,
          height: 18,
          borderRadius: 4,
          backgroundColor: theme.text,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
