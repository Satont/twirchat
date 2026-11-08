import { z } from 'zod'

import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'

const CLIENT_ID = 'egf1qr_loCDEMb01_s1DfKLu2cbX9Hg4XhrusaO8qS0'
const RESOURCE = 'https://twir.app/api'
const SCOPE = 'files:edit'
const CALLBACK_PATH = '/auth/twir/callback'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 10_000
const bearerToken = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9._~+/-]+=*$/u)
const tokenResponse = z.object({
  access_token: bearerToken,
  refresh_token: bearerToken,
  expires_in: z.number().int().positive(),
  token_type: z.string().refine((type) => type.toLowerCase() === 'bearer'),
  scope: z.string().refine((scope) => scope.split(' ').includes(SCOPE)),
})
const expiredSessionResponse = z.object({ error: z.enum(['invalid_grant', 'invalid_token']) })

export const twirUploadTokens = z.object({
  accessToken: bearerToken,
  refreshToken: bearerToken,
  expiresAt: z.number().int().positive(),
})

export type TwirUploadTokens = z.infer<typeof twirUploadTokens>

interface SignInOptions {
  signal: AbortSignal
  openBrowser: (url: string) => Promise<void>
}

export class TwirReconnectRequired extends Error {
  constructor() {
    super('Your Twir session has expired. Reconnect in Settings → Chat → Image Uploader.')
  }
}

async function oauthPost(
  endpoint: 'token' | 'revoke',
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetch(`${RESOURCE}/oauth/${endpoint}`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
    redirect: 'manual',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch(() => {
    throw new Error('Could not reach Twir. Try again.')
  })
}

async function requestTokens(
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<TwirUploadTokens> {
  const response = await oauthPost('token', { ...fields, resource: RESOURCE }, signal)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (fields.grant_type === 'refresh_token' && expiredSessionResponse.safeParse(body).success)
      throw new TwirReconnectRequired()
    throw new Error('Twir could not authorize image uploads. Try again.')
  }
  const result = tokenResponse.safeParse(body)
  if (!result.success) throw new Error('Twir returned an invalid authorization response.')
  return {
    accessToken: result.data.access_token,
    refreshToken: result.data.refresh_token,
    expiresAt: Date.now() + result.data.expires_in * 1000,
  }
}

function callbackReply(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Connection: 'close' },
  })
}

export async function authorizeTwirUpload({
  signal,
  openBrowser,
}: SignInOptions): Promise<TwirUploadTokens> {
  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
  const cancellation = AbortSignal.any([signal, timeout])
  cancellation.throwIfAborted()
  const state = generateState()
  const verifier = generateCodeVerifier()
  const callback = Promise.withResolvers<string>()
  let consumed = false
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH)
        return callbackReply('Not found.', 404)
      if (consumed || cancellation.aborted || url.searchParams.get('state') !== state)
        return callbackReply('This Twir sign-in request is invalid or no longer active.', 400)

      consumed = true
      const code = url.searchParams.get('code')
      if (!code || url.searchParams.has('error')) {
        callback.reject(new Error('Twir sign-in was declined or did not complete.'))
        return callbackReply('Twir sign-in did not complete. Return to TwirChat to try again.', 400)
      }
      callback.resolve(code)
      return callbackReply('Twir sign-in received. You can close this tab and return to TwirChat.')
    },
  })
  const redirectUri = new URL(CALLBACK_PATH, server.url).href
  const authorize = new URL(`${RESOURCE}/oauth/authorize`)
  authorize.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    resource: RESOURCE,
    state,
    code_challenge: generateCodeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString()
  const cancel = () => callback.reject(cancellation.reason)
  cancellation.addEventListener('abort', cancel, { once: true })
  try {
    openBrowser(authorize.href).catch(() => {
      callback.reject(new Error('Could not open your browser. Try signing in again.'))
    })
    const code = await callback.promise
    return await requestTokens(
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      },
      cancellation,
    )
  } catch (error) {
    if (timeout.aborted)
      throw new Error('Twir sign-in timed out. Try signing in again.', { cause: error })
    throw error
  } finally {
    cancellation.removeEventListener('abort', cancel)
    await server.stop()
  }
}

export function refreshTwirUpload(refreshToken: string): Promise<TwirUploadTokens> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function revokeTwirUpload(refreshToken: string): Promise<void> {
  const response = await oauthPost('revoke', {
    token: refreshToken,
    token_type_hint: 'refresh_token',
  })
  await response.body?.cancel().catch(() => {})
  if (!response.ok) throw new Error('Twir could not revoke the upload session.')
}
