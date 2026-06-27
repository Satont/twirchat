import { getDb } from './db'
import type { ChatLayout } from '../../../shared/types.ts'
import { deepMerge } from './utils'

const DEFAULT_LAYOUT: ChatLayout = {
  version: 1,
  mode: 'combined',
  splits: [{ id: 'default', type: 'combined', size: 100 }],
}

export const ChatLayoutStore = {
  get(): ChatLayout {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('chat_layout') as
      | { value: string }
      | undefined

    if (!row) return { ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }

    try {
      const parsed = JSON.parse(row.value) as Partial<ChatLayout>
      return deepMerge({ ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }, parsed)
    } catch {
      return { ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }
    }
  },

  set(layout: ChatLayout): void {
    const db = getDb()
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run('chat_layout', JSON.stringify(layout))
  },

  update(partial: Partial<ChatLayout>): ChatLayout {
    const current = this.get()
    const updated = deepMerge(current, partial)
    const db = getDb()
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run('chat_layout', JSON.stringify(updated))
    return updated
  },
}
