import { getDb } from './db'
import type { AppSettings } from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { deepMerge } from './utils'

export const SettingsStore = {
  get(): AppSettings {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings') as
      | { value: string }
      | undefined

    if (!row) return { ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }

    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>
      return deepMerge({ ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }, parsed)
    } catch {
      return { ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }
    }
  },

  set(settings: AppSettings): void {
    const db = getDb()
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run('app_settings', JSON.stringify(settings))
  },

  update(partial: Partial<AppSettings>): AppSettings {
    const current = this.get()
    const updated = deepMerge(current, partial)
    const db = getDb()
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run('app_settings', JSON.stringify(updated))
    return updated
  },
}
