import type { EventPayload, KeyEvent } from '@gpuix/react'
/**
 * Global hotkeys (port of composables/useHotkeys.ts).
 * Driven from the window-level renderer onKeyDown in main.tsx.
 */

import { runInBackground } from '../../services/background-task'
import { normalizeKeyChord, eventKeyChord } from '../hotkey-bindings'
import { t } from '../i18n'
import {
  dispatchCustomHotkey,
  actionBindingsStore,
  registerSupplementalHotkeys,
  refreshNativeHotkeyPlan,
  type SupplementalHotkeyBinding,
} from './action-bindings'
import { activeTabStore, activeWatchedTabStore, settingsStore, tabChannelIdsStore } from './app'
import { isTextInputFocused } from './focus'
import { closeTopOverlay, hasOpenOverlay } from './overlays'
import { setMainTab } from './settings-session'
export {
  registerHotkeyContext,
  setHotkeyRoute,
  useHotkeyContext,
  useHotkeyRoute,
} from './action-bindings'

export interface HotkeyUiActions {
  openAddChannel: () => void
  openTabSelector: () => void
  openAllChatSearch?: () => void
  cycleTab?: (direction: 1 | -1) => void
  isChatActive?: () => boolean
}

const windowActions = new Map<string, HotkeyUiActions>()

let stopLegacyStores: (() => void) | undefined
function legacyBindings(actions: HotkeyUiActions, scope: string): SupplementalHotkeyBinding[] {
  if (windowActions.get(scope) !== actions || hasOpenOverlay(scope)) return []
  const inputFocused = isTextInputFocused(scope)
  const chatActive = actions.isChatActive?.() ?? activeTabStore.get() === 'chat'
  if (inputFocused && !chatActive) return []
  const bindings: SupplementalHotkeyBinding[] = []
  const used = new Set<string>()
  const add = (id: string, combo: string | undefined, handler: (() => void) | undefined) => {
    if (!combo || !handler) return
    let chord: string
    try {
      chord = normalizeKeyChord(combo)
    } catch {
      return
    }
    if (inputFocused && !chord.split('+').some((part) => part === 'ctrl' || part === 'alt')) return
    if (used.has(chord)) return
    used.add(chord)
    bindings.push({ id, keys: [chord], handler })
  }
  add('quick-switcher', 'ctrl+k', actions.openTabSelector)
  add('global-search', 'ctrl+shift+f', actions.openAllChatSearch)
  if (actionBindingsStore.get().value.legacyNavigation) {
    const hotkeys = settingsStore.get()?.hotkeys
    if (hotkeys) {
      if (!inputFocused) add('new-tab', hotkeys.newTab, actions.openAddChannel)
      const cycle = actions.cycleTab ?? (scope === 'main' ? cycleTab : undefined)
      if (cycle) {
        add('next-tab', hotkeys.nextTab, () => cycle(1))
        add('previous-tab', hotkeys.prevTab, () => cycle(-1))
      }
      add('tab-selector', hotkeys.tabSelector, actions.openTabSelector)
    }
  }
  return bindings
}
export function registerHotkeyActions(actions: HotkeyUiActions, scope = 'main'): () => void {
  windowActions.set(scope, actions)
  const stopSource = registerSupplementalHotkeys(scope, 'navigation', () =>
    legacyBindings(actions, scope),
  )
  if (!stopLegacyStores) {
    const refresh = () => {
      for (const id of windowActions.keys()) refreshNativeHotkeyPlan(id)
    }
    const stopSettings = settingsStore.subscribe(refresh)
    const stopTabs = activeTabStore.subscribe(refresh)
    stopLegacyStores = () => {
      stopSettings()
      stopTabs()
    }
  }
  return () => {
    if (windowActions.get(scope) === actions) windowActions.delete(scope)
    stopSource()
    if (!windowActions.size) {
      stopLegacyStores?.()
      stopLegacyStores = undefined
    }
  }
}
export function invokeHotkeyUiAction(
  action: 'openAllChatSearch' | 'openTabSelector' | 'openAddChannel',
  scope = 'main',
): void {
  const handler = windowActions.get(scope)?.[action]
  if (!handler) throw new Error(t('notices.hotkeys.actionUnavailable'))
  handler()
}

/** GPUIX arrow names → DOM names, so recorded combos match the stored format. */
export const GPUIX_TO_DOM_KEY: Record<string, string> = {
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
}

const KEY_LABELS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
}

/** Stored combo ('alt+arrowleft') → display label ('Alt+←'). */
export function formatKeyCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join('+')
}

function matchesCombo(event: EventPayload, combo: string): boolean {
  try {
    return (
      eventKeyChord({ key: event.key ?? '', modifiers: event.modifiers }) ===
      normalizeKeyChord(combo)
    )
  } catch {
    return false
  }
}

function cycleTab(direction: 1 | -1): void {
  const ids: string[] = ['home', ...tabChannelIdsStore.get()]
  const current = activeWatchedTabStore.get()
  const index = ids.indexOf(current)
  const next = ids[(index + direction + ids.length) % ids.length]
  if (next) {
    activeWatchedTabStore.set(next)
    setMainTab('chat')
  }
}

export function handleGlobalKeyDown(event: KeyEvent, scope = 'main'): void {
  if (dispatchCustomHotkey(event, scope)) return
  if (event.defaultPrevented) return
  const uiActions = windowActions.get(scope)
  if (!uiActions) return

  // ESC closes the topmost overlay. Inputs inside overlays handle their own
  // ESC (element callbacks fire first), so only handle it here when no text
  // editor is focused — otherwise both would fire.
  if (event.key === 'escape') {
    if (!isTextInputFocused(scope)) closeTopOverlay(scope)
    return
  }

  const modifiers = event.modifiers
  const inputFocused = isTextInputFocused(scope)
  if (hasOpenOverlay(scope)) return
  if (
    inputFocused &&
    (!(uiActions.isChatActive?.() ?? activeTabStore.get() === 'chat') ||
      (!modifiers?.ctrl && !modifiers?.alt))
  ) {
    return
  }
  if (
    modifiers?.ctrl &&
    modifiers.shift &&
    !modifiers.alt &&
    event.key?.toLowerCase() === 'f' &&
    uiActions.openAllChatSearch
  ) {
    event.preventDefault()
    uiActions.openAllChatSearch()
    return
  }
  // Ctrl+K is hardcoded (same as the Vue build).
  if (modifiers?.ctrl && !modifiers.shift && !modifiers.alt && event.key?.toLowerCase() === 'k') {
    event.preventDefault()
    uiActions.openTabSelector()
    return
  }

  const match = legacyBindings(uiActions, scope).find(
    (binding) => !!binding.keys[0] && matchesCombo(event, binding.keys[0]),
  )
  if (match) {
    // A combo like Ctrl+Tab must not also run GPUI's default (focus moves).
    event.preventDefault()
    const result = match.handler()
    if (result) runInBackground(result, 'hotkeys background operation failed')
  }
}
