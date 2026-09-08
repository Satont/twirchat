/**
 * Modal dialog — full-window anchored overlay (deferred paint so it sits
 * above virtual lists) with a dimmed backdrop and a centered card.
 *
 * GPUIX anchored layers don't resolve percentage sizes, so the overlay is
 * sized in pixels from useWindowSize(). Registers into the overlay close
 * stack so ESC dismisses it (see state/overlays.ts).
 */

import { useEffect, type ReactNode } from 'react'
import { useWindowSize } from '@gpuix/react'

import { elevated } from '../../theme'
import { pushOverlayClose } from '../../state/overlays'

export function Modal({
  width,
  onClose,
  children,
}: {
  width: number
  onClose: () => void
  children: ReactNode
}) {
  const windowSize = useWindowSize()

  useEffect(() => pushOverlayClose(onClose), [onClose])

  return (
    <anchored
      deferred
      occlude
      position={{ x: 0, y: 0 }}
      style={{
        width: windowSize.width,
        height: windowSize.height,
        // Dimming happens ON the floating layer: it paints its own opaque
        // fill (#1a1a1a) unless overridden, which would kill the translucency.
        backgroundColor: elevated.backdrop,
      }}
    >
      <div
        onClick={onClose}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            width,
            maxHeight: '85%',
            backgroundColor: elevated.dialog,
            borderWidth: 1,
            borderColor: elevated.dialogBorder,
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: {
              offsetX: 0,
              offsetY: 16,
              blurRadius: 48,
              spreadRadius: 0,
              color: '#00000088',
            },
          }}
        >
          {children}
        </div>
      </div>
    </anchored>
  )
}
