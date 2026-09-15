/**
 * Slider — GPUIX has no range input and no element bounds readback, so the
 * track is a fixed pixel width and drags are resolved from pointer deltas.
 * Pressing a segment jumps close to the pointer position; dragging then
 * adjusts continuously from there.
 */

import { useRef } from 'react'
import { accent } from '../../theme'

const SEGMENT_WIDTH = 8

export function Slider({
  value,
  min,
  max,
  step = 1,
  width,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  width: number
  onChange: (value: number) => void
}) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null)

  const range = max - min
  const ratio = Math.min(1, Math.max(0, (value - min) / range))
  const segments = Math.max(1, Math.ceil(width / SEGMENT_WIDTH))
  const pxPerUnit = width / range

  const setFromRatio = (r: number) => {
    const clamped = Math.min(1, Math.max(0, r))
    const raw = min + clamped * range
    onChange(Math.round(raw / step) * step)
  }

  return (
    <div style={{ position: 'relative', width, height: 16, userSelect: 'none' }}>
      {/* Track + fill + thumb (visual only) */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 0,
          width,
          height: 4,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.12)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 0,
          width: Math.max(4, ratio * width),
          height: 4,
          borderRadius: 2,
          backgroundColor: accent.primary,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 1,
          left: Math.max(0, Math.min(width - 14, ratio * width - 7)),
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: accent.primary,
          boxShadow: {
            offsetX: 0,
            offsetY: 0,
            blurRadius: 2,
            spreadRadius: 2,
            color: accent.tint25,
          },
          pointerEvents: 'none',
        }}
      />
      {/* Hit segments */}
      <div style={{ position: 'absolute', top: 0, left: 0, display: 'flex', flexDirection: 'row' }}>
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              const segmentRatio = (i + 0.5) / segments
              setFromRatio(segmentRatio)
              drag.current = { startX: event.x ?? 0, startValue: min + segmentRatio * range }
            }}
            onMouseMove={(event) => {
              if (!drag.current) return
              const delta = (event.x ?? 0) - drag.current.startX
              const raw = drag.current.startValue + delta / pxPerUnit
              onChange(Math.round(Math.min(max, Math.max(min, raw)) / step) * step)
            }}
            onMouseUp={() => {
              drag.current = null
            }}
            style={{ width: width / segments, height: 16, cursor: 'pointer' }}
          />
        ))}
      </div>
    </div>
  )
}
