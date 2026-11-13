/**
 * Twitch OAuth for the desktop app. The desktop keeps the PKCE verifier and the tokens;
 * the backend owns the client secret, so it builds the authorize URL, exchanges the code
 * and refreshes tokens.
 */
import { TWITCH_AUTH_URL, TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import type {
  TwitchBuildUrlResponse,
  TwitchExchangeResponse,
  TwitchRefreshResponse,
} from '@twirchat/shared/protocol'
import { TWITCH_SCOPES } from '@twirchat/shared/twitch-scopes'
import { z } from 'zod'

import { config } from '../config.ts'

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.array(z.string()).optional(),
})
const errorSchema = z.object({ message: z.string() })

/** Twitch refused the request itself (as opposed to the network or Twitch being down). */
export class TwitchOAuthRejection extends Error {
  constructor(
    readonly status: number,
    readonly twitchMessage: string,
  ) {
    super(`Twitch OAuth rejected the request: ${status} ${twitchMessage}`)
    this.name = 'TwitchOAuthRejection'
  }
}

export function buildTwitchAuthUrl(
  codeChallenge: string,
  state: string,
  redirectUri: string,
): TwitchBuildUrlResponse {
  const params = new URLSearchParams({
    client_id: config.TWITCH_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: TWITCH_SCOPES.join(' '),
    state,
  })
  return { url: `${TWITCH_AUTH_URL}?${params.toString()}` }
}

async function requestTokens(params: Record<string, string>) {
  const res = await fetch(TWITCH_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      ...params,
    }),
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const payload: unknown = await res.json().catch(() => null)
  if (res.status === 400 || res.status === 401) {
    const parsed = errorSchema.safeParse(payload)
    throw new TwitchOAuthRejection(res.status, parsed.success ? parsed.data.message : '')
  }
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`)
  const data = tokenSchema.parse(payload)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  }
}

export function exchangeTwitchCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TwitchExchangeResponse> {
  return requestTokens({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  })
}

export async function refreshTwitchToken(refreshToken: string): Promise<TwitchRefreshResponse> {
  const {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresIn,
  } = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  return { accessToken, refreshToken: nextRefreshToken, expiresIn }
}
