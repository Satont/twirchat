import { getDb } from './db'
import type { WatchedChannel } from '@twirchat/shared/types'
import { randomUUID } from 'node:crypto'

interface WatchedChannelRow {
  id: string
  platform: string
  channel_slug: string
  display_name: string
  created_at: number
}

function rowToWatchedChannel(row: WatchedChannelRow): WatchedChannel {
  return {
    channelSlug: row.channel_slug,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    platform: row.platform as WatchedChannel['platform'],
  }
}

export const WatchedChannelStore = {
  findAll(): WatchedChannel[] {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM watched_channels ORDER BY created_at ASC')
      .all() as WatchedChannelRow[]
    return rows.map(rowToWatchedChannel)
  },

  findById(id: string): WatchedChannel | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM watched_channels WHERE id = ?').get(id) as
      | WatchedChannelRow
      | undefined
    return row ? rowToWatchedChannel(row) : null
  },

  remove(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM watched_channels WHERE id = ?').run(id)
  },

  removeByPlatformAndSlug(platform: string, channelSlug: string): void {
    const db = getDb()
    db.prepare('DELETE FROM watched_channels WHERE platform = ? AND channel_slug = ?').run(
      platform,
      channelSlug.toLowerCase(),
    )
  },

  upsert(
    platform: WatchedChannel['platform'],
    channelSlug: string,
    displayName: string,
  ): WatchedChannel {
    const db = getDb()
    const slug = channelSlug.toLowerCase()

    // Check if already exists
    const existing = db
      .prepare('SELECT * FROM watched_channels WHERE platform = ? AND channel_slug = ?')
      .get(platform, slug) as WatchedChannelRow | undefined

    if (existing) {
      // Update displayName in case it changed
      db.prepare('UPDATE watched_channels SET display_name = ? WHERE id = ?').run(
        displayName,
        existing.id,
      )
      return rowToWatchedChannel({ ...existing, display_name: displayName })
    }

    const id = randomUUID()
    db.prepare(
      'INSERT INTO watched_channels (id, platform, channel_slug, display_name) VALUES (?, ?, ?, ?)',
    ).run(id, platform, slug, displayName)

    return {
      id,
      platform,
      channelSlug: slug,
      displayName,
      createdAt: Math.floor(Date.now() / 1000),
    }
  },
}
