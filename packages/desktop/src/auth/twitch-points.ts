import { TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import type { z } from 'zod'

import { t } from '../i18n'
import { postOAuthForm } from './oauth-form'
import { OAuthRefreshError } from './refresh-token'
import { expiresAt, hasOAuthErrorMessage, oauthTokenSchema } from './response-schemas'
import { pollDeviceToken, requestDeviceCode, type TwitchDeviceAttempt } from './twitch-device-code'
import { validateTwitchUserToken } from './twitch-user-token'

export const TWITCH_TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa'
const pointsScopes = 'channel:read:redemptions channel:manage:redemptions'
const deviceId = crypto.randomUUID().replaceAll('-', '')

function twitchTvHeaders() {
  return {
    'Client-Id': TWITCH_TV_CLIENT_ID,
    Origin: 'https://android.tv.twitch.tv',
    Referer: 'https://android.tv.twitch.tv/',
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'X-Device-Id': deviceId,
  }
}

function twitchTvFetch(fetcher: typeof fetch): typeof fetch {
  return Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      fetcher(input, { ...init, headers: twitchTvHeaders() }),
    { preconnect: fetcher.preconnect },
  )
}

export function requestTwitchPointsDeviceCode(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return requestDeviceCode({
    clientId: TWITCH_TV_CLIENT_ID,
    scopes: pointsScopes,
    signal,
    fetcher: twitchTvFetch(fetcher),
  })
}

export async function connectTwitchPointsDevice(
  attempt: TwitchDeviceAttempt,
  expectedUserId: string,
  signal: AbortSignal,
) {
  const tokens = await pollDeviceToken({ attempt, signal, fetcher: twitchTvFetch(fetch) })
  return validatePointsToken(tokens, expectedUserId, signal)
}

type TwitchPointsDeviceSession = Awaited<ReturnType<typeof connectTwitchPointsDevice>>

export async function refreshTwitchPointsDevice(
  { userId, refreshToken }: { userId: string; refreshToken: string },
  signal?: AbortSignal,
): Promise<TwitchPointsDeviceSession> {
  const res = await postOAuthForm(
    TWITCH_TOKEN_URL,
    { client_id: TWITCH_TV_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken },
    signal,
    twitchTvFetch(fetch),
  )
  if (!res.ok) {
    const invalidRefresh =
      (res.status === 400 || res.status === 401) &&
      (await hasOAuthErrorMessage(res, 'invalid refresh token'))
    throw new OAuthRefreshError('Twitch', res.status, invalidRefresh)
  }
  const tokens = oauthTokenSchema.parse(await res.json())
  return validatePointsToken(
    { ...tokens, refresh_token: tokens.refresh_token ?? refreshToken },
    userId,
    signal,
  )
}

async function validatePointsToken(
  tokens: z.infer<typeof oauthTokenSchema>,
  expectedUserId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const validation = await validateTwitchUserToken(tokens.access_token)
  signal?.throwIfAborted()
  if (validation.clientId !== TWITCH_TV_CLIENT_ID)
    throw new Error(t('runtime.auth.twitchClientMismatch'))
  if (validation.userId !== expectedUserId)
    throw new Error(t('runtime.api.twitchWebSessionMismatch'))

  return {
    token: tokens.access_token,
    userId: validation.userId,
    username: validation.login,
    clientId: validation.clientId,
    expiresAt: expiresAt(validation.expiresIn || tokens.expires_in),
    refreshToken: tokens.refresh_token,
  }
}
