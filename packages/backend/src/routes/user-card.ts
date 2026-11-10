import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { fetchUserCardMetadata } from '../api/user-card-metadata.ts'
import { json, requireClient } from './utils.ts'

const log = logger('user-card-route')

export const userCardRoutes = {
  '/api/user-card-metadata': {
    async POST(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth

      try {
        const body = z
          .object({
            platform: z.enum(['twitch', 'kick']),
            platformUserId: z.string(),
            username: z.string().optional(),
            channelId: z.string().optional(),
            channelSlug: z.string().optional(),
          })
          .parse(await req.json())
        const { platform, platformUserId } = body

        if ((platform !== 'twitch' && platform !== 'kick') || !platformUserId) {
          return json({ error: 'platform=twitch|kick and platformUserId are required' }, 400)
        }

        return json(await fetchUserCardMetadata(body))
      } catch (err) {
        log.error('user-card-metadata failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
}
