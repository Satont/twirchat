import type {
  AuthStartResponse,
  KickBuildUrlResponse,
  KickExchangeResponse,
  KickRefreshResponse,
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
import { ClientStore } from '../db/index.ts'
import { json } from './utils.ts'

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

export const authRoutes = {
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
