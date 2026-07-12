/**
 * Kick OAuth — desktop side (PKCE flow).
 *
 * Flow:
 *  1. Desktop generates PKCE (codeVerifier, codeChallenge, state) — stored in-memory
 *  2. Desktop sends POST /api/auth/kick/start { codeChallenge, state, redirectUri } to backend
 *  3. Backend builds the Kick authUrl and returns it
 *  4. Desktop opens the URL in the browser
 *  5. Kick redirects to http://localhost:45821/auth/kick/callback?code=...&state=...
 *  6. Desktop validates state, grabs codeVerifier from memory
 *  7. Desktop calls POST /api/auth/kick/exchange on backend → receives tokens
 *  8. Desktop fetches user info from Kick API, saves account to SQLite
 *
 * Refresh:
 *  - Desktop calls POST /api/auth/kick/refresh on backend → receives new tokens
 *  - Desktop updates the account record in SQLite
 */

import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import { AccountStore } from '../store/account-store'
import { successPage } from './server'
import { KICK_REDIRECT_URI } from '@twirchat/shared/constants'
import { backendFetch } from '../runtime-config'
import { logger } from '@twirchat/shared/logger'
import type {
  KickBuildUrlRequest,
  KickBuildUrlResponse,
  KickExchangeRequest,
  KickExchangeResponse,
  KickRefreshRequest,
  KickRefreshResponse,
} from '@twirchat/shared'

const log = logger('auth-kick')

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
 * to build the Kick auth URL.
 */
export function prepareKickAuth(): { codeChallenge: string; state: string } {
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
export async function getKickAuthUrl(codeChallenge: string, state: string): Promise<string> {
  const res = await backendFetch(`/api/auth/kick/start`, {
    body: JSON.stringify({
      codeChallenge,
      state,
      redirectUri: KICK_REDIRECT_URI,
    } satisfies KickBuildUrlRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kick auth URL request failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as KickBuildUrlResponse
  return data.url
}

/**
 * Handles GET /auth/kick/callback from the local auth server.
 * Validates state, exchanges code for tokens via the backend, fetches
 * user info from Kick API, and persists the account in SQLite.
 */
export async function handleKickCallback(url: URL): Promise<{
  response: Response
  user: { platform: 'kick'; username: string; displayName: string }
  channelSlug: string
}> {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    throw new Error(
      `Kick OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`,
    )
  }

  if (!code || !state) {
    throw new Error('Missing code or state in Kick callback')
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
  const exchangeRes = await backendFetch(`/api/auth/kick/exchange`, {
    body: JSON.stringify({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: KICK_REDIRECT_URI,
    } satisfies KickExchangeRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!exchangeRes.ok) {
    const body = await exchangeRes.text()
    throw new Error(`Kick token exchange failed: ${exchangeRes.status} ${body}`)
  }

  const tokens = (await exchangeRes.json()) as KickExchangeResponse

  // Fetch user info from Kick API
  const userRes = await fetch('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })

  if (!userRes.ok) {
    throw new Error(`Kick user info request failed: ${userRes.status}`)
  }

  const userData = (await userRes.json()) as {
    data: {
      user_id: number
      name: string
      email?: string
      profile_picture?: string
    }[]
    message: string
  }

  if (!userData.data || userData.data.length === 0) {
    throw new Error('Kick user info response empty')
  }

  const user = userData.data[0]!

  const expiresAt = tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : undefined

  AccountStore.upsert({
    accessToken: tokens.accessToken,
    avatarUrl: user.profile_picture,
    displayName: user.name,
    expiresAt,
    id: `kick:${user.user_id}`,
    platform: 'kick',
    platformUserId: String(user.user_id),
    refreshToken: tokens.refreshToken,
    scopes: tokens.scope,
    username: user.name,
  })

  log.info(`Logged in as @${user.name}`)

  return {
    channelSlug: user.name,
    response: new Response(successPage('Kick'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: {
      displayName: user.name,
      platform: 'kick' as const,
      username: user.name,
    },
  }
}

/**
 * Refreshes the Kick access token for the given accountId via the backend proxy.
 * Updates the stored tokens in SQLite and returns the new access token.
 */
export async function refreshKickToken(accountId: string): Promise<string> {
  const stored = AccountStore.getTokens(accountId)
  if (!stored?.refreshToken) {
    throw new Error('No refresh token for Kick account')
  }

  const res = await backendFetch(`/api/auth/kick/refresh`, {
    body: JSON.stringify({
      refreshToken: stored.refreshToken,
    } satisfies KickRefreshRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kick token refresh failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as KickRefreshResponse

  const expiresAt = data.expiresIn ? Math.floor(Date.now() / 1000) + data.expiresIn : undefined

  AccountStore.updateTokens(accountId, data.accessToken, data.refreshToken, expiresAt)

  return data.accessToken
}
