import { afterEach, describe, expect, test } from 'bun:test'

import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import { getLanguage, setLanguage, t, tPlural, translatorFor } from '../src/i18n'
import { languageStore } from '../src/i18n/language'
import { en } from '../src/i18n/locales/en'
import { ru } from '../src/i18n/locales/ru'

describe('i18n', () => {
  afterEach(() => setLanguage(DEFAULT_SETTINGS.language))

  test('new installs start in English', () => {
    expect(DEFAULT_SETTINGS.language).toBe('en')
  })

  test('every English key has a Russian translation and vice versa', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
  })

  test('no dictionary value is empty', () => {
    for (const dictionary of [en, ru]) {
      for (const [key, value] of Object.entries(dictionary)) expect(value.trim(), key).not.toBe('')
    }
  })

  test('translates and interpolates in both languages', () => {
    setLanguage('en')
    expect(t('settings.title')).toBe('Settings')
    expect(t('settings.selfPing.previewMessage', { name: '@user' })).toContain('@user')

    setLanguage('ru')
    expect(t('settings.title')).toBe('Настройки')
    expect(t('settings.selfPing.previewMessage', { name: '@user' })).toContain('@user')
  })

  test('keeps a bound translator independent of the active language', () => {
    const english = translatorFor('en')
    setLanguage('ru')
    expect(english('settings.title')).toBe('Settings')
    expect(t('settings.title')).toBe('Настройки')
  })

  test('keeps the active language and subscribers across module reload', async () => {
    setLanguage('ru')
    const remounted: typeof import('../src/i18n/language') = await import(
      `../src/i18n/language.ts?qa-reload=${crypto.randomUUID()}`
    )
    expect(remounted.languageStore).toBe(languageStore)
    expect(remounted.getLanguage()).toBe('ru')

    const notifications: string[] = []
    const unsubscribe = languageStore.subscribe(() => notifications.push(t('settings.title')))
    try {
      remounted.setLanguage('en')
      expect(t('settings.title')).toBe('Settings')
      await Promise.resolve()
      expect(notifications).toEqual([])
      await Bun.sleep(1)
      expect(notifications).toEqual(['Settings'])
    } finally {
      unsubscribe()
    }
  })

  test('selects Russian plural forms', () => {
    setLanguage('ru')
    expect(tPlural('settings.status.unsaved', 1)).toContain('1 разделе')
    expect(tPlural('settings.status.unsaved', 3)).toContain('3 разделах')
    expect(tPlural('settings.status.unsaved', 5)).toContain('5 разделах')
    expect(tPlural('settings.status.unsaved', 21)).toContain('21 разделе')
  })

  test('selects English plural forms', () => {
    setLanguage('en')
    expect(tPlural('settings.status.unsaved', 1)).toContain('1 section')
    expect(tPlural('settings.status.unsaved', 3)).toContain('3 sections')
  })

  test('falls back to English for an unknown language', () => {
    setLanguage('de')
    expect(getLanguage()).toBe('en')
    expect(t('settings.title')).toBe('Settings')
  })
})
