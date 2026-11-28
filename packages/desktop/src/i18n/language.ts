import type { Language } from '@twirchat/shared/types'

import { createStore, type Store } from '../state/create-store'
import { persistentResource } from '../state/persistent-resources'

export const languageStore = persistentResource('language', () => createStore<Language>('en'))

export function setLanguage(value: unknown): void {
  languageStore.set(value === 'ru' ? 'ru' : 'en')
}

export function getLanguage(): Language {
  return languageStore.get()
}

declare module '../state/persistent-resources' {
  interface PersistentResources {
    language: Store<Language>
  }
}
