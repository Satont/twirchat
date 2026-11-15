import { logger } from '@twirchat/shared'
import { TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { getTwitchDesktopClientId } from './client-config'
import { createOAuthRefresher, OAuthRefreshError } from './refresh-token'
import { expiresAt, oauthTokenSchema } from './response-schemas'
import { pollDeviceToken, requestDeviceCode, type TwitchDeviceAttempt } from './twitch-device-code'
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

export async function requestTwitchDeviceCode(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return requestDeviceCode({ clientId: getTwitchDesktopClientId(), scopes, signal, fetcher })
}

export async function waitForTwitchDeviceToken(
  attempt: TwitchDeviceAttempt,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const tokens = await pollDeviceToken({ attempt, signal, fetcher, scopes })
  return oauthTokenSchema.required({ refresh_token: true }).parse(tokens)
}

export async function connectTwitchDevice(attempt: TwitchDeviceAttempt, signal: AbortSignal) {
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
