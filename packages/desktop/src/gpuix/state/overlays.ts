/**
 * Overlay close stack — every modal / popover registers its close callback;
 * the window-level ESC handler closes the topmost one.
 */

const stack: Array<() => void> = []

export function pushOverlayClose(close: () => void): () => void {
  stack.push(close)
  let active = true
  return () => {
    if (!active) return
    active = false
    const index = stack.indexOf(close)
    if (index !== -1) stack.splice(index, 1)
  }
}

/** Close the topmost overlay. Returns true if one was open. */
export function closeTopOverlay(): boolean {
  const close = stack.pop()
  if (!close) return false
  close()
  return true
}

// ── React helper (kept here so components import one module) ───────────────

import { useEffect } from 'react'

/** Register `close` in the overlay stack while `open` is true. */
export function useOverlayClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    return pushOverlayClose(close)
  }, [open, close])
}
