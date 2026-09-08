/**
 * Modal dialog — full-window anchored overlay (deferred paint so it sits
 * above virtual lists) with a dimmed backdrop and a centered card.
 */

import type { ReactNode } from 'react'
import { elevated } from '../../theme'

export function Modal({
  width,
  onClose,
  children,
}: {
  width: number
  onClose: () => void
  children: ReactNode
}) {
  return (
    <anchored deferred occlude position={{ x: 0, y: 0 }} style={{ width: '100%', height: '100%' }}>
      {/* Backdrop: swallows clicks AND the wheel */}
      <div
        onClick={onClose}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: elevated.backdrop,
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
