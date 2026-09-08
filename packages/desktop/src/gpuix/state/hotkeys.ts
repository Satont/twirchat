/**
 * Global hotkeys (port of composables/useHotkeys.ts).
 * Driven from the window-level renderer onKeyDown in main.tsx.
 */

import type { EventPayload } from '@gpuix/react'

import { activeTabStore, activeWatchedTabStore, settingsStore, tabChannelIdsStore } from './app'
import { isTextInputFocused } from './focus'
import { closeTopOverlay } from './overlays'

export interface HotkeyUiActions {
  openAddChannel: () => void
  openTabSelector: () => void
}

let uiActions: HotkeyUiActions | null = null

export function registerHotkeyActions(actions: HotkeyUiActions): void {
  uiActions = actions
}

function parseKeyCombo(combo: string): {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
} {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts.find((part) => !['ctrl', 'shift', 'alt'].includes(part)) ?? '',
  }
}

function matchesCombo(event: EventPayload, combo: string): boolean {
  const parsed = parseKeyCombo(combo)
  const key = event.key ?? ''
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key
  return (
    (event.modifiers?.ctrl ?? false) === parsed.ctrl &&
    (event.modifiers?.shift ?? false) === parsed.shift &&
    (event.modifiers?.alt ?? false) === parsed.alt &&
    normalizedKey === parsed.key
  )
}

function cycleTab(direction: 1 | -1): void {
  const ids: string[] = ['home', ...tabChannelIdsStore.get()]
  const current = activeWatchedTabStore.get()
  const index = ids.indexOf(current)
  const next = ids[(index + direction + ids.length) % ids.length]
  if (next) {
    activeWatchedTabStore.set(next)
    activeTabStore.set('chat')
  }
}

export function handleGlobalKeyDown(event: EventPayload): void {
  if (!uiActions) return

  // ESC closes the topmost overlay. Inputs inside overlays handle their own
  // ESC (element callbacks fire first), so only handle it here when no text
  // editor is focused — otherwise both would fire.
  if (event.key === 'escape') {
    if (!isTextInputFocused()) closeTopOverlay()
    return
  }

  if (isTextInputFocused()) return

  const modifiers = event.modifiers
  // Ctrl+K is hardcoded (same as the Vue build).
  if (modifiers?.ctrl && !modifiers.shift && !modifiers.alt && event.key === 'k') {
    uiActions.openTabSelector()
    return
  }

  const hotkeys = settingsStore.get()?.hotkeys
  if (!hotkeys) return

  if (matchesCombo(event, hotkeys.newTab)) {
    uiActions.openAddChannel()
  } else if (matchesCombo(event, hotkeys.nextTab)) {
    cycleTab(1)
  } else if (matchesCombo(event, hotkeys.prevTab)) {
    cycleTab(-1)
  } else if (matchesCombo(event, hotkeys.tabSelector)) {
    uiActions.openTabSelector()
  }
}
