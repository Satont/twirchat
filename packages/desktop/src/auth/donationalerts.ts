import { z } from 'zod'

import { getDonationAlertsDesktopClientId } from './client-config'
import { generateState } from './pkce'

const PORT = 45826
const HOST = `localhost:${PORT}`
const ORIGIN = `http://${HOST}`
const CALLBACK_PATH = '/auth/donationalerts/implicit'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const bearerToken = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9._~+/-]+=*$/u)

export const donationAlertsAccessTokenSchema = z.object({
  accessToken: bearerToken,
  expiresAt: z.number().int().positive(),
})

export type DonationAlertsAccessToken = z.infer<typeof donationAlertsAccessTokenSchema>

const callbackToken = z.object({
  access_token: bearerToken,
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  expires_in: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().positive().max(1_000_000_000)),
})

const privateHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Connection: 'close',
}

interface AuthorizeDonationAlertsOptions {
  signal: AbortSignal
  openBrowser: (url: string) => Promise<void>
}

export class DonationAlertsAuthError extends Error {}

function reply(message: string, status = 200): Response {
  return new Response(message, { status, headers: privateHeaders })
}

function callbackPage(nonce: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>TwirChat DonationAlerts sign-in</title>
<body>Completing DonationAlerts sign-in…
<script nonce="${nonce}">
  const form = new URLSearchParams(location.hash.slice(1));
  if (!location.hash) {
    const query = new URLSearchParams(location.search);
    if (query.has('error')) {
      form.set('error', 'access_denied');
      form.set('state', query.get('state') ?? '');
    }
  }
  history.replaceState(null, '', location.pathname);
  fetch(location.pathname, { method: 'POST', body: form }).then((response) => {
    document.body.textContent = response.ok
      ? 'Sign-in received. You can close this tab and return to TwirChat.'
      : 'Sign-in did not complete. Return to TwirChat to try again.';
  }).catch(() => {
    document.body.textContent = 'Return to TwirChat to check your sign-in.';
  });
</script></body></html>`,
    {
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  )
}

function listen(fetch: (request: Request) => Promise<Response>) {
  try {
    return Bun.serve({
      hostname: '127.0.0.1',
      port: PORT,
      maxRequestBodySize: 16_384,
      idleTimeout: 5,
      fetch,
    })
  } catch {
    throw new DonationAlertsAuthError(
      `Could not open the local DonationAlerts sign-in port ${PORT}. Try again.`,
    )
  }
}

export async function authorizeDonationAlerts({
  signal,
  openBrowser,
}: AuthorizeDonationAlertsOptions): Promise<DonationAlertsAccessToken> {
  signal.throwIfAborted()
  const clientId = getDonationAlertsDesktopClientId()
  if (!clientId) throw new DonationAlertsAuthError('DonationAlerts is not enabled yet.')

  const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
  const cancellation = AbortSignal.any([signal, timeout])
  const state = generateState()
  const nonce = generateState()
  const callback = Promise.withResolvers<DonationAlertsAccessToken>()
  let consumed = false
  const server = listen(async (request) => {
    if (request.headers.get('host') !== HOST || new URL(request.url).pathname !== CALLBACK_PATH)
      return reply('Not found.', 404)
    if (consumed || cancellation.aborted) return reply('This sign-in has ended.', 410)
    if (request.method === 'GET') return callbackPage(nonce)
    if (request.method !== 'POST' || request.headers.get('origin') !== ORIGIN)
      return reply('Invalid sign-in request.', 403)

    const body = await request.text().catch(() => '')
    const form = new URLSearchParams(body)
    if (consumed || cancellation.aborted) return reply('This sign-in has ended.', 410)
    if (form.get('state') !== state) return reply('Invalid sign-in state.', 400)
    consumed = true
    const grant = callbackToken.safeParse({
      access_token: form.get('access_token'),
      token_type: form.get('token_type'),
      expires_in: form.get('expires_in'),
    })
    if (form.has('error') || !grant.success) {
      callback.reject(new DonationAlertsAuthError('DonationAlerts sign-in did not complete.'))
      return reply('Sign-in did not complete.', 400)
    }
    callback.resolve({
      accessToken: grant.data.access_token,
      expiresAt: Date.now() + grant.data.expires_in * 1000,
    })
    return reply('Sign-in received.')
  })

  const authorize = new URL('https://www.donationalerts.com/oauth/authorize')
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ORIGIN + CALLBACK_PATH,
    response_type: 'token',
    scope: 'oauth-user-show oauth-donation-subscribe',
    state,
  }).toString()

  let stopping: Promise<void> | undefined
  const cancel = () => {
    callback.reject(cancellation.reason)
    stopping ??= server.stop(true)
    stopping.catch(() => {})
  }
  cancellation.addEventListener('abort', cancel, { once: true })
  try {
    Promise.resolve()
      .then(() => {
        cancellation.throwIfAborted()
        return openBrowser(authorize.href)
      })
      .catch(() => {
        callback.reject(new DonationAlertsAuthError('Could not open your browser. Try again.'))
      })
    const token = await callback.promise
    cancellation.throwIfAborted()
    return token
  } catch (error) {
    if (timeout.aborted)
      throw new DonationAlertsAuthError('DonationAlerts sign-in timed out. Try again.')
    throw error
  } finally {
    cancellation.removeEventListener('abort', cancel)
    await (stopping ?? server.stop())
  }
}
