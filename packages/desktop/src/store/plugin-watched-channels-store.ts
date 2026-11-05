import { z } from 'zod'

import { sanitizeDisplayText } from '../views/shared/utils/display-text'
import {
  pluginPlatformSchema,
  type PluginPlatform,
  type PluginWatchedChannel,
} from '../watched-channels/plugin-channel-types'
import { getDb } from './db'

const rowSchema = z.object({
  id: z.string(),
  platform: pluginPlatformSchema,
  channel_slug: z.string(),
  transport_name: z.string(),
  created_at: z.number(),
})

function toChannel(value: unknown): PluginWatchedChannel {
  const row = rowSchema.parse(value)
  return {
    kind: 'plugin',
    id: row.id,
    platform: row.platform,
    channelSlug: row.channel_slug,
    displayName: sanitizeDisplayText(row.channel_slug),
    transportName: sanitizeDisplayText(row.transport_name),
    createdAt: row.created_at,
  }
}

export const PluginWatchedChannelsStore = {
  findAll(): PluginWatchedChannel[] {
    return getDb()
      .query('SELECT * FROM plugin_watched_channels ORDER BY created_at ASC, rowid ASC')
      .all()
      .map(toChannel)
  },

  has(id: string): boolean {
    return getDb().query('SELECT 1 FROM plugin_watched_channels WHERE id = ?').get(id) !== null
  },

  upsert(params: {
    platform: PluginPlatform
    channelSlug: string
    transportName: string
  }): PluginWatchedChannel {
    const { platform, channelSlug, transportName } = params
    return toChannel(
      getDb()
        .query(
          `INSERT INTO plugin_watched_channels (id, platform, channel_slug, transport_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (platform, channel_slug) DO UPDATE SET transport_name = excluded.transport_name
           RETURNING *`,
        )
        .get(crypto.randomUUID(), platform, channelSlug, transportName),
    )
  },

  remove(id: string): void {
    getDb().run('DELETE FROM plugin_watched_channels WHERE id = ?', [id])
  },
}
