/**
 * POST /api/channels-status
 *
 * Bulk fetch of stream status for multiple channels across platforms.
 * All platform fetches run in parallel for minimal latency.
 *
 * Body: { channels: ChannelStatusRequest[] }
 *
 * For Twitch:
 *   - If userAccessToken is provided → use it (authenticated user context)
 *   - Otherwise → use app access token (client_credentials, anonymous)
 *   - Batches all Twitch logins into a single /helix/streams call
 *
 * For Kick:
 *   - Always uses app token (no user context needed for public channel info)
 *   - One request per channel (Kick API doesn't support bulk slug lookup)
 */

import { config } from '../config.ts'
import { getKickAppToken, getTwitchAppToken } from './stream-status.ts'
import { logger } from '@twirchat/shared/logger'
import type { ChannelStatus, ChannelStatusRequest, ChannelsStatusResponse } from '@twirchat/shared'

const log = logger('channels-status')

// ----------------------------------------------------------------
// Twitch bulk fetch
// ----------------------------------------------------------------

interface HelixUser {
  id: string
  login: string
}

interface HelixStream {
  user_id: string
  user_login: string
  title: string
  game_name: string
  viewer_count: number
}

interface HelixChannel {
  broadcaster_id: string
  broadcaster_login: string
  title: string
  game_name: string
}

async function fetchTwitchChannelsStatus(
  channels: ChannelStatusRequest[],
): Promise<ChannelStatus[]> {
  if (channels.length === 0) {
    return []
  }

  const logins = channels.map((c) => c.channelLogin.toLowerCase())

  // Prefer user token from first channel that has one. Fall back to app token.
  const userToken = channels.find((c) => c.userAccessToken)?.userAccessToken
  const token = userToken ?? (await getTwitchAppToken())

  const headers = {
    Authorization: `Bearer ${token}`,
    'Client-Id': config.TWITCH_CLIENT_ID,
  }

  const loginToId = new Map<string, string>()
  for (const ch of channels) {
    if (ch.channelId) {
      loginToId.set(ch.channelLogin.toLowerCase(), ch.channelId)
    }
  }

  const loginsNeedingResolution = logins.filter((l) => !loginToId.has(l))
  if (loginsNeedingResolution.length > 0) {
    const userParams = loginsNeedingResolution
      .map((l) => `login=${encodeURIComponent(l)}`)
      .join('&')
    const usersRes = await fetch(`https://api.twitch.tv/helix/users?${userParams}`, { headers })
    if (!usersRes.ok) {
      const body = await usersRes.text()
      log.warn('Twitch /helix/users failed', { body, status: usersRes.status })
      return logins.map((login) => ({
        channelLogin: login,
        isLive: false,
        platform: 'twitch' as const,
        title: '',
      }))
    }
    const usersBody = (await usersRes.json()) as { data: HelixUser[] }
    for (const u of usersBody.data) {
      loginToId.set(u.login.toLowerCase(), u.id)
    }
  }

  const broadcasterIds = logins.map((l) => loginToId.get(l)).filter(Boolean) as string[]
  if (broadcasterIds.length === 0) {
    return logins.map((login) => ({
      channelLogin: login,
      isLive: false,
      platform: 'twitch' as const,
      title: '',
    }))
  }

  const loginParams = logins.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')
  const idParams = broadcasterIds.map((id) => `broadcaster_id=${encodeURIComponent(id)}`).join('&')

  const [streamsRes, channelsRes] = await Promise.all([
    fetch(`https://api.twitch.tv/helix/streams?${loginParams}&first=100`, { headers }),
    fetch(`https://api.twitch.tv/helix/channels?${idParams}`, { headers }),
  ])

  const liveMap = new Map<string, HelixStream>()
  const offlineMap = new Map<string, HelixChannel>()

  if (streamsRes.ok) {
    const body = (await streamsRes.json()) as { data: HelixStream[] }
    for (const s of body.data) {
      liveMap.set(s.user_login.toLowerCase(), s)
    }
  } else {
    const body = await streamsRes.text()
    log.warn('Twitch /helix/streams failed', { body, status: streamsRes.status })
  }

  if (channelsRes.ok) {
    const body = (await channelsRes.json()) as { data: HelixChannel[] }
    for (const c of body.data) {
      offlineMap.set(c.broadcaster_login.toLowerCase(), c)
    }
  } else {
    const body = await channelsRes.text()
    log.warn('Twitch /helix/channels failed', { body, status: channelsRes.status })
  }

  return logins.map((login) => {
    const live = liveMap.get(login)
    if (live) {
      return {
        categoryName: live.game_name || undefined,
        channelLogin: login,
        isLive: true,
        platform: 'twitch' as const,
        title: live.title,
        viewerCount: live.viewer_count,
      }
    }
    const offline = offlineMap.get(login)
    return {
      categoryName: offline?.game_name || undefined,
      channelLogin: login,
      isLive: false,
      platform: 'twitch' as const,
      title: offline?.title ?? '',
    }
  })
}

// ----------------------------------------------------------------
// Kick — one request per channel (no bulk API)
// ----------------------------------------------------------------

async function fetchKickChannelStatus(channel: ChannelStatusRequest): Promise<ChannelStatus> {
  const token = await getKickAppToken()

  const res = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channel.channelLogin)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-ID': config.KICK_CLIENT_ID,
      },
    },
  )

  if (!res.ok) {
    log.warn('Kick channel fetch failed', { channel: channel.channelLogin, status: res.status })
    return {
      channelLogin: channel.channelLogin,
      isLive: false,
      platform: 'kick',
      title: '',
    }
  }

  const body = (await res.json()) as {
    data?: {
      stream_title?: string
      stream?: { is_live?: boolean; viewer_count?: number }
      category?: { name?: string }
    }[]
  }

  const ch = body.data?.[0]
  if (!ch) {
    return { channelLogin: channel.channelLogin, isLive: false, platform: 'kick', title: '' }
  }

  return {
    categoryName: ch.category?.name,
    channelLogin: channel.channelLogin,
    isLive: ch.stream?.is_live ?? false,
    platform: 'kick',
    title: ch.stream_title ?? '',
    viewerCount: ch.stream?.viewer_count,
  }
}

// ----------------------------------------------------------------
// Public handler
// ----------------------------------------------------------------

export async function handleChannelsStatus(req: Request): Promise<ChannelsStatusResponse> {
  const body = (await req.json()) as { channels?: ChannelStatusRequest[] }
  const channels = body.channels ?? []

  if (channels.length === 0) {
    return { channels: [] }
  }

  // Split by platform
  const twitchChannels = channels.filter((c) => c.platform === 'twitch')
  const kickChannels = channels.filter((c) => c.platform === 'kick')

  // Run platform groups in parallel; within Kick run each channel in parallel too
  const [twitchResults, kickResults] = await Promise.all([
    fetchTwitchChannelsStatus(twitchChannels),
    Promise.all(kickChannels.map(fetchKickChannelStatus)),
  ])

  const result = [...twitchResults, ...kickResults]
  log.debug('Channels status fetched', { count: result.length })

  return { channels: result }
}
