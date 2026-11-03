/**
 * Modal dialog — full-window anchored overlay (deferred paint so it sits
 * above virtual lists) with a dimmed backdrop and a centered card.
 *
 * GPUIX anchored layers don't resolve percentage sizes, so the overlay is
 * sized in pixels from useWindowSize(). Registers into the overlay close
 * stack so ESC dismisses it (see state/overlays.ts).
 */

import { useWindowSize } from '@gpuix/react'
import { useEffect, useRef, type ReactNode } from 'react'

import { pushOverlayClose } from '../../state/overlays'
import { useWindowScope } from '../../state/window-scope'
import { elevated } from '../../theme'
import { useTheme } from '../../theme-context'

export function Modal({
  width,
  onClose,
  children,
  embedded = false,
  closeOnOutsideClick = true,
  hotkeyContextId,
}: {
  width: number
  onClose: () => void
  children: ReactNode
  embedded?: boolean
  closeOnOutsideClick?: boolean
  hotkeyContextId?: string
}) {
  const windowSize = useWindowSize()
  const theme = useTheme()

  const scope = useWindowScope()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(
    () => pushOverlayClose(() => close.current(), scope, hotkeyContextId),
    [scope, hotkeyContextId],
  )

  if (embedded)
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.dialog,
        }}
      >
        {children}
      </div>
    )

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
        onClick={closeOnOutsideClick ? onClose : undefined}
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
            width: Math.min(width, Math.max(280, windowSize.width - 32)),
            maxHeight: '85%',
            backgroundColor: theme.dialog,
            borderWidth: 1,
            borderColor: theme.dialogBorder,
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
