import { useSyncExternalStore } from 'react'

import { getLanguage, languageStore } from './language'
import { en } from './locales/en'
import { ru } from './locales/ru'
import type { Dictionary, Language, TranslationParams } from './types'

export { getLanguage, languageStore, normalizeLanguage, setLanguage } from './language'
export type { Dictionary, Language, TranslationParams } from './types'

export type MessageKey = keyof typeof en

const DICTIONARIES: Record<Language, Dictionary> = { en, ru }

function lookup(dictionary: Dictionary, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

function translateFor(language: Language, key: MessageKey, params?: TranslationParams): string {
  const template = DICTIONARIES[language][key] ?? en[key] ?? key
  return interpolate(template, params)
}

function translatePluralFor(
  language: Language,
  base: string,
  count: number,
  params?: TranslationParams,
): string {
  const dictionary = DICTIONARIES[language]
  const form = new Intl.PluralRules(language).select(count)
  const template =
    lookup(dictionary, `${base}.${form}`) ??
    lookup(en, `${base}.${form}`) ??
    lookup(dictionary, `${base}.other`) ??
    lookup(en, `${base}.other`) ??
    base
  return interpolate(template, { count, ...params })
}

/** Translate a key in the current language, falling back to English. */
export function t(key: MessageKey, params?: TranslationParams): string {
  return translateFor(getLanguage(), key, params)
}

/**
 * Translate a pluralized key (`base.one`, `base.few`, `base.many`,
 * `base.other`). `{count}` is always available to the template.
 */
export function tPlural(base: string, count: number, params?: TranslationParams): string {
  return translatePluralFor(getLanguage(), base, count, params)
}

/**
 * Build a translator bound to a specific language. Useful for memoized values
 * that must refresh when the UI language changes.
 */
export function translatorFor(language: Language): typeof t {
  return (key, params) => translateFor(language, key, params)
}

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
