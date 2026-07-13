import { getDb } from './db'
import type { Platform } from '@twirchat/shared/types'

export const ChannelStore = {
  /** Persist a joined channel */
  save(platform: Platform, channelSlug: string): void {
    const db = getDb()
    db.run(`INSERT OR IGNORE INTO channel_connections (platform, channel_slug) VALUES (?, ?)`, [
      platform,
      channelSlug.toLowerCase(),
    ])
  },

  /** Remove a channel */
  remove(platform: Platform, channelSlug: string): void {
    const db = getDb()
    db.run(`DELETE FROM channel_connections WHERE platform = ? AND channel_slug = ?`, [
      platform,
      channelSlug.toLowerCase(),
    ])
  },

  /** Get all saved channels for a platform */
  findByPlatform(platform: Platform): string[] {
    const db = getDb()
    return db
      .query<{ channel_slug: string }, [string]>(
        `SELECT channel_slug FROM channel_connections WHERE platform = ? ORDER BY channel_slug`,
      )
      .all(platform)
      .map((r) => r.channel_slug)
  },

  /** Get all saved channels grouped by platform */
  findAll(): Partial<Record<Platform, string[]>> {
    const db = getDb()
    const rows = db
      .query<{ platform: string; channel_slug: string }, []>(
        `SELECT platform, channel_slug FROM channel_connections ORDER BY platform, channel_slug`,
      )
      .all()

    const result: Partial<Record<Platform, string[]>> = {}
    for (const row of rows) {
      const p = row.platform as Platform
      if (!result[p]) {
        result[p] = []
      }
      result[p]!.push(row.channel_slug)
    }
    return result
  },
}
