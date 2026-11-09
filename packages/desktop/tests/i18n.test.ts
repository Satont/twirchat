import { describe, expect, test } from 'bun:test'

import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import { getLanguage, setLanguage, t, tPlural } from '../src/gpuix/i18n'
import { en } from '../src/gpuix/i18n/locales/en'
import { ru } from '../src/gpuix/i18n/locales/ru'

describe('i18n', () => {
  test('new installs start in English', () => {
    expect(DEFAULT_SETTINGS.language).toBe('en')
  })

  test('every English key has a Russian translation and vice versa', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
  })

  test('no dictionary value is empty', () => {
    for (const [key, value] of Object.entries({ ...en, ...ru })) {
      expect(value.trim(), key).not.toBe('')
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
