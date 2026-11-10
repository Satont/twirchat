import type {
  VkPlayBuildUrlRequest,
  VkPlayExchangeRequest,
  VkPlayRefreshRequest,
} from '@twirchat/shared'
import { VKPLAY_DEV_API_BASE, VKPLAY_REDIRECT_URI } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import { AccountStore } from '../store/account-store'
import { generateState } from './pkce'
import {
  authUrlSchema,
  exchangedTokenSchema,
  expiresAt,
  refreshedTokenSchema,
} from './response-schemas'
import { successPage } from './server'

const log = logger('auth-vkplay')
const SESSION_TTL_MS = 10 * 60 * 1000

const pendingSessions = new Map<string, { expiresAt: number }>()
const refreshInFlight = new Map<string, Promise<string>>()

const currentUserSchema = z.object({
  data: z.object({
    channel: z.object({ url: z.string() }).optional(),
    channels: z.array(z.object({ url: z.string() })).optional(),
    user: z.object({
      avatar_url: z.string().optional(),
      id: z.union([z.number().int(), z.string().min(1)]),
      nick: z.string().min(1),
    }),
  }),
})

function cleanupSessions(): void {
  const now = Date.now()
  for (const [state, session] of pendingSessions) {
    if (session.expiresAt <= now) pendingSessions.delete(state)
  }
}

function currentUserChannel(data: z.infer<typeof currentUserSchema>['data']): string {
  return data.channel?.url ?? data.channels?.[0]?.url ?? data.user.nick
}

export function prepareVkPlayAuth(): { state: string } {
  cleanupSessions()
  const state = generateState()
  pendingSessions.set(state, { expiresAt: Date.now() + SESSION_TTL_MS })
  return { state }
}

export async function getVkPlayAuthUrl(state: string): Promise<string> {
  const res = await backendFetch('/api/auth/vkplay/start', {
    body: JSON.stringify({
      redirectUri: VKPLAY_REDIRECT_URI,
      state,
    } satisfies VkPlayBuildUrlRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).trim()
    throw new Error(`VK Play Live sign-in is unavailable${detailSuffix(res.status, body)}`)
  }
  return authUrlSchema.parse(await responseJson(res)).url
}

export async function handleVkPlayCallback(url: URL): Promise<{
  channelSlug: string
  response: Response
  user: { platform: Platform; username: string; displayName: string }
}> {
  const error = url.searchParams.get('error')
  if (error) {
    throw new Error(
      `VK Play Live OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`,
    )
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) throw new Error('Missing code or state in VK Play Live callback')
  const session = pendingSessions.get(state)
  if (!session || session.expiresAt <= Date.now()) {
    pendingSessions.delete(state)
    throw new Error('Unknown or expired VK Play Live OAuth state')
  }
  pendingSessions.delete(state)

  const exchangeRes = await backendFetch('/api/auth/vkplay/exchange', {
    body: JSON.stringify({
      code,
      redirectUri: VKPLAY_REDIRECT_URI,
    } satisfies VkPlayExchangeRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!exchangeRes.ok) {
    const body = (await exchangeRes.text().catch(() => '')).trim()
    throw new Error(`VK Play Live token exchange failed${detailSuffix(exchangeRes.status, body)}`)
  }
  const tokens = exchangedTokenSchema.parse(await responseJson(exchangeRes))

  const userRes = await fetch(`${VKPLAY_DEV_API_BASE}/current_user`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Origin: 'https://live.vkvideo.ru',
      'User-Agent': 'TwirChat',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!userRes.ok) throw new Error(`VK Play Live user request failed (HTTP ${userRes.status})`)
  const profile = currentUserSchema.parse(await userRes.json()).data
  const channelSlug = currentUserChannel(profile)
  const displayName = profile.user.nick

  AccountStore.upsert({
    accessToken: tokens.accessToken,
    activate: true,
    avatarUrl: profile.user.avatar_url,
    displayName,
    expiresAt: expiresAt(tokens.expiresIn),
    id: `vkplay:${profile.user.id}`,
    platform: 'vkplay',
    platformUserId: String(profile.user.id),
    refreshToken: tokens.refreshToken,
    scopes: tokens.scope,
    username: channelSlug,
  })

  log.info(`Logged in as ${displayName}`)
  return {
    channelSlug,
    response: new Response(successPage('VK Play Live'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: { displayName, platform: 'vkplay', username: channelSlug },
  }
}

export function refreshVkPlayToken(accountId: string): Promise<string> {
  const existing = refreshInFlight.get(accountId)
  if (existing) return existing
  const request = refreshVkPlayTokenNow(accountId).finally(() => {
    refreshInFlight.delete(accountId)
  })
  refreshInFlight.set(accountId, request)
  return request
}

async function refreshVkPlayTokenNow(accountId: string): Promise<string> {
  const stored = AccountStore.getTokens(accountId)
  if (!stored?.refreshToken) {
    throw new Error('Sign in to VK Play Live again to refresh this account.')
  }
  const res = await backendFetch('/api/auth/vkplay/refresh', {
    body: JSON.stringify({
      redirectUri: VKPLAY_REDIRECT_URI,
      refreshToken: stored.refreshToken,
    } satisfies VkPlayRefreshRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).trim()
    throw new Error(`VK Play Live token refresh failed${detailSuffix(res.status, body)}`)
  }
  const tokens = refreshedTokenSchema.parse(await responseJson(res))
  const current = AccountStore.getTokens(accountId)
  if (!current) throw new Error('The VK Play Live account was removed.')
  if (current.accessToken !== stored.accessToken || current.refreshToken !== stored.refreshToken) {
    return current.accessToken
  }
  AccountStore.updateTokens(
    accountId,
    tokens.accessToken,
    tokens.refreshToken ?? stored.refreshToken,
    expiresAt(tokens.expiresIn) ?? stored.expiresAt,
  )
  return tokens.accessToken
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('VK Play Live returned an invalid response.')
  }
}

function detailSuffix(status: number, body: string): string {
  return body ? ` (HTTP ${status}): ${body.slice(0, 300)}` : ` (HTTP ${status})`
}
