import type { TwitchBadgesResponse } from '@twirchat/shared'
/**
 * GET /api/twitch/badges?broadcasterLogin=<login>[&scope=channel]
 *
 * Twitch chat badges from Helix via the app access token (no user login required), keyed by
 * "setId/version" with image URLs, titles and descriptions. Without `scope` the response merges
 * global and channel badges; `scope=channel` returns only the channel's own badges so clients can
 * keep the global catalog once instead of once per channel.
 */
import { logger } from '@twirchat/shared/logger'
import type { z } from 'zod'

import { createStaleCache } from './stale-cache.ts'
import { fetchTwitchHelixWithAppToken } from './stream-status.ts'
import { helixBadgesSchema, mergeHelixBadges } from './twitch-badge-data'
import { normalizeTwitchLogin, resolveTwitchUserIdsByLogin } from './twitch-users.ts'

const log = logger('twitch-badges')

type HelixBadges = z.infer<typeof helixBadgesSchema>

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

async function fetchHelixBadges(url: string): Promise<HelixBadges> {
  const response = await fetchTwitchHelixWithAppToken(url)
  if (!response.ok) throw new Error(`Helix badges failed: ${response.status}`)
  return helixBadgesSchema.parse(await response.json())
}

const countVersions = (badges: HelixBadges) =>
  badges.data.reduce((total, set) => total + set.versions.length, 0)

const globalBadges = createStaleCache({
  name: 'twitch-global-badges',
  ttlMs: 60 * 60 * 1000,
  retryMs: 60 * 1000,
  maxEntries: 1,
  async load() {
    const badges = await fetchHelixBadges('https://api.twitch.tv/helix/chat/badges/global')
    log.info('Global badges fetched', { count: countVersions(badges) })
    return badges
  },
})

const channelBadges = createStaleCache({
  name: 'twitch-channel-badges',
  ttlMs: 10 * 60 * 1000,
  retryMs: 60 * 1000,
  maxEntries: 1024,
  async load(login) {
    // An all-digit login is still a login here, so skip resolveTwitchUserId's user-id shortcut.
    const broadcasterId = (await resolveTwitchUserIdsByLogin([login])).get(login)
    if (!broadcasterId) return { data: [] }
    const badges = await fetchHelixBadges(
      `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    )
    log.info('Channel badges fetched', { channel: login, count: countVersions(badges) })
    return badges
  },
})

const emptyResponse = (): Required<TwitchBadgesResponse> => ({ badges: {}, badgeMetadata: {} })

export class TwitchBadgesRequestError extends Error {}

export async function handleTwitchBadges(url: URL): Promise<TwitchBadgesResponse> {
  const rawLogin = url.searchParams.get('broadcasterLogin')
  const login = rawLogin === null ? null : normalizeTwitchLogin(rawLogin)
  const result = emptyResponse()

  if (url.searchParams.get('scope') === 'channel') {
    if (!login)
      throw new TwitchBadgesRequestError('scope=channel requires a valid broadcasterLogin')
    mergeHelixBadges(result, await channelBadges.get(login))
    return result
  }

  mergeHelixBadges(result, await globalBadges.get('global'))
  if (login) {
    try {
      mergeHelixBadges(result, await channelBadges.get(login))
    } catch (error) {
      // Older clients ask for the merged catalog; global badges alone are still useful to them.
      log.warn('Channel badges unavailable', { channel: login, error: String(error) })
    }
  }
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
  const rawLogin = url.searchParams.get('broadcasterLogin')
  const login = rawLogin === null ? null : normalizeTwitchLogin(rawLogin)
  const result = emptyResponse()
  const userSets = (badges: HelixBadges): HelixBadges => ({
    data: badges.data.filter((set) => USER_BADGE_SETS.has(set.set_id)),
  })

  mergeHelixBadges(result, userSets(await globalBadges.get('global')))
  if (login) {
    try {
      mergeHelixBadges(result, userSets(await channelBadges.get(login)))
    } catch (error) {
      log.warn('Channel badges unavailable', { channel: login, error: String(error) })
    }
  }
  return result
}
