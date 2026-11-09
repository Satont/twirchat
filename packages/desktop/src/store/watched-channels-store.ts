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
  account_id: string | null
}

function rowToWatchedChannel(row: WatchedChannelRow): WatchedChannel {
  return {
    channelSlug: row.channel_slug,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    platform: platformSchema.parse(row.platform),
    ...(row.account_id ? { accountId: row.account_id } : {}),
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

  findByPlatformAndSlug(platform: WatchedChannel['platform'], channelSlug: string) {
    const row = getDb()
      .query<WatchedChannelRow, [string, string]>(
        'SELECT * FROM watched_channels WHERE platform = ? AND channel_slug = ?',
      )
      .get(platform, platform === 'youtube' ? channelSlug.trim() : channelSlug.toLowerCase())
    return row ? rowToWatchedChannel(row) : null
  },

  /** Binds a chat to a saved account; `null` returns it to the platform's default account. */
  setAccount(id: string, accountId: string | null): void {
    getDb().prepare('UPDATE watched_channels SET account_id = ? WHERE id = ?').run(accountId, id)
  },

  /** Returns chats bound to a forgotten account to the default account and lists them. */
  releaseAccount(accountId: string): string[] {
    const db = getDb()
    const ids = db
      .query<{ id: string }, [string]>('SELECT id FROM watched_channels WHERE account_id = ?')
      .all(accountId)
      .map((row) => row.id)
    db.prepare('UPDATE watched_channels SET account_id = NULL WHERE account_id = ?').run(accountId)
    return ids
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
