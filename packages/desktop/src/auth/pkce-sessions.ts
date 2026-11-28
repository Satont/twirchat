import { generateCodeChallenge, generateCodeVerifier, generateState } from '@twirchat/shared/pkce'

import { t } from '../gpuix/i18n'

const SESSION_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_SESSIONS = 16

interface PkceSession {
  codeVerifier: string
  expiresAt: number
}

export function createPkceSessions() {
  const sessions = new Map<string, PkceSession>()
  return {
    authorize(
      endpoint: string,
      clientId: string,
      redirectUri: string,
      scopes: string[],
      extra: Record<string, string> = {},
    ): string {
      const now = Date.now()
      for (const [state, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(state)
      }
      if (sessions.size >= MAX_PENDING_SESSIONS) {
        const oldest = sessions.keys().next().value
        if (oldest) sessions.delete(oldest)
      }
      const state = generateState()
      const codeVerifier = generateCodeVerifier()
      sessions.set(state, { codeVerifier, expiresAt: now + SESSION_TTL_MS })
      const params = new URLSearchParams({
        ...extra,
        client_id: clientId,
        code_challenge: generateCodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
      })
      return `${endpoint}?${params}`
    },

    consume(url: URL): { code: string; codeVerifier: string } {
      const state = url.searchParams.get('state') ?? ''
      const session = sessions.get(state)
      sessions.delete(state)
      if (!session || session.expiresAt <= Date.now())
        throw new Error(t('runtime.auth.sessionExpired'))
      if (url.searchParams.has('error')) throw new Error(t('runtime.auth.authorizationDeclined'))
      const code = url.searchParams.get('code')
      if (!code) throw new Error(t('runtime.auth.missingCallbackCode'))
      return { code, codeVerifier: session.codeVerifier }
    },
  }
}
