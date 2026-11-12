import { describe, expect, test } from 'bun:test'

import { translatorFor, type Language } from '../src/gpuix/i18n'
import { en } from '../src/gpuix/i18n/locales/en'
import { ru } from '../src/gpuix/i18n/locales/ru'
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SECTIONS,
  resolveSettingsCategory,
  retainMountedSettingsSections,
  searchSettings,
  stepSettingsCategory,
  visibleSettingsSections,
  type SettingsSectionId,
} from '../src/gpuix/settings-search'

const ids = (query: string) => searchSettings(query).sections.map((section) => section.id)

describe('settings search index', () => {
  test('every existing section has a unique reachable category and a save contract', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(28)
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size).toBe(
      SETTINGS_SECTIONS.length,
    )
    expect(searchSettings('').categories).toEqual(SETTINGS_CATEGORIES)
    for (const section of SETTINGS_SECTIONS) {
      const result = searchSettings('')
      expect(visibleSettingsSections(section.category, result)).toContain(section.id)
      expect(section.keywords.length).toBeGreaterThan(10)
      expect(['section', 'action']).toContain(section.saveMode)
    }
    // Form sections all stage a draft and expose one save footer.
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'emotes')?.saveMode).toBe('section')
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'pause')?.saveMode).toBe('section')
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'notifications')?.saveMode).toBe(
      'section',
    )
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'overlay')?.saveMode).toBe('section')
    // Action-only sections apply each action immediately.
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'plugins')?.saveMode).toBe('action')
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'donations')?.saveMode).toBe('action')
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'twitch-session')?.saveMode).toBe(
      'action',
    )
  })
  test('field names, providers, aliases and Russian terms find editors outside the current category', () => {
    const queries: [string, SettingsSectionId][] = [
      ['fontFamily', 'appearance'],
      ['Inter', 'appearance'],
      ['autoCheckUpdates', 'updates'],
      ['muted channels', 'notifications'],
      ['sound file', 'notifications'],
      ['PCRE2', 'rules'],
      ['ignored placeholder', 'rules'],
      ['maximum file size', 'history'],
      ['flush logs', 'history'],
      ['ShareX headers', 'image-uploader'],
      ['буфер изображений', 'image-uploader'],
      ['selfPing rgba', 'self-ping'],
      ['timestamp format', 'timestamps'],
      ['HH:MM', 'timestamps'],
      ['double click reply', 'replies'],
      ['дабл клик', 'replies'],
      ['zero width', 'emotes'],
      ['FFZ', 'emotes'],
      ['FFZ:AP', 'emotes'],
      ['DankChat', 'emotes'],
      ['Homies Custom', 'emotes'],
      ['Twir badges', 'emotes'],
      ['7TV presence', 'emotes'],
      ['Azure region', 'translation'],
      ['Morse outgoing', 'translation'],
      ['Quick reasons', 'moderation'],
      ['command template', 'commands'],
      ['Twir autocomplete', 'twir-integration'],
      ['jeetbot аргументы', 'jeetbot-integration'],
      ['Fossabot алиасы', 'fossabot-integration'],
      ['Nightbot автодополнение', 'nightbot-integration'],
      ['PotatBotat', 'potat-integration'],
      ['SupiBot', 'supibot-integration'],
      ['plugin manifest', 'plugins'],
      ['DonationAlerts', 'donations'],
      ['DonatePay API key', 'donations'],
      ['MemeAlerts', 'donations'],
      ['донаты', 'donations'],
      ['save rules', 'rules'],
      ['overlay.port', 'overlay'],
      ['text colour', 'overlay'],
      ['Ctrl+Tab', 'shortcuts'],
      ['OAuth token', 'twitch-session'],
      ['перевод', 'translation'],
      ['обновления', 'updates'],
      ['папка', 'history'],
    ]
    for (const [query, expected] of queries) expect(ids(query)).toContain(expected)
    expect(ids('fontFamily')).toEqual(['appearance'])
    // A single-word title stays prefix-inclusive; Streamer Mode mentions notifications too.
    expect(ids('notifications')).toEqual(['streamer-mode', 'notifications'])
  })
  test('short prefixes stay searchable even when another section contains the whole word', () => {
    expect(ids('use')).toContain('streamer-mode')
    expect(ids('use')).toContain('translation')
    expect(ids('user')).toContain('streamer-mode')
    expect(ids('hide')).toContain('streamer-mode')
  })
  test('full visible names and descriptions find their section instead of only their first word', () => {
    const names: [string, SettingsSectionId][] = [
      ['Hide user card avatars', 'streamer-mode'],
      ['Hide viewer counts and stream duration', 'streamer-mode'],
      ['Скрывать аватары в карточке пользователя', 'streamer-mode'],
      ['Require double-click to open links', 'pause'],
      ['Открывать ссылки двойным щелчком', 'pause'],
      ['Automatically translate incoming messages', 'translation'],
      ['Автоматически переводить входящие сообщения', 'translation'],
      ['Дополнительные заголовки', 'image-uploader'],
      ['Включить подсветку', 'self-ping'],
      ['Reply on double-click', 'replies'],
      ['Ответ двойным кликом', 'replies'],
      ['Choose how to start a reply to a message', 'replies'],
      ['Protect private details while streaming', 'streamer-mode'],
      ['Скрывайте личные данные во время стрима', 'streamer-mode'],
      ['Keep chat still while reading or opening links', 'pause'],
      ['Настройте отображение времени в чате', 'timestamps'],
    ]
    for (const [query, expected] of names) {
      expect(ids(query)).toContain(expected)
      expect(ids(query.split(' ')[0] ?? '')).toContain(expected)
    }
  })
  test('every section indexes the labels and hints it renders in both languages', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.searchPrefixes.length).toBeGreaterThan(0)
      for (const dictionary of [en, ru]) {
        const values = Object.entries(dictionary)
          .filter(([key]) => section.searchPrefixes.some((prefix) => key.startsWith(prefix)))
          .map(([, value]) => value)
        expect(values.length).toBeGreaterThan(0)
        for (const value of values) expect(ids(value)).toContain(section.id)
      }
    }
  })
  test('terms use AND within one section, with case-insensitive prefix and punctuation normalization', () => {
    expect(ids('  AZURE---REG  ')).toEqual(['translation'])
    expect(ids('azure reasons')).toEqual([])
    expect(ids('souND fIlE')).toEqual(['notifications'])
    expect(ids('7tv')).toEqual(['emotes'])
    expect(ids('+++')).toEqual(ids(''))
  })
  test('unknown queries produce an empty result without falling back to a different editor', () => {
    const result = searchSettings('something-that-does-not-exist')
    expect(result.sections).toEqual([])
    expect(result.categories).toEqual([])
    expect(resolveSettingsCategory('general', result)).toBeNull()
    expect(visibleSettingsSections(null, result)).toEqual([])
  })
  test('matching category selection remains stable and clearing search restores the preferred category', () => {
    const colors = searchSettings('color')
    expect(resolveSettingsCategory('overlay', colors)).toBe('overlay')
    expect(resolveSettingsCategory('general', colors)).toBe('general')
    expect(ids('custom palette')).toEqual(['appearance'])
    expect(ids('color mode')).toEqual(['appearance'])
    expect(ids('ocean')).toEqual(['appearance'])
    expect(ids('catppuccin macchiato')).toEqual(['appearance'])
    expect(ids('synthwave')).toEqual(['appearance'])
    expect(resolveSettingsCategory('general', searchSettings('Azure'))).toBe('translation')
    expect(resolveSettingsCategory('general', searchSettings(''))).toBe('general')
  })
})

describe('lazy settings editors', () => {
  test('first open mounts only General; searching all categories alone does not mount other bodies', () => {
    const initial = visibleSettingsSections('general', searchSettings(''))
    const mounted = retainMountedSettingsSections(new Set(), initial)
    expect([...mounted]).toEqual(['appearance', 'updates'])
    expect(mounted.has('translation')).toBe(false)
    expect(searchSettings('').sections).toEqual(SETTINGS_SECTIONS)
    expect([...mounted]).toEqual(['appearance', 'updates'])
  })
  test('visited editor identities are retained across category changes and no-result searches', () => {
    const general = retainMountedSettingsSections(
      new Set(),
      visibleSettingsSections('general', searchSettings('')),
    )
    const translating = retainMountedSettingsSections(
      general,
      visibleSettingsSections('translation', searchSettings('Azure')),
    )
    expect([...translating]).toEqual(['appearance', 'updates', 'translation'])
    const empty = retainMountedSettingsSections(translating, [])
    expect(empty).toBe(translating)
    const back = retainMountedSettingsSections(
      empty,
      visibleSettingsSections('general', searchSettings('')),
    )
    expect(back).toBe(translating)
    expect(back.has('translation')).toBe(true)
  })
  test('every section is found by its translated title in either language', () => {
    for (const section of SETTINGS_SECTIONS)
      for (const language of ['en', 'ru'] satisfies Language[]) {
        const title = translatorFor(language)(`settings.section.${section.id}`)
        expect(searchSettings(title).sections.map((match) => match.id)).toContain(section.id)
      }
  })
  test('keyboard category traversal wraps, handles filtered sets and safely handles no results', () => {
    expect(stepSettingsCategory(['general', 'chat', 'overlay'], 'general', -1)).toBe('overlay')
    expect(stepSettingsCategory(['general', 'chat', 'overlay'], 'overlay', 1)).toBe('general')
    expect(stepSettingsCategory(['translation'], 'general', 1)).toBe('translation')
    expect(stepSettingsCategory([], 'general', 1)).toBeNull()
  })
})
