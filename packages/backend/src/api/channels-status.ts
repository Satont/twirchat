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
import { fetchTwitchHelixWithAppToken, getKickAppToken } from './stream-status.ts'
import {
  isTwitchUserId,
  normalizeTwitchLogin,
  resolveTwitchUserIdsByLogin,
} from './twitch-users.ts'
import { logger } from '@twirchat/shared/logger'
import type { ChannelStatus, ChannelStatusRequest, ChannelsStatusResponse } from '@twirchat/shared'

const log = logger('channels-status')
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const MAX_CHANNELS = 100
const MAX_CHANNEL_LOGIN_LENGTH = 100
const MAX_CHANNEL_ID_LENGTH = 128
const MAX_USER_ACCESS_TOKEN_LENGTH = 4096
const KICK_CHANNEL_FETCH_CONCURRENCY = 5
const MAX_UPSTREAM_LOG_BODY_LENGTH = 300
const textEncoder = new TextEncoder()

export class InvalidChannelsStatusRequestError extends Error {
  constructor(message: string) {
    super(`Invalid request: ${message}`)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'InvalidChannelsStatusRequestError'
  }
}

// ----------------------------------------------------------------
// Twitch bulk fetch
// ----------------------------------------------------------------

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

  const normalizedChannels = channels.map((channel) => {
    const normalizedLogin = normalizeTwitchLogin(channel.channelLogin)

    return {
      originalLogin: channel.channelLogin,
      normalizedLogin,
      normalizedChannelId: isTwitchUserId(channel.channelId) ? channel.channelId : undefined,
      request: channel,
    }
  })

  // Prefer user token from first channel that has one. Fall back to app token.
  const userToken = channels.find((c) => c.userAccessToken)?.userAccessToken
  const headers = userToken
    ? {
        Authorization: `Bearer ${userToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
      }
    : undefined

  const loginToId = new Map<string, string>()
  for (const channel of normalizedChannels) {
    if (channel.normalizedLogin && channel.normalizedChannelId) {
      loginToId.set(channel.normalizedLogin, channel.normalizedChannelId)
    }
  }

  const validLogins = normalizedChannels
    .map((channel) => channel.normalizedLogin)
    .filter((login): login is string => Boolean(login))
  const loginsNeedingResolution = validLogins.filter((login) => !loginToId.has(login))

  if (loginsNeedingResolution.length > 0) {
    try {
      const resolvedUsers = await resolveTwitchUserIdsByLogin(loginsNeedingResolution, userToken)
      for (const [login, id] of resolvedUsers) {
        loginToId.set(login, id)
      }
    } catch (error) {
      log.warn('Twitch /helix/users failed', { error: truncateUpstreamLogBody(String(error)) })
      return normalizedChannels.map((channel) => ({
        channelLogin: channel.normalizedLogin ?? channel.originalLogin.toLowerCase(),
        isLive: false,
        platform: 'twitch' as const,
        title: '',
      }))
    }
  }

  const broadcasterIds = [
    ...new Set(validLogins.map((login) => loginToId.get(login)).filter(Boolean)),
  ] as string[]
  if (broadcasterIds.length === 0) {
    return normalizedChannels.map((channel) => ({
      channelLogin: channel.normalizedLogin ?? channel.originalLogin.toLowerCase(),
      isLive: false,
      platform: 'twitch' as const,
      title: '',
    }))
  }

  const loginParams = validLogins
    .map((login) => `user_login=${encodeURIComponent(login)}`)
    .join('&')
  const idParams = broadcasterIds.map((id) => `broadcaster_id=${encodeURIComponent(id)}`).join('&')

  const [streamsRes, channelsRes] = await Promise.all(
    userToken
      ? [
          fetch(`https://api.twitch.tv/helix/streams?${loginParams}&first=100`, { headers }),
          fetch(`https://api.twitch.tv/helix/channels?${idParams}`, { headers }),
        ]
      : [
          fetchTwitchHelixWithAppToken(
            `https://api.twitch.tv/helix/streams?${loginParams}&first=100`,
          ),
          fetchTwitchHelixWithAppToken(`https://api.twitch.tv/helix/channels?${idParams}`),
        ],
  )

  const liveMap = new Map<string, HelixStream>()
  const offlineMap = new Map<string, HelixChannel>()

  if (streamsRes.ok) {
    const body = (await streamsRes.json()) as { data: HelixStream[] }
    for (const s of body.data) {
      liveMap.set(s.user_login.toLowerCase(), s)
    }
  } else {
    const body = await streamsRes.text()
    log.warn('Twitch /helix/streams failed', {
      body: truncateUpstreamLogBody(body),
      status: streamsRes.status,
    })
  }

  if (channelsRes.ok) {
    const body = (await channelsRes.json()) as { data: HelixChannel[] }
    for (const c of body.data) {
      offlineMap.set(c.broadcaster_login.toLowerCase(), c)
    }
  } else {
    const body = await channelsRes.text()
    log.warn('Twitch /helix/channels failed', {
      body: truncateUpstreamLogBody(body),
      status: channelsRes.status,
    })
  }

  return normalizedChannels.map((channel) => {
    const login = channel.normalizedLogin
    if (!login) {
      return {
        channelLogin: channel.originalLogin.toLowerCase(),
        isLive: false,
        platform: 'twitch' as const,
        title: '',
      }
    }

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

async function fetchKickChannelStatus(
  channel: ChannelStatusRequest,
  token: string,
): Promise<ChannelStatus> {
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

async function fetchKickChannelsStatus(channels: ChannelStatusRequest[]): Promise<ChannelStatus[]> {
  if (channels.length === 0) {
    return []
  }

  const token = await getKickAppToken()
  return mapWithConcurrency(channels, KICK_CHANNEL_FETCH_CONCURRENCY, (channel) =>
    fetchKickChannelStatus(channel, token),
  )
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<U>(items.length)
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    const currentIndex = nextIndex
    if (currentIndex >= items.length) {
      return
    }

    nextIndex += 1
    const currentItem = items[currentIndex] as T
    results[currentIndex] = await mapper(currentItem, currentIndex)
    await runWorker()
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runWorker)

  await Promise.all(workers)
  return results
}

function truncateUpstreamLogBody(body: string): string {
  return body.slice(0, MAX_UPSTREAM_LOG_BODY_LENGTH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseChannelsStatusBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get('Content-Length')
  if (contentLength) {
    const bodyBytes = Number(contentLength)
    if (!Number.isFinite(bodyBytes) || bodyBytes > MAX_REQUEST_BODY_BYTES) {
      throw new InvalidChannelsStatusRequestError('body is too large')
    }
  }

  const text = await req.text()
  if (textEncoder.encode(text).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new InvalidChannelsStatusRequestError('body is too large')
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidChannelsStatusRequestError('body must be valid JSON')
  }
}

function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new InvalidChannelsStatusRequestError(`${fieldName} must be a string`)
  }

  if (value.length > maxLength) {
    throw new InvalidChannelsStatusRequestError(`${fieldName} is too long`)
  }

  return value.length > 0 ? value : undefined
}

function validateChannelStatusRequest(value: unknown, index: number): ChannelStatusRequest {
  if (!isRecord(value)) {
    throw new InvalidChannelsStatusRequestError(`channels[${index}] must be an object`)
  }

  const { platform } = value
  if (platform !== 'twitch' && platform !== 'kick') {
    throw new InvalidChannelsStatusRequestError(`channels[${index}].platform is unsupported`)
  }

  const channelLogin = validateOptionalString(
    value.channelLogin,
    `channels[${index}].channelLogin`,
    MAX_CHANNEL_LOGIN_LENGTH,
  )
  if (!channelLogin || channelLogin.trim().length === 0) {
    throw new InvalidChannelsStatusRequestError(`channels[${index}].channelLogin is required`)
  }

  const channelId = validateOptionalString(
    value.channelId,
    `channels[${index}].channelId`,
    MAX_CHANNEL_ID_LENGTH,
  )
  const userAccessToken = validateOptionalString(
    value.userAccessToken,
    `channels[${index}].userAccessToken`,
    MAX_USER_ACCESS_TOKEN_LENGTH,
  )

  return {
    channelId,
    channelLogin,
    platform,
    userAccessToken,
  }
}

// ----------------------------------------------------------------
// Public handler
// ----------------------------------------------------------------

export async function handleChannelsStatus(req: Request): Promise<ChannelsStatusResponse> {
  const body = await parseChannelsStatusBody(req)
  if (!isRecord(body)) {
    throw new InvalidChannelsStatusRequestError('body must be an object')
  }

  const channels = body.channels

  if (channels === undefined) {
    return { channels: [] }
  }

  if (!Array.isArray(channels)) {
    throw new InvalidChannelsStatusRequestError('channels must be an array')
  }

  if (channels.length > MAX_CHANNELS) {
    throw new InvalidChannelsStatusRequestError(`channels cannot exceed ${MAX_CHANNELS}`)
  }

  const channelRequests = channels.map(validateChannelStatusRequest)

  if (channelRequests.length === 0) {
    return { channels: [] }
  }

  // Split by platform
  const twitchChannels = channelRequests.filter((c) => c.platform === 'twitch')
  const kickChannels = channelRequests.filter((c) => c.platform === 'kick')

  // Run platform groups in parallel; within Kick run each channel in parallel too
  const [twitchResults, kickResults] = await Promise.all([
    fetchTwitchChannelsStatus(twitchChannels),
    fetchKickChannelsStatus(kickChannels),
  ])

  const result = [...twitchResults, ...kickResults]
  log.debug('Channels status fetched', { count: result.length })

  return { channels: result }
}
