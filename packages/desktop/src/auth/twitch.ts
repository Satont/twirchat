/**
 * Twitch sign-in through the TwirChat backend (authorization code + PKCE).
 *
 * The desktop keeps the PKCE verifier and the tokens. The backend holds the client
 * secret: it builds the authorize URL, exchanges the callback code and refreshes tokens.
 * Twitch redirects to the local auth server (`TWITCH_REDIRECT_URI`).
 */
import type {
  TwitchBuildUrlRequest,
  TwitchExchangeRequest,
  TwitchRefreshRequest,
} from '@twirchat/shared'
import { logger } from '@twirchat/shared'
import { TWITCH_REDIRECT_URI } from '@twirchat/shared/constants'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { backendFetch } from '../runtime-config'
import { AccountStore } from '../store/account-store'
import { createPkceSessions } from './pkce'
import { createOAuthRefresher, OAuthRefreshError } from './refresh-token'
import {
  authUrlSchema,
  exchangedTokenSchema,
  expiresAt,
  refreshedTokenSchema,
} from './response-schemas'
import { successPage } from './server'
import { TwitchTokenValidationError, validateTwitchUserToken } from './twitch-user-token'

const log = logger('auth-twitch')
const sessions = createPkceSessions()
const profileSchema = z.object({
  data: z.array(
    z.object({
      display_name: z.string().optional(),
      profile_image_url: z.string().nullish(),
    }),
  ),
})

function postToBackend(path: string, body: unknown): Promise<Response> {
  return backendFetch(path, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
}

export async function getTwitchAuthUrl(): Promise<string> {
  const { state, codeChallenge } = sessions.begin()
  const res = await postToBackend('/api/auth/twitch/start', {
    codeChallenge,
    state,
    redirectUri: TWITCH_REDIRECT_URI,
  } satisfies TwitchBuildUrlRequest)
  if (!res.ok) throw new Error(t('runtime.auth.startTwitchFailed', { status: res.status }))
  const { url } = authUrlSchema.parse(await res.json())
  if (new URL(url).origin !== 'https://id.twitch.tv')
    throw new Error(t('runtime.auth.twitchSignInFailed'))
  return url
}

export async function handleTwitchCallback(url: URL) {
  const { code, codeVerifier } = sessions.consume(url)
  const res = await postToBackend('/api/auth/twitch/exchange', {
    code,
    codeVerifier,
    redirectUri: TWITCH_REDIRECT_URI,
  } satisfies TwitchExchangeRequest)
  if (!res.ok) throw new Error(t('runtime.auth.twitchFailed', { status: res.status }))
  const tokens = exchangedTokenSchema.parse(await res.json())
  const validation = await validateTwitchUserToken(tokens.accessToken)

  const profileRes = await fetch(
    `https://api.twitch.tv/helix/users?id=${encodeURIComponent(validation.userId)}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Client-Id': validation.clientId,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    },
  )
  const profile = profileRes.ok ? profileSchema.parse(await profileRes.json()).data[0] : undefined

  const displayName = profile?.display_name ?? validation.login
  AccountStore.upsert({
    id: `twitch:${validation.userId}`,
    platform: 'twitch',
    platformUserId: validation.userId,
    username: validation.login,
    displayName,
    avatarUrl: profile?.profile_image_url ?? undefined,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: expiresAt(validation.expiresIn),
    scopes: validation.scopes,
  })
  log.info('Account signed in', { platform: 'twitch' })
  return {
    channelSlug: validation.login,
    response: new Response(successPage('Twitch'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: { username: validation.login, displayName },
  }
}

export const refreshTwitchToken = createOAuthRefresher('Twitch', {
  request: (refreshToken) =>
    postToBackend('/api/auth/twitch/refresh', { refreshToken } satisfies TwitchRefreshRequest),
  parse: (payload) => refreshedTokenSchema.required({ refreshToken: true }).parse(payload),
})

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
