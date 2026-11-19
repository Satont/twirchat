import type { Database } from 'bun:sqlite'

import {
  GLOBAL_TWITCH_BADGE_SCOPE,
  type StoredTwitchBadgeCatalog,
  type TwitchBadgeCatalogStorage,
} from '../platforms/twitch/badge-catalog'
import { getDb } from './db'

interface CatalogRow {
  payload: string
  fetched_at: number
}

const MAX_STORED_CHANNELS = 128

export function createTwitchBadgeCatalogStore(db: Database = getDb()): TwitchBadgeCatalogStorage {
  const select = db.query<CatalogRow, [string]>(
    'SELECT payload, fetched_at FROM twitch_badge_catalogs WHERE scope = ?',
  )
  const upsert = db.query<unknown, [string, string, number]>(
    `INSERT INTO twitch_badge_catalogs (scope, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  )
  const prune = db.query<unknown, [string, string, number]>(
    `DELETE FROM twitch_badge_catalogs WHERE scope != ? AND scope NOT IN (
       SELECT scope FROM twitch_badge_catalogs WHERE scope != ? ORDER BY fetched_at DESC LIMIT ?
     )`,
  )

  return {
    read(scope): StoredTwitchBadgeCatalog | undefined {
      const row = select.get(scope)
      if (!row || !Number.isSafeInteger(row.fetched_at)) return undefined
      return { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at }
    },
    write(scope, payload, fetchedAt) {
      upsert.run(scope, JSON.stringify(payload), fetchedAt)
      prune.run(GLOBAL_TWITCH_BADGE_SCOPE, GLOBAL_TWITCH_BADGE_SCOPE, MAX_STORED_CHANNELS)
    },
  }
}
