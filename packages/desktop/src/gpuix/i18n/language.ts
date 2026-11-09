import type { Language } from '@twirchat/shared/types'

import { createStore } from '../state/create-store'
import { persistentResource } from '../state/persistent-resources'

/**
 * UI language lives in its own tiny store so non-React modules (notices,
 * system messages, commands) can translate without importing the app store
 * graph. `app.ts` and the settings panel keep it in sync with AppSettings.
 */
export const languageStore = persistentResource('language', () => createStore<Language>('en'))

export function normalizeLanguage(value: unknown): Language {
  return value === 'ru' ? 'ru' : 'en'
}

export function setLanguage(value: unknown): void {
  languageStore.set(normalizeLanguage(value))
}

export function getLanguage(): Language {
  return languageStore.get()
}
