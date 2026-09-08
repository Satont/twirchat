/**
 * Tracks whether a native text editor currently holds focus, so the global
 * hotkey handler can skip — mirrors the Vue app's isEditableTarget check.
 */

let focusedEditors = 0
const listeners = new Set<(focused: boolean) => void>()

export function isTextInputFocused(): boolean {
  return focusedEditors > 0
}

export function onTextInputFocusChange(listener: (focused: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Call from onFocus/onBlur of every <input>/<textarea>. */
export function trackTextInputFocus(focused: boolean): void {
  focusedEditors = Math.max(0, focusedEditors + (focused ? 1 : -1))
  const value = focusedEditors > 0
  for (const listener of [...listeners]) listener(value)
}
