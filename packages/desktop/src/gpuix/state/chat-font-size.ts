import type { AppSettings } from '@twirchat/shared/types'

import { settingsStore } from './app'

/**
 * Chat font bounds shared by the appearance slider and the Ctrl+wheel gesture,
 * so the two controls can never drift apart.
 */
export const CHAT_FONT_SIZE_MIN = 11
export const CHAT_FONT_SIZE_MAX = 22

/** A wheel gesture writes the setting once, after the last step settles. */
export const CHAT_FONT_SIZE_SAVE_DELAY_MS = 200

export interface ChatFontSizeApi {
  saveSettings(settings: AppSettings): Promise<void>
}

export function clampChatFontSize(value: number): number {
  if (!Number.isFinite(value)) return CHAT_FONT_SIZE_MIN
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(value)))
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSave(api: ChatFontSizeApi): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    // Read the store when the write runs: another preference may have changed
    // during the gesture and must not be overwritten by a stale snapshot.
    const settings = settingsStore.get()
    if (!settings) return
    void api.saveSettings(settings).catch((error) => {
      console.warn('[chat-font-size] saveSettings failed:', error)
    })
  }, CHAT_FONT_SIZE_SAVE_DELAY_MS)
}

/**
 * Apply one Ctrl+wheel step. Returns the new size, or null when the store is
 * not loaded or the size already sits on the requested bound.
 */
export function stepChatFontSize(api: ChatFontSizeApi, direction: -1 | 1): number | null {
  const settings = settingsStore.get()
  if (!settings) return null
  const next = clampChatFontSize(settings.fontSize + direction)
  if (next === settings.fontSize) return null
  settingsStore.set({ ...settings, fontSize: next })
  scheduleSave(api)
  return next
}
