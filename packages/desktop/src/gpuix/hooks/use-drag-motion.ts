import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { registerSupplementalHotkeys } from '../state/action-bindings'
import { useStoreSelector } from '../state/create-store'
import { windowActivityStore } from '../state/window-activity'
import { useWindowScope } from '../state/window-scope'

export interface DragPoint {
  x: number
  y: number
}

interface ActiveDrag {
  cancel(): void
}
const activeDrags = new Map<string, ActiveDrag>()

export function createDragMotion(move: (point: DragPoint) => void) {
  let onMove = move
  let pending: DragPoint | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  const flush = () => {
    const point = pending
    cancel()
    if (point) onMove(point)
  }
  return {
    setHandler(handler: (point: DragPoint) => void) {
      onMove = handler
    },
    schedule(point: DragPoint) {
      pending = point
      timer ??= setTimeout(flush, 16)
    },
    flush,
    cancel,
  }
}

export function useDragMotion(move: (point: DragPoint) => void) {
  const [motion] = useState(() => createDragMotion(move))
  useLayoutEffect(() => {
    motion.setHandler(move)
  }, [motion, move])
  useEffect(() => () => motion.cancel(), [motion])
  return motion
}

export function useDragCancellation(active: boolean, id: string, cancel: () => void): void {
  const scope = useWindowScope()
  const windowActive = useStoreSelector(
    windowActivityStore,
    (entries) => entries.get(scope)?.active,
  )
  const callback = useRef(cancel)
  useLayoutEffect(() => {
    callback.current = cancel
  }, [cancel])
  useEffect(() => {
    if (active && windowActive === false) callback.current()
  }, [active, windowActive])
  useEffect(() => {
    if (!active) return undefined
    const owner = { cancel: () => callback.current() }
    activeDrags.get(scope)?.cancel()
    activeDrags.set(scope, owner)
    return () => {
      if (activeDrags.get(scope) === owner) activeDrags.delete(scope)
    }
  }, [active, scope])
  useEffect(() => {
    if (!active) return undefined
    return registerSupplementalHotkeys(
      scope,
      id,
      () => [{ id: 'cancel', keys: ['escape'], handler: () => callback.current() }],
      'beforeCustom',
    )
  }, [active, id, scope])
  useEffect(() => () => callback.current(), [])
}
