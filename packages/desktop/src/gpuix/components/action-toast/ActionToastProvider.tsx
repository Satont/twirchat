import type { PublicInstance } from '@gpuix/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { ActionToast } from './ActionToast'
import { placeToast, type ToastBox } from './toast-placement'
import type { ActionClickEvent, ActionToastState } from './types'

const TOAST_TIME = 1000

interface ActionToastContextValue {
  showToast: (message: string, event?: ActionClickEvent) => void
}

const NOOP_SHOW_TOAST: ActionToastContextValue['showToast'] = () => {}
const ActionToastContext = createContext<ActionToastContextValue>({ showToast: NOOP_SHOW_TOAST })

export function useActionToast(): ActionToastContextValue {
  return useContext(ActionToastContext)
}

export function ActionToastProvider({ children }: { children: ReactNode }) {
  const [layer, setLayer] = useState<PublicInstance | null>(null)
  const [toast, setToast] = useState<ActionToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const geometry = useRef<ToastBox>({ x: 0, y: 0, width: 0, height: 0 })

  const showToast = useCallback((message: string, event?: ActionClickEvent) => {
    setToast({ message, ...placeToast(geometry.current, message, event) })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), TOAST_TIME)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ActionToastContext.Provider value={value}>
      <div
        onLayout={(event) => {
          if (
            event.x === undefined ||
            event.y === undefined ||
            event.width === undefined ||
            event.height === undefined
          )
            return
          geometry.current = {
            x: event.x,
            y: event.y,
            width: event.width,
            height: event.height,
          }
        }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {children}
        <div
          ref={setLayer}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            pointerEvents: 'none',
          }}
        />
        <ActionToast layer={layer} toast={toast} />
      </div>
    </ActionToastContext.Provider>
  )
}
