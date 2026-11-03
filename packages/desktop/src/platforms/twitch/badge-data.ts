import type { Badge, TwitchBadgesResponse } from '@twirchat/shared/types'
import { z } from 'zod'

const twitchBadgesResponseSchema: z.ZodType<TwitchBadgesResponse> = z.object({
  badges: z.record(z.string(), z.string()),
  badgeMetadata: z
    .record(z.string(), z.object({ title: z.string(), description: z.string() }))
    .optional(),
})

export function parseTwitchBadgeCatalog(value: unknown): Map<string, Badge> {
  const catalog = twitchBadgesResponseSchema.parse(value)
  return new Map(
    Object.entries(catalog.badges).map(([id, imageUrl]) => {
      const type = id.split('/')[0] ?? id
      const metadata = catalog.badgeMetadata?.[id]
      const badge: Badge = {
        id,
        type,
        text: metadata?.title || type,
        imageUrl,
        ...(metadata?.description ? { description: metadata.description } : {}),
      }
      return [id, badge]
    }),
  )
}
