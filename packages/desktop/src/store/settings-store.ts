import { getDb } from './db'
import type { AppSettings } from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { deepMerge } from './utils'

export const SettingsStore = {
  get(): AppSettings {
    const db = getDb()
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get('app_settings')

    if (!row) return { ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }

    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>
      // Deep-merge with defaults so new fields added after the settings were saved
      // don't come back as undefined.
      return deepMerge({ ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }, parsed)
    } catch {
      return { ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay } }
    }
  },

  set(settings: AppSettings): void {
    const db = getDb()
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['app_settings', JSON.stringify(settings)],
    )
  },

  update(partial: Partial<AppSettings>): AppSettings {
    const current = this.get()
    const updated = deepMerge(current, partial)
    const db = getDb()
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['app_settings', JSON.stringify(updated)],
    )
    return updated
  },
}
