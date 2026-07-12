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
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get('chat_layout')

    if (!row) return { ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }

    try {
      const parsed = JSON.parse(row.value) as Partial<ChatLayout>
      // Deep-merge with defaults so new fields added after the layout was saved
      // don't come back as undefined.
      return deepMerge({ ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }, parsed)
    } catch {
      return { ...DEFAULT_LAYOUT, splits: [...DEFAULT_LAYOUT.splits] }
    }
  },

  set(layout: ChatLayout): void {
    const db = getDb()
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['chat_layout', JSON.stringify(layout)],
    )
  },

  update(partial: Partial<ChatLayout>): ChatLayout {
    const current = this.get()
    const updated = deepMerge(current, partial)
    const db = getDb()
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['chat_layout', JSON.stringify(updated)],
    )
    return updated
  },
}
