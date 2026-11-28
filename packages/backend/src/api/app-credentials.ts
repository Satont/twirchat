import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import { config } from '../config.ts'

const log = logger('app-credentials')
// Leave time for the API request after a cold grant.
const APP_GRANT_TIMEOUT_MS = 8000
const TWITCH_REQUEST_TIMEOUT_MS = 8000
// Bound the full Kick read, including cold grant acquisition and all batch waves.
const KICK_READ_TIMEOUT_MS = 20_000
const REFRESH_MARGIN_MS = 60_000
const appTokenResponse = z.object({ access_token: z.string(), expires_in: z.number() })

interface AppGrantRequest {
  provider: 'Twitch' | 'Kick'
  endpoint: string
  clientId: string
  clientSecret: string
}

async function requestAppGrant({ provider, endpoint, clientId, clientSecret }: AppGrantRequest) {
  const res = await fetch(endpoint, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(APP_GRANT_TIMEOUT_MS),
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    log.warn('App grant rejected', { provider, status: res.status })
    throw new Error(`Unable to obtain ${provider} application credentials.`)
  }
  return appTokenResponse.parse(await res.json())
}

interface TwitchAppGrant {
  readonly token: string
  readonly expiresAt: number
}

let twitchAppGrant: TwitchAppGrant | null = null
let pendingTwitchAppGrant: Promise<TwitchAppGrant> | null = null

function getTwitchHelixHeaders(token: string, headers?: RequestInit['headers']): Headers {
  const nextHeaders = new Headers(headers)
  nextHeaders.set('Authorization', `Bearer ${token}`)
  nextHeaders.set('Client-Id', config.TWITCH_CLIENT_ID)

  return nextHeaders
}

async function getTwitchAppGrant(): Promise<TwitchAppGrant> {
  if (twitchAppGrant?.token && Date.now() < twitchAppGrant.expiresAt - REFRESH_MARGIN_MS) {
    return twitchAppGrant
  }
  // Concurrent requests after a restart or expiry share one grant request.
  pendingTwitchAppGrant ??= requestTwitchAppGrant().finally(() => {
    pendingTwitchAppGrant = null
  })
  return pendingTwitchAppGrant
}

async function requestTwitchAppGrant(): Promise<TwitchAppGrant> {
  const data = await requestAppGrant({
    provider: 'Twitch',
    endpoint: 'https://id.twitch.tv/oauth2/token',
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
  })

  twitchAppGrant = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return twitchAppGrant
}

async function waitForTwitchAppGrant(
  signal: AbortSignal | null | undefined,
): Promise<TwitchAppGrant> {
  if (!signal) return getTwitchAppGrant()
  signal.throwIfAborted()
  const cancelled = Promise.withResolvers<never>()
  const onAbort = () => cancelled.reject(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([getTwitchAppGrant(), cancelled.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

interface TwitchHelixRequestInit extends RequestInit {
  timeoutMs?: number
}

export async function fetchTwitchHelixWithAppToken(
  input: string | URL,
  { signal, timeoutMs = TWITCH_REQUEST_TIMEOUT_MS, ...init }: TwitchHelixRequestInit = {},
): Promise<Response> {
  const request = (grant: TwitchAppGrant) => {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(timeoutMs)
    return fetch(input, {
      ...init,
      headers: getTwitchHelixHeaders(grant.token, init.headers),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    })
  }
  const grant = await waitForTwitchAppGrant(signal)
  const response = await request(grant)
  if (response.status !== 401) return response

  // A delayed rejection applies only to the grant used by that request.
  if (twitchAppGrant === grant) twitchAppGrant = null
  return request(await waitForTwitchAppGrant(signal))
}

let kickAppToken: string | null = null
let kickAppTokenExpiresAt = 0
let pendingKickAppToken: Promise<string> | null = null

async function getKickAppToken(): Promise<string> {
  if (kickAppToken && Date.now() < kickAppTokenExpiresAt - REFRESH_MARGIN_MS) {
    return kickAppToken
  }

  pendingKickAppToken ??= requestKickAppToken().finally(() => {
    pendingKickAppToken = null
  })
  return pendingKickAppToken
}

async function requestKickAppToken(): Promise<string> {
  const data = await requestAppGrant({
    provider: 'Kick',
    endpoint: 'https://id.kick.com/oauth/token',
    clientId: config.KICK_CLIENT_ID,
    clientSecret: config.KICK_CLIENT_SECRET,
  })

  kickAppToken = data.access_token
  kickAppTokenExpiresAt = Date.now() + data.expires_in * 1000

  return kickAppToken
}

export async function createKickRead(): Promise<(path: `/public/${string}`) => Promise<Response>> {
  const signal = AbortSignal.timeout(KICK_READ_TIMEOUT_MS)
  const token = await getKickAppToken()
  signal.throwIfAborted()
  const headers = { Authorization: `Bearer ${token}`, 'Client-ID': config.KICK_CLIENT_ID }
  return async (path) => {
    signal.throwIfAborted()
    return fetch(`https://api.kick.com${path}`, { headers, signal })
  }
}
