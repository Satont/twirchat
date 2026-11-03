import type { TwitchBadgesResponse } from '@twirchat/shared/types'
import { z } from 'zod'

export const helixBadgesSchema = z.object({
  data: z.array(
    z.object({
      set_id: z.string(),
      versions: z.array(
        z.object({
          id: z.string(),
          image_url_1x: z.string(),
          title: z.string(),
          description: z.string(),
        }),
      ),
    }),
  ),
})

export function mergeHelixBadges(
  result: Required<TwitchBadgesResponse>,
  body: z.infer<typeof helixBadgesSchema>,
): void {
  for (const set of body.data) {
    for (const version of set.versions) {
      const id = `${set.set_id}/${version.id}`
      result.badges[id] = version.image_url_1x
      result.badgeMetadata[id] = { title: version.title, description: version.description }
    }
  }
}
