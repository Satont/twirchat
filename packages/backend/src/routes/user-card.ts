import { fetchUserCardMetadata } from '../api/user-card-metadata.ts'
import { json, requireClient } from './utils.ts'
import { logger } from '@twirchat/shared/logger'

const log = logger('user-card-route')

export const userCardRoutes = {
  '/api/user-card-metadata': {
    async GET(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth

      try {
        const url = new URL(req.url)
        const platform = url.searchParams.get('platform')
        const platformUserId = url.searchParams.get('platformUserId')
        const channelId = url.searchParams.get('channelId') ?? undefined

        if ((platform !== 'twitch' && platform !== 'kick') || !platformUserId) {
          return json({ error: 'platform=twitch|kick and platformUserId are required' }, 400)
        }

        return json(
          await fetchUserCardMetadata(auth.clientSecret, platform, platformUserId, channelId),
        )
      } catch (err) {
        log.error('user-card-metadata failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
} as const
