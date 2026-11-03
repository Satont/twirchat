import type {
  YouTubeBuildUrlRequest,
  YouTubeExchangeRequest,
  YouTubeRefreshRequest,
} from '@twirchat/shared'
import { YOUTUBE_REDIRECT_URI } from '@twirchat/shared/constants'
import { logger } from '@twirchat/shared/logger'
/**
 * YouTube OAuth — desktop side (PKCE flow).
 *
 * Flow:
 *  1. Desktop generates PKCE (codeVerifier, codeChallenge, state) — stored in-memory
 *  2. Desktop sends POST /api/auth/youtube/start { codeChallenge, state, redirectUri } to backend
 *  3. Backend builds the YouTube authUrl and returns it
 *  4. Desktop opens the URL in the browser
 *  5. YouTube redirects to http://localhost:45821/auth/youtube/callback?code=...&state=...
 *  6. Desktop validates state, grabs codeVerifier from memory
 *  7. Desktop calls POST /api/auth/youtube/exchange on backend → receives tokens
 *  8. Desktop fetches user info from YouTube API, saves account to SQLite
 *
 * Refresh:
 *  - Desktop calls POST /api/auth/youtube/refresh on backend → receives new tokens
 *  - Desktop updates the account record in SQLite
 */
import type { Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { getBackendUrl } from '../runtime-config'
import { AccountStore } from '../store/account-store'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import { authUrlSchema, exchangedTokenSchema, refreshedTokenSchema } from './response-schemas'
import { successPage } from './server'

const log = logger('auth-youtube')

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
 * to build the YouTube auth URL.
 */
export function prepareYouTubeAuth(): { codeChallenge: string; state: string } {
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
export async function getYouTubeAuthUrl(codeChallenge: string, state: string): Promise<string> {
  const res = await fetch(`${getBackendUrl()}/api/auth/youtube/start`, {
    body: JSON.stringify({
      codeChallenge,
      state,
      redirectUri: YOUTUBE_REDIRECT_URI,
    } satisfies YouTubeBuildUrlRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`YouTube auth URL request failed: ${res.status} ${body}`)
  }

  const data = authUrlSchema.parse(await res.json())
  return data.url
}

/**
 * Handles GET /auth/youtube/callback from the local auth server.
 * Validates state, exchanges code for tokens via the backend, fetches
 * user info from YouTube API, and persists the account in SQLite.
 */
export async function handleYouTubeCallback(url: URL): Promise<{
  response: Response
  user: { platform: 'youtube'; username: string; displayName: string }
  channelSlug: string
}> {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    throw new Error(
      `YouTube OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`,
    )
  }

  if (!code || !state) {
    throw new Error('Missing code or state in YouTube callback')
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
  const exchangeRes = await fetch(`${getBackendUrl()}/api/auth/youtube/exchange`, {
    body: JSON.stringify({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: YOUTUBE_REDIRECT_URI,
    } satisfies YouTubeExchangeRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!exchangeRes.ok) {
    const body = await exchangeRes.text()
    throw new Error(`YouTube token exchange failed: ${exchangeRes.status} ${body}`)
  }

  const tokens = exchangedTokenSchema.parse(await exchangeRes.json())

  // Fetch user info from YouTube Data API
  const userRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    },
  )

  let userId: string
  let displayName: string
  let customUrl: string | undefined
  let avatarUrl: string | undefined

  if (userRes.ok) {
    const userData = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
                thumbnails: z
                  .object({ default: z.object({ url: z.string() }).optional() })
                  .optional(),
              }),
            }),
          )
          .optional(),
      })
      .parse(await userRes.json())

    if (!userData.items || userData.items.length === 0) {
      throw new Error('YouTube user info response empty — account may have no YouTube channel')
    }

    const channel = userData.items[0]
    if (!channel) throw new Error('YouTube channel response was empty.')
    userId = channel.id
    displayName = channel.snippet.title
    ;({ customUrl } = channel.snippet)
    avatarUrl = channel.snippet.thumbnails?.default?.url
  } else {
    const body = await userRes.text()
    log.warn(`YouTube channels API returned ${userRes.status}, falling back to Google userinfo`, {
      body,
    })

    // Fall back to Google OpenID Connect userinfo endpoint (always available with openid + profile scopes)
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })

    if (!infoRes.ok) {
      const infoBody = await infoRes.text()
      throw new Error(
        `YouTube user info request failed: ${userRes.status} (channels API); ${infoRes.status} (userinfo): ${infoBody}`,
      )
    }

    const info = z
      .object({
        sub: z.string(),
        name: z.string().optional(),
        given_name: z.string().optional(),
        picture: z.string().optional(),
      })
      .parse(await infoRes.json())

    userId = info.sub
    displayName = info.name ?? info.given_name ?? info.sub
    avatarUrl = info.picture
  }

  const expiresAt = tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : undefined

  const username = customUrl ?? userId

  AccountStore.upsert({
    activate: true,
    accessToken: tokens.accessToken,
    avatarUrl,
    displayName,
    expiresAt,
    id: `youtube:${userId}`,
    platform: 'youtube',
    platformUserId: userId,
    refreshToken: tokens.refreshToken,
    scopes: tokens.scope,
    username,
  })

  log.info(`Logged in as ${displayName}`)

  return {
    channelSlug: username,
    response: new Response(successPage('YouTube'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
    user: {
      displayName,
      platform: 'youtube' satisfies Platform,
      username,
    },
  }
}

/**
 * Refreshes the YouTube access token for the given accountId via the backend proxy.
 * Updates the stored tokens in SQLite and returns the new access token.
 */
export async function refreshYouTubeToken(accountId: string): Promise<string> {
  const stored = AccountStore.getTokens(accountId)
  if (!stored?.refreshToken) {
    throw new Error('No refresh token for YouTube account')
  }

  const res = await fetch(`${getBackendUrl()}/api/auth/youtube/refresh`, {
    body: JSON.stringify({
      refreshToken: stored.refreshToken,
    } satisfies YouTubeRefreshRequest),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`YouTube token refresh failed: ${res.status} ${body}`)
  }

  const data = refreshedTokenSchema.parse(await res.json())

  const expiresAt = data.expiresIn ? Math.floor(Date.now() / 1000) + data.expiresIn : undefined

  AccountStore.updateTokens(
    accountId,
    data.accessToken,
    data.refreshToken ?? stored.refreshToken,
    expiresAt,
  )

  return data.accessToken
}
