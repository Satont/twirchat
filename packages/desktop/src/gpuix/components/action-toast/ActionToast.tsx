import { AnimatePresence, createPortal } from '@gpuix/react'
import { Fragment } from 'react'

import { Toast } from '../ui/Toast'
import { toastWidth } from './toast-placement'
import type { ActionToastProps } from './types'

export function ActionToast({ layer, toast }: ActionToastProps) {
  return layer ? (
    <AnimatePresence>
      {toast ? (
        <Fragment key="action-toast">
          {createPortal(
            <div
              style={{
                position: 'absolute',
                left: toast.left,
                top: toast.top,
                width: toastWidth(toast.message),
                pointerEvents: 'none',
              }}
            >
              <Toast message={toast.message} />
            </div>,
            layer,
          )}
        </Fragment>
      ) : null}
    </AnimatePresence>
  ) : null
}
