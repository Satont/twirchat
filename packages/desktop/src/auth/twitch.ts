import { setTimeout as wait } from 'node:timers/promises'

import { logger } from '@twirchat/shared'
import { TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { getTwitchDesktopClientId } from './client-config'
import { postOAuthForm } from './oauth-form'
import { createOAuthRefresher, OAuthRefreshError } from './refresh-token'
import { expiresAt, oauthTokenSchema } from './response-schemas'
import { TwitchTokenValidationError, validateTwitchUserToken } from './twitch-user-token'

const log = logger('auth-twitch')

export const TWITCH_SCOPES: readonly string[] = [
  'chat:read',
  'chat:edit',
  'user:read:chat',
  'user:write:chat',
  'user:read:emotes',
  'channel:read:subscriptions',
  'channel:read:redemptions',
  'moderator:read:followers',
  'moderator:read:moderators',
  'moderator:read:vips',
  'moderator:read:unban_requests',
  'moderator:read:chatters',
  'moderator:manage:chat_messages',
  'moderator:manage:banned_users',
  'moderator:manage:chat_settings',
  'moderator:manage:announcements',
  'moderator:manage:shoutouts',
  'channel:manage:moderators',
  'channel:manage:vips',
  'channel:read:vips',
  'moderation:read',
  'user:manage:chat_color',
  'channel:edit:commercial',
  'channel:manage:raids',
  'user:manage:blocked_users',
  'user:manage:whispers',
  'user:read:moderated_channels',
  'user:read:follows',
  'channel:read:polls',
  'channel:manage:polls',
  'channel:read:predictions',
  'channel:manage:predictions',
  'channel:manage:redemptions',
  'moderator:read:chat_messages',
  'bits:read',
  'channel:manage:broadcast',
  'channel:read:editors',
  'clips:edit',
  'moderator:manage:automod',
  'moderator:manage:blocked_terms',
  'moderator:manage:shield_mode',
  'moderator:manage:suspicious_users',
  'moderator:manage:warnings',
  'moderator:read:blocked_terms',
]

const scopes = TWITCH_SCOPES.join(' ')
const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code'

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  expires_in: z.number().int().positive().max(7200),
  interval: z.number().int().positive().max(120),
  user_code: z.string().regex(/^[A-Za-z0-9-]{1,32}$/u),
  verification_uri: z.url().refine((value) => {
    const url = new URL(value)
    return url.origin === 'https://www.twitch.tv' || url.origin === 'https://twitch.tv'
  }),
})
const deviceErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
})

export async function requestTwitchDeviceCode(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const clientId = getTwitchDesktopClientId()
  const res = await postOAuthForm(
    'https://id.twitch.tv/oauth2/device',
    { client_id: clientId, scopes },
    signal,
    fetcher,
  )
  if (!res.ok) throw new Error(t('runtime.auth.startTwitchFailed', { status: res.status }))
  const code = deviceCodeSchema.parse(await res.json())
  return {
    clientId,
    code,
    deadline: Date.now() + code.expires_in * 1000,
  }
}

export async function waitForTwitchDeviceToken(
  { clientId, code, deadline }: Awaited<ReturnType<typeof requestTwitchDeviceCode>>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  let interval = code.interval * 1000
  const body = {
    client_id: clientId,
    scopes,
    device_code: code.device_code,
    grant_type: deviceGrant,
  }
  while (Date.now() < deadline) {
    // Twitch requires sequential polling with at least the advertised interval.
    // eslint-disable-next-line no-await-in-loop
    await wait(Math.min(interval, deadline - Date.now()), undefined, { signal })
    if (Date.now() >= deadline) break
    // eslint-disable-next-line no-await-in-loop
    const res = await postOAuthForm(TWITCH_TOKEN_URL, body, signal, fetcher)
    // eslint-disable-next-line no-await-in-loop
    const payload: unknown = await res.json().catch(() => null)
    if (res.ok) return oauthTokenSchema.required({ refresh_token: true }).parse(payload)
    const parsed = deviceErrorSchema.safeParse(payload)
    const reason = parsed.success ? (parsed.data.message ?? parsed.data.error) : undefined
    if (reason === 'authorization_pending') continue
    if (reason === 'slow_down' || res.status === 429) {
      interval += 5000
      continue
    }
    if (reason === 'access_denied') throw new Error(t('runtime.auth.twitchDeclined'))
    if (reason === 'expired_token' || reason === 'invalid device code') break
    throw new Error(t('runtime.auth.twitchFailed', { status: res.status }))
  }
  throw new Error(t('runtime.auth.twitchExpired'))
}

export async function connectTwitchDevice(
  attempt: Awaited<ReturnType<typeof requestTwitchDeviceCode>>,
  signal: AbortSignal,
) {
  const tokens = await waitForTwitchDeviceToken(attempt, signal)
  const validation = await validateTwitchUserToken(tokens.access_token)
  if (validation.clientId !== attempt.clientId)
    throw new Error(t('runtime.auth.twitchClientMismatch'))

  const res = await fetch(
    `https://api.twitch.tv/helix/users?id=${encodeURIComponent(validation.userId)}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Client-Id': validation.clientId,
      },
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    },
  )
  const profile = res.ok
    ? z
        .object({
          data: z.array(
            z.object({
              display_name: z.string().optional(),
              profile_image_url: z.string().nullish(),
            }),
          ),
        })
        .parse(await res.json()).data[0]
    : undefined

  signal.throwIfAborted()
  const displayName = profile?.display_name ?? validation.login
  AccountStore.upsert({
    id: `twitch:${validation.userId}`,
    platform: 'twitch',
    platformUserId: validation.userId,
    username: validation.login,
    displayName,
    avatarUrl: profile?.profile_image_url ?? undefined,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiresAt(validation.expiresIn),
    scopes: validation.scopes,
  })
  log.info('Account signed in', { platform: 'twitch' })
  return { channelSlug: validation.login, username: validation.login, displayName }
}

export const refreshTwitchToken = createOAuthRefresher('Twitch', TWITCH_TOKEN_URL, () => ({
  client_id: getTwitchDesktopClientId(),
}))

export async function checkTwitchSession(
  accountId: string,
  isDisposed: () => boolean,
): Promise<boolean> {
  const tokens = AccountStore.getTokens(accountId)
  if (!tokens || isDisposed()) return false
  try {
    await validateTwitchUserToken(tokens.accessToken, true)
    return false
  } catch (error) {
    if (!(error instanceof TwitchTokenValidationError) || !error.invalidAccessToken) throw error
  }

  const isCurrent = () => {
    if (isDisposed()) return false
    const current = AccountStore.getTokens(accountId)
    return (
      current?.accessToken === tokens.accessToken && current.refreshToken === tokens.refreshToken
    )
  }
  if (!isCurrent()) return false
  if (tokens.refreshToken) {
    try {
      const refreshed = await refreshTwitchToken(accountId)
      await validateTwitchUserToken(refreshed)
      return false
    } catch (error) {
      if (!(error instanceof OAuthRefreshError) || !error.invalidRefreshToken) throw error
    }
  }
  if (!isCurrent()) return false
  AccountStore.clearTokens(accountId)
  log.warn('Account authorization ended', {
    platform: 'twitch',
    reason: tokens.refreshToken ? 'invalid_refresh_token' : 'missing_refresh_token',
  })
  return true
}
