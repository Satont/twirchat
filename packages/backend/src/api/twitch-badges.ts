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

// Badge sets to include for user card (global + role badges, exclude subscriber tiers)
const USER_BADGE_SETS = new Set([
  'staff',
  'admin',
  'global_mod',
  'turbo',
  'premium',
  'partner',
  'founder',
  'bits',
  'sub_gifter',
  'sub_gift_leader',
  'broadcaster',
  'moderator',
  'vip',
])

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

/**
 * GET /api/twitch/user-badges?broadcasterLogin=<login>
 *
 * Returns filtered badge catalog for user card display:
 * - Global badges (staff, admin, global_mod, turbo, partner, bits, etc.)
 * - Role badges for the channel (broadcaster, moderator, vip)
 * - Excludes subscriber tiers and other channel-specific cosmetic badges
 */
export async function handleTwitchUserBadges(url: URL): Promise<TwitchBadgesResponse> {
  const broadcasterLogin = url.searchParams.get('broadcasterLogin')

  const result: Required<TwitchBadgesResponse> = { badges: {}, badgeMetadata: {} }

  // 1. Global badges - filter to user badge sets
  const globalRes = await fetchTwitchHelixWithAppToken(
    'https://api.twitch.tv/helix/chat/badges/global',
  )
  if (!globalRes.ok) {
    throw new Error(`Helix global badges failed: ${globalRes.status}`)
  }
  const globalBody = helixBadgesSchema.parse(await globalRes.json())
  for (const set of globalBody.data) {
    if (USER_BADGE_SETS.has(set.set_id)) {
      mergeHelixBadges(result, { data: [set] })
    }
  }

  // 2. Channel-specific badges - only role badges (broadcaster, moderator, vip)
  if (broadcasterLogin) {
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
          for (const set of chanBody.data) {
            if (USER_BADGE_SETS.has(set.set_id)) {
              mergeHelixBadges(result, { data: [set] })
            }
          }
        }
      }
    }
  }

  log.info('User badge catalog ready', {
    channel: broadcasterLogin ?? 'global-only',
    total: Object.keys(result.badges).length,
  })
  return result
}
