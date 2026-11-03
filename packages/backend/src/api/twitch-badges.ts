import type { TwitchBadgesResponse } from '@twirchat/shared'
/**
 * GET /api/twitch/badges?broadcasterLogin=<login>
 *
 * Fetches global Twitch chat badges + channel-specific badges via Helix API
 * using the app access token (no user login required).
 *
 * Returns image URLs and titles/descriptions keyed by "setId/version".
 */
import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { fetchTwitchHelixWithAppToken } from './stream-status.ts'
import { helixBadgesSchema, mergeHelixBadges } from './twitch-badge-data'

const log = logger('twitch-badges')

export async function handleTwitchBadges(url: URL): Promise<TwitchBadgesResponse> {
  const broadcasterLogin = url.searchParams.get('broadcasterLogin')

  const result: Required<TwitchBadgesResponse> = { badges: {}, badgeMetadata: {} }

  // 1. Global badges
  const globalRes = await fetchTwitchHelixWithAppToken(
    'https://api.twitch.tv/helix/chat/badges/global',
  )
  if (!globalRes.ok) {
    throw new Error(`Helix global badges failed: ${globalRes.status}`)
  }
  const globalBody = helixBadgesSchema.parse(await globalRes.json())
  mergeHelixBadges(result, globalBody)
  log.info('Global badges fetched', {
    count: globalBody.data.reduce((n, s) => n + s.versions.length, 0),
  })

  // 2. Channel-specific badges (subscriber tiers, bits, custom, etc.)
  if (broadcasterLogin) {
    // Resolve login → broadcaster_id
    const userRes = await fetchTwitchHelixWithAppToken(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(broadcasterLogin)}`,
    )
    if (userRes.ok) {
      const userData = z
        .object({ data: z.array(z.object({ id: z.string() })) })
        .parse(await userRes.json())
      const broadcasterId = userData.data[0]?.id
      if (broadcasterId) {
        const chanRes = await fetchTwitchHelixWithAppToken(
          `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`,
        )
        if (chanRes.ok) {
          const chanBody = helixBadgesSchema.parse(await chanRes.json())
          mergeHelixBadges(result, chanBody)
          log.info('Channel badges fetched', {
            channel: broadcasterLogin,
            count: chanBody.data.reduce((n, s) => n + s.versions.length, 0),
          })
        }
      }
    }
  }

  log.info('Badge cache ready', {
    channel: broadcasterLogin ?? 'global-only',
    total: Object.keys(result.badges).length,
  })
  return result
}
