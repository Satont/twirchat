import { useEffect, useRef } from 'react'

import { persistentResource } from './persistent-resources'
import { useWindowScope } from './window-scope'

/**
 * Tracks whether a native text editor currently holds focus, so the global
 * hotkey handler can skip — mirrors the Vue app's isEditableTarget check.
 */

interface TextInputFocusRuntime {
  focusedEditors: Map<string, number>
  listeners: Map<string, Set<(focused: boolean) => void>>
}
const { focusedEditors, listeners } = persistentResource(
  'textInputFocusRuntime',
  (): TextInputFocusRuntime => ({
    focusedEditors: new Map(),
    listeners: new Map(),
  }),
)

export function isTextInputFocused(scope = 'main'): boolean {
  return (focusedEditors.get(scope) ?? 0) > 0
}

export function onTextInputFocusChange(
  listener: (focused: boolean) => void,
  scope = 'main',
): () => void {
  const group = listeners.get(scope) ?? new Set()
  group.add(listener)
  listeners.set(scope, group)
  let active = true
  return () => {
    if (!active) return
    active = false
    group.delete(listener)
    if (!group.size && listeners.get(scope) === group) listeners.delete(scope)
  }
}

/** Call from onFocus/onBlur of every <input>/<textarea>. */
export function trackTextInputFocus(focused: boolean, scope = 'main'): void {
  const count = Math.max(0, (focusedEditors.get(scope) ?? 0) + (focused ? 1 : -1))
  if (count) focusedEditors.set(scope, count)
  else focusedEditors.delete(scope)
  for (const listener of [...(listeners.get(scope) ?? [])]) listener(count > 0)
}

/**
 * onFocus/onBlur props for a native editor that keep the global counter
 * honest even when the editor unmounts while focused (dialogs closing on
 * ESC/submit), which would otherwise leave hotkeys disabled for good.
 */
export function useTextInputFocusTracking(onChange?: (focused: boolean) => void): {
  onFocus: () => void
  onBlur: () => void
} {
  const focused = useRef(false)
  const scope = useWindowScope()
  useEffect(
    () => () => {
      if (focused.current) {
        trackTextInputFocus(false, scope)
        focused.current = false
      }
    },
    [scope],
  )
  return {
    onFocus: () => {
      if (!focused.current) {
        focused.current = true
        trackTextInputFocus(true, scope)
      }
      onChange?.(true)
    },
    onBlur: () => {
      if (focused.current) {
        focused.current = false
        trackTextInputFocus(false, scope)
      }
      onChange?.(false)
    },
  }
}

declare module './persistent-resources' {
  interface PersistentResources {
    textInputFocusRuntime: TextInputFocusRuntime
  }
}
