import { getDb } from './db'

export interface WindowState {
  height: number
  width: number
  x: number
  y: number
}

const KEY = 'window_state'
const MIN_WIDTH = 200
const MIN_HEIGHT = 200

function isValidState(state: Partial<WindowState>): state is WindowState {
  return (
    typeof state.x === 'number' &&
    typeof state.y === 'number' &&
    typeof state.width === 'number' &&
    typeof state.height === 'number' &&
    Number.isFinite(state.x) &&
    Number.isFinite(state.y) &&
    state.width >= MIN_WIDTH &&
    state.height >= MIN_HEIGHT
  )
}

export const WindowStateStore = {
  get(): WindowState | null {
    const db = getDb()
    const row = db
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get(KEY)

    if (!row) return null

    try {
      const parsed = JSON.parse(row.value) as Partial<WindowState>
      return isValidState(parsed)
        ? { height: parsed.height, width: parsed.width, x: parsed.x, y: parsed.y }
        : null
    } catch {
      return null
    }
  },

  set(state: WindowState): void {
    const db = getDb()
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [KEY, JSON.stringify(state)],
    )
  },
}
