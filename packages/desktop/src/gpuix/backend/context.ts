/**
 * React bindings for the in-process desktop backend.
 *
 * Components never import stores/adapters directly — they go through this
 * facade, keeping the same RPC-shaped boundary the Wails build has.
 */

import { createContext, useContext, useEffect, useRef } from 'react'
import type { DesktopBackend } from './server'
import type { DesktopEventMap, DesktopEventName } from './events'

export const BackendContext = createContext<DesktopBackend | null>(null)

export function useBackend(): DesktopBackend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error('useBackend: missing <BackendContext.Provider>')
  return backend
}

/** Subscribe to a backend event for the component's lifetime. */
export function useBackendEvent<EventName extends DesktopEventName>(
  eventName: EventName,
  handler: (payload: DesktopEventMap[EventName]) => void,
): void {
  const backend = useBackend()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return backend.events.on(eventName, (payload) => handlerRef.current(payload))
  }, [backend, eventName])
}
