import type {
  AuthStartResponse,
  KickBuildUrlResponse,
  KickExchangeResponse,
  KickRefreshResponse,
  TwitchBuildUrlResponse,
  TwitchExchangeResponse,
  TwitchRefreshResponse,
} from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'
import { z } from 'zod'

import {
  buildKickAuthUrl,
  exchangeKickCode,
  handleKickCallback,
  refreshKickToken,
  startKickOAuth,
} from '../auth/kick.ts'
import {
  buildTwitchAuthUrl,
  exchangeTwitchCode,
  refreshTwitchToken,
  TwitchOAuthRejection,
} from '../auth/twitch.ts'
import { ClientStore } from '../db/index.ts'
import { json, requireClient } from './utils.ts'

const log = logger('auth')
const buildUrlSchema = z.object({
  codeChallenge: z.string().min(1),
  state: z.string().min(1),
  redirectUri: z.string().min(1),
})
const exchangeSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  redirectUri: z.string().min(1),
})
const refreshSchema = z.object({ refreshToken: z.string().min(1) })
const legacyStartSchema = z.object({ clientSecret: z.string().min(1) })

/** Passes Twitch's own refusal through so the desktop can tell a revoked token from an outage. */
function twitchFailure(route: string, error: unknown): Response {
  if (error instanceof TwitchOAuthRejection) {
    log.warn(`${route} rejected by Twitch`, { status: error.status, message: error.twitchMessage })
    return json({ error: 'twitch_rejected', message: error.twitchMessage }, error.status)
  }
  log.error(`${route} failed`, { err: String(error) })
  return json({ error: 'Twitch is unavailable' }, 502)
}

/**
 * Twitch OAuth: the desktop keeps PKCE and tokens, the backend holds the secret. These are
 * desktop API calls, not provider callbacks, so they require the client secret header.
 */
export function createTwitchAuthRoutes(authenticate = requireClient) {
  return {
    '/api/auth/twitch/start': {
      async POST(req: Request) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const parsed = buildUrlSchema.safeParse(await req.json().catch(() => undefined))
        if (!parsed.success) {
          return json({ error: 'codeChallenge, state, and redirectUri are required' }, 400)
        }
        const { codeChallenge, state, redirectUri } = parsed.data
        return json(
          buildTwitchAuthUrl(codeChallenge, state, redirectUri) satisfies TwitchBuildUrlResponse,
        )
      },
    },

    '/api/auth/twitch/exchange': {
      async POST(req: Request) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const parsed = exchangeSchema.safeParse(await req.json().catch(() => undefined))
        if (!parsed.success) {
          return json({ error: 'code, codeVerifier, and redirectUri are required' }, 400)
        }
        const body = parsed.data
        try {
          const tokens = await exchangeTwitchCode(body.code, body.codeVerifier, body.redirectUri)
          return json(tokens satisfies TwitchExchangeResponse)
        } catch (error) {
          return twitchFailure('twitch/exchange', error)
        }
      },
    },

    '/api/auth/twitch/refresh': {
      async POST(req: Request) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const parsed = refreshSchema.safeParse(await req.json().catch(() => undefined))
        if (!parsed.success) {
          return json({ error: 'refreshToken is required' }, 400)
        }
        try {
          const tokens = await refreshTwitchToken(parsed.data.refreshToken)
          return json(tokens satisfies TwitchRefreshResponse)
        } catch (error) {
          return twitchFailure('twitch/refresh', error)
        }
      },
    },
  }
}

export const authRoutes = {
  ...createTwitchAuthRoutes(),

  // ============================================================
  // Kick OAuth — HTTP-based flow (new)
  // ============================================================

  '/api/auth/kick/start': {
    async POST(req: Request) {
      const parsed = buildUrlSchema.safeParse(await req.json().catch(() => undefined))
      if (!parsed.success) {
        return json({ error: 'codeChallenge, state, and redirectUri are required' }, 400)
      }
      const body = parsed.data
      try {
        const { url } = buildKickAuthUrl(body.codeChallenge, body.state, body.redirectUri)
        return json({ url } satisfies KickBuildUrlResponse)
      } catch (error) {
        log.error('kick/start failed', { err: String(error) })
        return json({ error: 'Failed to build auth URL' }, 500)
      }
    },
  },

  '/api/auth/kick/exchange': {
    async POST(req: Request) {
      const parsed = exchangeSchema.safeParse(await req.json().catch(() => undefined))
      if (!parsed.success) {
        return json({ error: 'code, codeVerifier, and redirectUri are required' }, 400)
      }
      const body = parsed.data
      try {
        const tokens = await exchangeKickCode(body.code, body.codeVerifier, body.redirectUri)
        return json(tokens satisfies KickExchangeResponse)
      } catch (error) {
        log.error('kick/exchange failed', { err: String(error) })
        return json({ error: String(error) }, 500)
      }
    },
  },

  '/api/auth/kick/refresh': {
    async POST(req: Request) {
      const parsed = refreshSchema.safeParse(await req.json().catch(() => undefined))
      if (!parsed.success) {
        return json({ error: 'refreshToken is required' }, 400)
      }
      const body = parsed.data
      try {
        const tokens = await refreshKickToken(body.refreshToken)
        return json(tokens satisfies KickRefreshResponse)
      } catch (error) {
        log.error('kick/refresh failed', { err: String(error) })
        return json({ error: String(error) }, 500)
      }
    },
  },

  // ============================================================
  // Kick OAuth — Legacy WebSocket-based flow
  // ============================================================

  '/api/auth/kick/legacy-start': {
    async POST(req: Request) {
      const parsed = legacyStartSchema.safeParse(await req.json().catch(() => undefined))
      if (!parsed.success) {
        return json({ error: 'clientSecret is required' }, 400)
      }
      const body = parsed.data
      await ClientStore.upsert(body.clientSecret)
      try {
        const url = await startKickOAuth(body.clientSecret)
        return json({ url } satisfies AuthStartResponse)
      } catch (error) {
        log.error('kick/legacy-start failed', { err: String(error) })
        return json({ error: 'Failed to start OAuth' }, 500)
      }
    },
  },

  '/auth/kick/callback': {
    async GET(req: Request) {
      const url = new URL(req.url)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return new Response('Missing code or state', { status: 400 })
      }
      try {
        await handleKickCallback(code, state)
        return new Response(
          '<html><body><h2>Kick connected! You can close this tab.</h2></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        )
      } catch (error) {
        log.error('kick/callback failed', { err: String(error) })
        return new Response(`<html><body><h2>OAuth failed: ${String(error)}</h2></body></html>`, {
          headers: { 'Content-Type': 'text/html' },
          status: 500,
        })
      }
    },
  },
}
