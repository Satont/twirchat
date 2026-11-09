import {
  DONATION_PROVIDER_LABELS,
  type DonationOAuthAvailability,
  type DonationOAuthTokens,
  type OAuthDonationProvider,
} from '@twirchat/shared/donations'
import { z } from 'zod'

import { backendFetch, getBackendUrl } from '../runtime-config'
import { generateCodeChallenge, generateCodeVerifier } from './pkce'

const PROVIDER_ORIGINS: Record<OAuthDonationProvider, string> = {
  donationalerts: 'https://www.donationalerts.com',
  memealerts: 'https://memealerts.com',
}
const CALLBACK_PATH = '/auth/donations/callback'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const AVAILABILITY_TIMEOUT_MS = 4_000
const startResponse = z.object({ url: z.url(), state: z.string().min(1).max(256) })
const availabilityResponse = z.object({ donationalerts: z.boolean(), memealerts: z.boolean() })
export const donationOAuthTokensSchema = z.object({
  accessToken: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9._~+/-]+=*$/u),
  refreshToken: z.string().min(1).max(4096),
  expiresAt: z.number().int().positive(),
})
const failureResponse = z.object({
  error: z.enum(['unconfigured', 'invalid_session', 'refresh_rejected']),
})
const relayTicket = z
  .string()
  .min(39)
  .max(5500)
  .regex(/^[\w-]+$/u)

interface AuthorizeDonationOptions {
  provider: OAuthDonationProvider
  signal: AbortSignal
  openBrowser: (url: string) => Promise<void>
}

interface RefreshDonationOptions {
  provider: OAuthDonationProvider
  refreshToken: string
  signal: AbortSignal
}

type OAuthEndpoint = 'start' | 'exchange' | 'refresh'

export class DonationOAuthError extends Error {}

export class DonationOAuthNotEnabled extends DonationOAuthError {
  constructor(provider: OAuthDonationProvider) {
    super(`${DONATION_PROVIDER_LABELS[provider]} is not enabled yet.`)
  }
}

export class DonationOAuthReconnectRequired extends DonationOAuthError {
  constructor(provider: OAuthDonationProvider) {
    super(`${DONATION_PROVIDER_LABELS[provider]} authorization expired. Connect again.`)
  }
}

function secureBackend(): boolean {
  const url = URL.parse(getBackendUrl())
  return Boolean(
    url &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))),
  )
}

export async function getDonationOAuthAvailability(): Promise<DonationOAuthAvailability | null> {
  if (!secureBackend()) return null
  try {
    const response = await backendFetch('/api/auth/donations/availability', {
      redirect: 'manual',
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const parsed = availabilityResponse.safeParse(body)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function requestOAuth<T>(
  provider: OAuthDonationProvider,
  endpoint: OAuthEndpoint,
  fields: Record<string, string | number>,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  if (!secureBackend())
    throw new DonationOAuthError('Donation sign-in requires an HTTPS TwirChat backend.')
  const label = DONATION_PROVIDER_LABELS[provider]
  const response = await backendFetch(`/api/auth/donations/${provider}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  }).catch(() => {
    signal.throwIfAborted()
    throw new DonationOAuthError('Could not reach the TwirChat backend. Try again.')
  })
  const body: unknown = await response.json().catch(() => null)
  signal.throwIfAborted()
  if (!response.ok) {
    const failure = failureResponse.safeParse(body)
    if (failure.success) {
      switch (failure.data.error) {
        case 'unconfigured':
          throw new DonationOAuthNotEnabled(provider)
        case 'invalid_session':
          throw new DonationOAuthError(`${label} sign-in expired. Try again.`)
        case 'refresh_rejected':
          if (endpoint === 'refresh') throw new DonationOAuthReconnectRequired(provider)
      }
    }
    throw new DonationOAuthError(`Could not authorize ${label}. Try again.`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new DonationOAuthError(`Invalid ${label} authorization response.`)
  return parsed.data
}

function callbackReply(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Connection: 'close' },
  })
}

export async function authorizeDonation({
  provider,
  signal,
  openBrowser,
}: AuthorizeDonationOptions): Promise<DonationOAuthTokens> {
  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
  const cancellation = AbortSignal.any([signal, timeout])
  cancellation.throwIfAborted()
  const label = DONATION_PROVIDER_LABELS[provider]
  const verifier = generateCodeVerifier()
  const callback = Promise.withResolvers<string>()
  let state: string | undefined
  let consumed = false
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH)
        return callbackReply('Not found.', 404)
      if (!state || consumed || cancellation.aborted || url.searchParams.get('state') !== state)
        return callbackReply('This TwirChat sign-in request is invalid or expired.', 400)
      consumed = true
      const ticket = relayTicket.safeParse(url.searchParams.get('ticket'))
      if (!ticket.success || url.searchParams.has('error')) {
        callback.reject(new DonationOAuthError(`${label} sign-in did not complete.`))
        return callbackReply('Sign-in did not complete. Return to TwirChat to try again.', 400)
      }
      callback.resolve(ticket.data)
      return callbackReply('Sign-in received. You can close this tab and return to TwirChat.')
    },
  })
  const cancel = () => callback.reject(cancellation.reason)
  try {
    const start = await requestOAuth(
      provider,
      'start',
      { codeChallenge: generateCodeChallenge(verifier), port: Number(server.url.port) },
      startResponse,
      cancellation,
    )
    const authorize = new URL(start.url)
    if (
      authorize.origin !== PROVIDER_ORIGINS[provider] ||
      authorize.pathname !== '/oauth/authorize' ||
      authorize.username ||
      authorize.password ||
      authorize.searchParams.get('state') !== start.state
    ) {
      throw new DonationOAuthError(`Invalid ${label} authorization URL.`)
    }

    cancellation.throwIfAborted()
    state = start.state
    cancellation.addEventListener('abort', cancel, { once: true })
    openBrowser(authorize.href).catch(() => {
      callback.reject(new DonationOAuthError('Could not open your browser. Try again.'))
    })
    const ticket = await callback.promise
    return await requestOAuth(
      provider,
      'exchange',
      { codeVerifier: verifier, state, ticket },
      donationOAuthTokensSchema,
      cancellation,
    )
  } catch (error) {
    if (timeout.aborted) throw new DonationOAuthError(`${label} sign-in timed out. Try again.`)
    throw error
  } finally {
    cancellation.removeEventListener('abort', cancel)
    await server.stop(true)
  }
}

export function refreshDonation({
  provider,
  refreshToken,
  signal,
}: RefreshDonationOptions): Promise<DonationOAuthTokens> {
  return requestOAuth(provider, 'refresh', { refreshToken }, donationOAuthTokensSchema, signal)
}
