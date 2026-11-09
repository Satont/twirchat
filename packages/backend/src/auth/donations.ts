import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import type { DonationOAuthTokens, OAuthDonationProvider } from '@twirchat/shared/donations'
import { z } from 'zod'

import { generateCodeChallenge } from './pkce'

const PROVIDER_ORIGINS: Record<OAuthDonationProvider, string> = {
  donationalerts: 'https://www.donationalerts.com',
  memealerts: 'https://memealerts.com',
}
const SCOPE = 'oauth-user-show oauth-donation-subscribe'
const LOOPBACK_CALLBACK = '/auth/donations/callback'
const STATE_TTL_MS = 5 * 60_000
const NONCE_BYTES = 12
const TAG_BYTES = 16

export const oauthDonationProvider = z.enum(['donationalerts', 'memealerts'])
export const donationCodeChallenge = z.string().regex(/^[\w-]{43}$/u)
export const donationLoopbackPort = z.number().int().min(1024).max(65535)
export const donationRelayState = z.string().min(1).max(256)
export const donationRelayTicket = z
  .string()
  .min(39)
  .max(5500)
  .regex(/^[\w-]+$/u)
export const donationCodeVerifier = z.string().regex(/^[\w.~-]{43,128}$/u)
export const donationRefreshToken = z.string().min(1).max(4096)

const providerCode = z.string().regex(/^[\x20-\x7e]{1,4096}$/u)
const stateParts = z.tuple([
  z.literal('v1'),
  oauthDonationProvider,
  z
    .string()
    .regex(/^\d{13}$/u)
    .transform(Number),
  z
    .string()
    .regex(/^\d{4,5}$/u)
    .transform(Number)
    .pipe(donationLoopbackPort),
  donationCodeChallenge,
  donationCodeChallenge,
])
const tokenResponse = z.object({
  access_token: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9._~+/-]+=*$/u),
  refresh_token: donationRefreshToken.nullish(),
  expires_in: z.number().int().positive().max(1_000_000_000),
  token_type: z.string().refine((type) => type.toLowerCase() === 'bearer'),
})
const invalidRefreshResponse = z.object({ error: z.enum(['invalid_grant', 'invalid_token']) })

export interface DonationOAuthCredentials {
  clientId: string
  clientSecret: string
  redirectUri: string
}

interface DonationOAuthClient extends DonationOAuthCredentials {
  provider: OAuthDonationProvider
}

type TokenGrant = { kind: 'code'; code: string } | { kind: 'refresh'; refreshToken: string }

type TokenFetch = (url: URL, options: RequestInit) => Promise<Response>

interface DonationOAuthOptions {
  request?: TokenFetch
  now?: () => number
}

type OAuthFailure = 'invalid_session' | 'refresh_rejected' | 'provider_unavailable'

export class DonationOAuthFailure extends Error {
  constructor(readonly code: OAuthFailure) {
    super(code)
  }
}

export function donationRedirectUri(provider: OAuthDonationProvider) {
  return z.url().refine((value) => {
    const url = new URL(value)
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && local)) &&
      url.pathname === `/auth/donations/${provider}/callback` &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  }, `Use the exact OAuth callback URL ending in /auth/donations/${provider}/callback.`)
}

function signState(payload: string, client: DonationOAuthClient): string {
  return createHmac('sha256', client.clientSecret)
    .update('twirchat-donation-oauth/state/v1:')
    .update(client.clientId)
    .update(':')
    .update(client.redirectUri)
    .update(':')
    .update(payload)
    .digest('base64url')
}

function verifyState(state: string, client: DonationOAuthClient, now: number) {
  const parts = state.split('.')
  const parsed = stateParts.safeParse(parts)
  if (!parsed.success) return undefined
  const [, provider, expiresAt, port, challenge, signature] = parsed.data
  if (provider !== client.provider || expiresAt <= now) return undefined
  const expected = signState(parts.slice(0, -1).join('.'), client)
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return undefined
  return { port, challenge }
}

function ticketKey(client: DonationOAuthClient): Buffer {
  return createHmac('sha256', client.clientSecret)
    .update('twirchat-donation-oauth/ticket/v1')
    .digest()
}

// Keep the upstream code out of the local HTTP redirect and bind the ticket to one state.
function sealCode(code: string, state: string, client: DonationOAuthClient): string {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', ticketKey(client), nonce)
  cipher.setAAD(Buffer.from(state))
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url')
}

function openTicket(ticket: string, state: string, client: DonationOAuthClient): string {
  const bytes = Buffer.from(ticket, 'base64url')
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      ticketKey(client),
      bytes.subarray(0, NONCE_BYTES),
    )
    decipher.setAAD(Buffer.from(state))
    decipher.setAuthTag(bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES))
    return Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new DonationOAuthFailure('invalid_session')
  }
}

export function createDonationOAuth({
  request = fetch,
  now = Date.now,
}: DonationOAuthOptions = {}) {
  async function requestTokens(
    client: DonationOAuthClient,
    grant: TokenGrant,
  ): Promise<DonationOAuthTokens> {
    const body = new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
    })
    if (grant.kind === 'code') {
      body.set('grant_type', 'authorization_code')
      body.set('code', grant.code)
      body.set('redirect_uri', client.redirectUri)
    } else {
      body.set('grant_type', 'refresh_token')
      body.set('refresh_token', grant.refreshToken)
      if (client.provider === 'donationalerts') body.set('scope', SCOPE)
    }
    const response = await request(new URL('/oauth/token', PROVIDER_ORIGINS[client.provider]), {
      method: 'POST',
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new DonationOAuthFailure('provider_unavailable')
    })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      if (grant.kind === 'refresh' && invalidRefreshResponse.safeParse(value).success)
        throw new DonationOAuthFailure('refresh_rejected')
      throw new DonationOAuthFailure('provider_unavailable')
    }
    const parsed = tokenResponse.safeParse(value)
    if (!parsed.success) throw new DonationOAuthFailure('provider_unavailable')
    const { access_token, refresh_token, expires_in } = parsed.data
    const refreshToken = refresh_token ?? (grant.kind === 'refresh' ? grant.refreshToken : null)
    if (!refreshToken) throw new DonationOAuthFailure('provider_unavailable')
    return {
      accessToken: access_token,
      refreshToken,
      expiresAt: now() + expires_in * 1000,
    }
  }

  return {
    start: (client: DonationOAuthClient, input: { codeChallenge: string; port: number }) => {
      const payload = `v1.${client.provider}.${now() + STATE_TTL_MS}.${input.port}.${input.codeChallenge}`
      const state = `${payload}.${signState(payload, client)}`
      const url = new URL('/oauth/authorize', PROVIDER_ORIGINS[client.provider])
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        response_type: 'code',
        scope: SCOPE,
        state,
      }).toString()
      return { url: url.href, state }
    },
    callback(client: DonationOAuthClient, url: URL): URL | undefined {
      const state = donationRelayState.safeParse(url.searchParams.get('state'))
      if (!state.success) return undefined
      const session = verifyState(state.data, client, now())
      if (!session) return undefined
      const callback = new URL(LOOPBACK_CALLBACK, `http://127.0.0.1:${session.port}`)
      callback.searchParams.set('state', state.data)
      const code = providerCode.safeParse(url.searchParams.get('code'))
      if (code.success && !url.searchParams.has('error'))
        callback.searchParams.set('ticket', sealCode(code.data, state.data, client))
      else callback.searchParams.set('error', 'access_denied')
      return callback
    },
    exchange: async (
      client: DonationOAuthClient,
      input: { codeVerifier: string; state: string; ticket: string },
    ): Promise<DonationOAuthTokens> => {
      const session = verifyState(input.state, client, now())
      if (!session || generateCodeChallenge(input.codeVerifier) !== session.challenge)
        throw new DonationOAuthFailure('invalid_session')
      const code = openTicket(input.ticket, input.state, client)
      return requestTokens(client, { kind: 'code', code })
    },
    refresh: (
      client: DonationOAuthClient,
      input: { refreshToken: string },
    ): Promise<DonationOAuthTokens> =>
      requestTokens(client, { kind: 'refresh', refreshToken: input.refreshToken }),
  }
}
