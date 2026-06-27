import { getDb } from './db'
import type { Platform } from '@twirchat/shared/types'

export const ChannelStore = {
  /** Persist a joined channel */
  save(platform: Platform, channelSlug: string): void {
    const db = getDb()
    db.prepare(
      `INSERT OR IGNORE INTO channel_connections (platform, channel_slug) VALUES (?, ?)`,
    ).run(platform, channelSlug.toLowerCase())
  },

  /** Remove a channel */
  remove(platform: Platform, channelSlug: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM channel_connections WHERE platform = ? AND channel_slug = ?`).run(
      platform,
      channelSlug.toLowerCase(),
    )
  },

  /** Get all saved channels for a platform */
  findByPlatform(platform: Platform): string[] {
    const db = getDb()
    return (
      db
        .prepare(
          `SELECT channel_slug FROM channel_connections WHERE platform = ? ORDER BY channel_slug`,
        )
        .all(platform) as { channel_slug: string }[]
    ).map((r) => r.channel_slug)
  },

  /** Get all saved channels grouped by platform */
  findAll(): Partial<Record<Platform, string[]>> {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT platform, channel_slug FROM channel_connections ORDER BY platform, channel_slug`,
      )
      .all() as { platform: string; channel_slug: string }[]

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
