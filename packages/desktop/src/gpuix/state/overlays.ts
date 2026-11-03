/**
 * Overlay close stack — every modal / popover registers its close callback;
 * the window-level ESC handler closes the topmost one.
 */

const stacks = new Map<string, Array<{ close: () => void; hotkeyContextId?: string }>>()
const observers = new Map<string, Set<() => void>>()

export function getTopOverlayHotkeyContext(scope = 'main'): string | null | undefined {
  const top = stacks.get(scope)?.at(-1)
  return top ? (top.hotkeyContextId ?? null) : undefined
}

export function onOverlayStackChange(listener: () => void, scope = 'main'): () => void {
  const group = observers.get(scope) ?? new Set<() => void>()
  group.add(listener)
  observers.set(scope, group)
  return () => {
    group.delete(listener)
    if (!group.size && observers.get(scope) === group) observers.delete(scope)
  }
}

function changed(scope: string): void {
  for (const observer of [...(observers.get(scope) ?? [])]) observer()
}

export function hasOpenOverlay(scope = 'main'): boolean {
  return (stacks.get(scope)?.length ?? 0) > 0
}

export function pushOverlayClose(
  close: () => void,
  scope = 'main',
  hotkeyContextId?: string,
): () => void {
  const stack = stacks.get(scope) ?? []
  const entry = { close, hotkeyContextId }
  stack.push(entry)
  stacks.set(scope, stack)
  changed(scope)
  let active = true
  return () => {
    if (!active) return
    active = false
    const index = stack.indexOf(entry)
    if (index === -1) return
    stack.splice(index, 1)
    if (!stack.length && stacks.get(scope) === stack) stacks.delete(scope)
    changed(scope)
  }
}

/** Close the topmost overlay. Returns true if one was open. */
export function closeTopOverlay(scope = 'main'): boolean {
  const stack = stacks.get(scope)
  const entry = stack?.pop()
  if (!entry) return false
  if (!stack?.length) stacks.delete(scope)
  changed(scope)
  entry.close()
  return true
}

// ── React helper (kept here so components import one module) ───────────────

import { useEffect, useRef } from 'react'

import { useWindowScope } from './window-scope'

/** Register `close` in the overlay stack while `open` is true. */
export function useOverlayClose(open: boolean, close: () => void, hotkeyContextId?: string): void {
  const scope = useWindowScope()
  const callback = useRef(close)
  callback.current = close
  useEffect(() => {
    if (!open) return
    return pushOverlayClose(() => callback.current(), scope, hotkeyContextId)
  }, [open, scope, hotkeyContextId])
}
