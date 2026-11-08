/**
 * Last successfully fetched GitHub release notes, cached in the settings KV
 * table. A single entry keeps the cache bounded: notes are only needed for the
 * version the app is currently running.
 */

import { z } from 'zod'

import { getDb } from '../../store/db'

const CACHE_KEY = 'gpuix_release_notes_cache'

const cachedReleaseNotesSchema = z.object({
  version: z.string(),
  releaseNotes: z.string(),
  publishedAt: z.string(),
  htmlUrl: z.string(),
})

export type CachedReleaseNotes = z.infer<typeof cachedReleaseNotesSchema>

export function readCachedReleaseNotes(version: string): CachedReleaseNotes | null {
  const row = getDb()
    .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
    .get(CACHE_KEY)
  if (!row) return null

  try {
    const parsed = cachedReleaseNotesSchema.safeParse(JSON.parse(row.value))
    if (!parsed.success || parsed.data.version !== version) return null
    return parsed.data
  } catch {
    return null
  }
}

export function writeCachedReleaseNotes(notes: CachedReleaseNotes): void {
  getDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [CACHE_KEY, JSON.stringify(notes)],
  )
}
