import type { Language } from '@twirchat/shared/types'
import { useSyncExternalStore } from 'react'

import { t, tPlural } from '../../i18n'
import { languageStore } from '../../i18n/language'

/** React hook: re-renders the component when the UI language changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(languageStore.subscribe, languageStore.get, languageStore.get)
}

/** React hook returning a language-aware `t`/`tPlural` pair. */
export function useT(): {
  t: typeof t
  tPlural: typeof tPlural
  language: Language
} {
  const language = useLanguage()
  return { t, tPlural, language }
}
