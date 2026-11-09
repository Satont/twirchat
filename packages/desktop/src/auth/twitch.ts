import type {
  TwitchBuildUrlRequest,
  TwitchExchangeRequest,
  TwitchRefreshRequest,
} from '@twirchat/shared'
import { TWITCH_REDIRECT_URI } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
/**
 * Twitch OAuth — desktop side (PKCE flow).
 *
 * Flow:
 *  1. Desktop generates PKCE (codeVerifier, codeChallenge, state) — stored in-memory
 *  2. Desktop sends POST /api/auth/twitch/start { codeChallenge, state, redirectUri } to backend
 *  3. Backend builds the Twitch authUrl and returns it
 *  4. Desktop opens the URL in the browser
 *  5. Twitch redirects to http://localhost:45821/auth/twitch/callback?code=...&state=...
 *  6. Desktop validates state, grabs codeVerifier from memory
 *  7. Desktop calls POST /api/auth/twitch/exchange on backend → receives tokens
 *  8. Desktop fetches user info from Twitch, saves account to SQLite
 *
 * Refresh:
 *  - Desktop calls POST /api/auth/twitch/refresh on backend → receives new tokens
 *  - Desktop updates the account record in SQLite
 */
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { backendFetch } from '../runtime-config'
import { AccountStore } from '../store/account-store'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import { authUrlSchema, exchangedTokenSchema, refreshedTokenSchema } from './response-schemas'
import { successPage } from './server'

const log = logger('auth-twitch')

// ----------------------------------------------------------------
// In-memory PKCE session store (state → { codeVerifier, expiresAt })
// ----------------------------------------------------------------

const pendingSessions = new Map<string, { codeVerifier: string; expiresAt: number }>()

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 minutes

/** Clean up expired sessions periodically */
function cleanupSessions(): void {
  const now = Date.now()
  for (const [state, session] of pendingSessions) {
    if (now > session.expiresAt) {
      pendingSessions.delete(state)
    }
  }
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Generates PKCE params, stores the session in memory, and returns
 * { codeChallenge, state } so the caller can send request to backend
 * to build the Twitch auth URL.
 */
export function prepareTwitchAuth(): { codeChallenge: string; state: string } {
  cleanupSessions()

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateState()

  pendingSessions.set(state, {
    codeVerifier,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })

  return { codeChallenge, state }
}

/**
 * Requests the auth URL from backend by sending PKCE params.
 * Returns the URL to open in browser.
 */
export async function getTwitchAuthUrl(codeChallenge: string, state: string): Promise<string> {
  const res = await backendFetch(`/api/auth/twitch/start`, {
    body: JSON.stringify({
      codeChallenge,
      state,
      redirectUri: TWITCH_REDIRECT_URI,
    } satisfies TwitchBuildUrlRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Twitch auth URL request failed: ${res.status} ${body}`)
  }

  const data = authUrlSchema.parse(await res.json())
  return data.url
}

/**
 * Handles GET /auth/twitch/callback from the local auth server.
 * Validates state, exchanges code for tokens via the backend, fetches
 * user info from Twitch, and persists the account in SQLite.
 */
export async function handleTwitchCallback(url: URL): Promise<{
  response: Response
  user: { platform: 'twitch'; username: string; displayName: string }
  channelSlug: string
}> {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    throw new Error(
      `Twitch OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`,
    )
  }

  if (!code || !state) {
    throw new Error('Missing code or state in Twitch callback')
  }

  const session = pendingSessions.get(state)
  if (!session) {
    throw new Error('Unknown or expired OAuth state')
  }
  if (Date.now() > session.expiresAt) {
    pendingSessions.delete(state)
    throw new Error('OAuth session expired')
  }
  pendingSessions.delete(state)

  // Exchange code for tokens via backend proxy
  const exchangeRes = await backendFetch(`/api/auth/twitch/exchange`, {
    body: JSON.stringify({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: TWITCH_REDIRECT_URI,
    } satisfies TwitchExchangeRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!exchangeRes.ok) {
    const body = await exchangeRes.text()
    throw new Error(`Twitch token exchange failed: ${exchangeRes.status} ${body}`)
  }

  const tokens = exchangedTokenSchema.parse(await exchangeRes.json())

  // Validate the token and get user info — the /oauth2/validate endpoint only
  // Requires the Bearer token, no client credentials needed on the desktop side.
  const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${tokens.accessToken}` },
  })

  if (!validateRes.ok) {
    throw new Error(`Twitch token validation failed: ${validateRes.status}`)
  }

  const validateData = z
    .object({
      user_id: z.string(),
      login: z.string(),
      client_id: z.string(),
      expires_in: z.number(),
      scopes: z.array(z.string()),
    })
    .parse(await validateRes.json())

  const userInfoRes = await fetch(
    `https://api.twitch.tv/helix/users?id=${encodeURIComponent(validateData.user_id)}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Client-Id': validateData.client_id,
      },
    },
  )

  const userInfo = userInfoRes.ok
    ? z
        .object({
          data: z
            .array(
              z.object({
                display_name: z.string().optional(),
                profile_image_url: z.union([z.string(), z.null()]).optional(),
              }),
            )
            .optional(),
        })
        .parse(await userInfoRes.json()).data?.[0]
    : undefined

  const expiresAt = tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : undefined

  AccountStore.upsert({
    activate: true,
    id: `twitch:${validateData.user_id}`,
    platform: 'twitch',
    platformUserId: validateData.user_id,
    username: validateData.login,
    displayName: userInfo?.display_name ?? validateData.login,
    avatarUrl: userInfo?.profile_image_url ?? undefined,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
    scopes: validateData.scopes,
  })

  log.info(`Logged in as @${validateData.login}`)

  return {
    channelSlug: validateData.login,
    response: new Response(successPage('Twitch'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: {
      displayName: validateData.login,
      platform: 'twitch' satisfies Platform,
      username: validateData.login,
    },
  }
}

const tokenRefreshes = new Map<string, Promise<string>>()

/**
 * Refreshes the Twitch access token for the given accountId via the backend proxy.
 * Updates the stored tokens in SQLite and returns the new access token.
 */
export function refreshTwitchToken(accountId: string): Promise<string> {
  const pending = tokenRefreshes.get(accountId)
  if (pending) return pending
  const refresh = exchangeRefreshToken(accountId).finally(() => tokenRefreshes.delete(accountId))
  tokenRefreshes.set(accountId, refresh)
  return refresh
}

async function exchangeRefreshToken(accountId: string): Promise<string> {
  const stored = AccountStore.getTokens(accountId)
  if (!stored?.refreshToken) {
    throw new Error('No refresh token for Twitch account')
  }

  const res = await backendFetch(`/api/auth/twitch/refresh`, {
    body: JSON.stringify({
      refreshToken: stored.refreshToken,
    } satisfies TwitchRefreshRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Twitch token refresh failed: ${res.status} ${body}`)
  }

  const data = refreshedTokenSchema.parse(await res.json())
  const current = AccountStore.getTokens(accountId)
  if (!current) throw new Error('The saved Twitch account was removed during token refresh.')
  if (current.accessToken !== stored.accessToken || current.refreshToken !== stored.refreshToken)
    return current.accessToken

  const expiresAt = data.expiresIn ? Math.floor(Date.now() / 1000) + data.expiresIn : undefined

  AccountStore.updateTokens(accountId, data.accessToken, data.refreshToken, expiresAt)

  return data.accessToken
}
