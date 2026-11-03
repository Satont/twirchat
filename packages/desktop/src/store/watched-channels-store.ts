import { randomUUID } from 'node:crypto'

import type { WatchedChannel } from '@twirchat/shared/types'

import { platformSchema } from '../services/persisted-schemas'
import { getDb } from './db'

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
    platform: platformSchema.parse(row.platform),
  }
}

export const WatchedChannelStore = {
  findAll(): WatchedChannel[] {
    const db = getDb()
    const rows = db
      .query<WatchedChannelRow, []>('SELECT * FROM watched_channels ORDER BY created_at ASC')
      .all()
    return rows.map(rowToWatchedChannel)
  },

  findById(id: string): WatchedChannel | null {
    const db = getDb()
    const row = db
      .query<WatchedChannelRow, [string]>('SELECT * FROM watched_channels WHERE id = ?')
      .get(id)
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
      platform === 'youtube' ? channelSlug.trim() : channelSlug.toLowerCase(),
    )
  },

  upsert(
    platform: WatchedChannel['platform'],
    channelSlug: string,
    displayName: string,
  ): WatchedChannel {
    const db = getDb()
    const slug = platform === 'youtube' ? channelSlug.trim() : channelSlug.toLowerCase()

    // Check if already exists
    const existing = db
      .query<WatchedChannelRow, [string, string]>(
        'SELECT * FROM watched_channels WHERE platform = ? AND channel_slug = ?',
      )
      .get(platform, slug)

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
