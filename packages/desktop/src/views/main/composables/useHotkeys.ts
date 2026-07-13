import { onUnmounted } from 'vue'
import type { Ref } from 'vue'
import type { AppSettings } from '@twirchat/shared/types'

// -------------------------------------------------------
// Key-intercept feasibility (verified in Task 1):
//   Ctrl+Tab  → INTERCEPTABLE in Electrobun BrowserWindow
//   Ctrl+L    → INTERCEPTABLE in Electrobun BrowserWindow
// -------------------------------------------------------

export type HotkeyAction = 'newTab' | 'nextTab' | 'prevTab' | 'tabSelector'
export type HotkeyHandlers = Record<HotkeyAction, () => void>

let _handlers: HotkeyHandlers | null = null
let _settingsRef: Ref<AppSettings | null> | null = null
let _isPaused = false
let _isInitialized = false

const SPECIAL_KEYS: Record<string, string> = {
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
}

export function parseKeyCombo(combo: string): {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
} {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  const ctrlKey = parts.includes('ctrl')
  const shiftKey = parts.includes('shift')
  const altKey = parts.includes('alt')
  const keyPart = parts.find((part) => !['ctrl', 'shift', 'alt'].includes(part)) ?? ''

  return {
    altKey,
    ctrlKey,
    key: SPECIAL_KEYS[keyPart] ?? keyPart,
    shiftKey,
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false
  }

  const tag = target.tagName.toLowerCase()

  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parsed = parseKeyCombo(combo)
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const parsedKey = parsed.key.length === 1 ? parsed.key.toLowerCase() : parsed.key

  return (
    event.ctrlKey === parsed.ctrlKey &&
    event.shiftKey === parsed.shiftKey &&
    event.altKey === parsed.altKey &&
    eventKey === parsedKey
  )
}

function globalKeydown(event: KeyboardEvent): void {
  if (_isPaused || !_handlers) {
    return
  }

  const activeElement = typeof document === 'undefined' ? null : document.activeElement
  if (isEditableTarget(activeElement) || isEditableTarget(event.target)) {
    return
  }

  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    _handlers.tabSelector()
    return
  }

  const hotkeys = _settingsRef?.value?.hotkeys
  if (!hotkeys) {
    return
  }

  const actions: HotkeyAction[] = ['newTab', 'nextTab', 'prevTab', 'tabSelector']

  for (const action of actions) {
    const combo = hotkeys[action]
    if (!combo) {
      continue
    }

    if (matchesCombo(event, combo)) {
      event.preventDefault()
      _handlers[action]()
      return
    }
  }
}

export function pause(): void {
  _isPaused = true
}

export function resume(): void {
  _isPaused = false
}

// Recording mode: one-shot keydown listener for rebinding
let _recordingCallback: ((combo: string | null) => void) | null = null

function recordingKeydown(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopImmediatePropagation()

  if (!_recordingCallback) return

  if (event.key === 'Escape') {
    const cb = _recordingCallback
    stopKeyRecording()
    cb(null)
    return
  }

  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')

  const mainKey = event.key.toLowerCase()
  if (['control', 'shift', 'alt', 'meta'].includes(mainKey)) return

  parts.push(mainKey)
  const combo = parts.join('+')

  const cb = _recordingCallback
  stopKeyRecording()
  cb(combo)
}

export function startKeyRecording(callback: (combo: string | null) => void): void {
  _recordingCallback = callback
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', recordingKeydown, { capture: true })
  }
}

export function stopKeyRecording(): void {
  _recordingCallback = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', recordingKeydown, { capture: true })
  }
}

export function useHotkeys(
  settingsRef: Ref<AppSettings | null>,
  handlers: HotkeyHandlers,
): { pause: () => void; resume: () => void } {
  _handlers = handlers
  _settingsRef = settingsRef

  if (typeof window !== 'undefined' && !_isInitialized) {
    window.addEventListener('keydown', globalKeydown)
    _isInitialized = true
  }

  onUnmounted(() => {
    window.removeEventListener('keydown', globalKeydown)
    _isInitialized = false
    _handlers = null
    _settingsRef = null
  })

  return { pause, resume }
}
