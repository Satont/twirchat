import { activeTabStore, type MainTab } from './app'
import { createStore } from './create-store'

export interface SettingsSessionState {
  dirty: boolean
  saving: boolean
  pending: { proceed: () => void } | null
}

interface SettingsSessionHandlers {
  save: () => Promise<boolean>
  discard: () => void
}

export const settingsSessionStore = createStore<SettingsSessionState>({
  dirty: false,
  saving: false,
  pending: null,
})

let handlers: SettingsSessionHandlers | null = null

/** Called by SettingsPanel while it is mounted. */
export function bindSettingsSession(next: SettingsSessionHandlers): () => void {
  handlers = next
  return () => {
    if (handlers !== next) return
    handlers = null
    settingsSessionStore.set({ dirty: false, saving: false, pending: null })
  }
}

export function syncSettingsSession(dirty: boolean, saving: boolean): void {
  const state = settingsSessionStore.get()
  if (state.dirty === dirty && state.saving === saving) return
  settingsSessionStore.set({ ...state, dirty, saving })
}

/**
 * Defers a navigation away from Settings until the pending warning is
 * resolved. Without unsaved changes the action runs immediately.
 */
export function requestLeaveSettings(proceed: () => void): boolean {
  const state = settingsSessionStore.get()
  if (!state.dirty || handlers === null) {
    proceed()
    return true
  }
  settingsSessionStore.set({ ...state, pending: { proceed } })
  return false
}

export function setMainTab(tab: MainTab): void {
  if (activeTabStore.get() === tab) return
  requestLeaveSettings(() => activeTabStore.set(tab))
}

export function stayInSettings(): void {
  const state = settingsSessionStore.get()
  if (!state.pending) return
  settingsSessionStore.set({ ...state, pending: null })
}

export function discardSettingsAndLeave(): void {
  const state = settingsSessionStore.get()
  const pending = state.pending
  handlers?.discard()
  settingsSessionStore.set({ ...state, pending: null, dirty: false })
  pending?.proceed()
}

export async function saveSettingsAndLeave(): Promise<boolean> {
  const state = settingsSessionStore.get()
  if (!handlers) {
    state.pending?.proceed()
    return true
  }
  const saved = await handlers.save()
  if (!saved) return false
  const latest = settingsSessionStore.get()
  const pending = latest.pending
  settingsSessionStore.set({ ...latest, pending: null, dirty: false })
  pending?.proceed()
  return true
}
