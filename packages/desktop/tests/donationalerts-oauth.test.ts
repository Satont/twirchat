import { afterEach, beforeEach, expect, test } from 'bun:test'

import { authorizeDonationAlerts, DonationAlertsAuthError } from '../src/auth/donationalerts'

const redirect = 'http://localhost:45826/auth/donationalerts/implicit'
const origin = new URL(redirect).origin
const originalClientId = process.env.TWIRCHAT_DONATIONALERTS_CLIENT_ID

beforeEach(() => {
  process.env.TWIRCHAT_DONATIONALERTS_CLIENT_ID = '123456'
})

afterEach(() => {
  if (originalClientId === undefined) delete process.env.TWIRCHAT_DONATIONALERTS_CLIENT_ID
  else process.env.TWIRCHAT_DONATIONALERTS_CLIENT_ID = originalClientId
})

function beginSignIn() {
  const controller = new AbortController()
  const browser = Promise.withResolvers<URL>()
  const result = authorizeDonationAlerts({
    signal: controller.signal,
    openBrowser: async (url) => browser.resolve(new URL(url)),
  })
  const authorization = Promise.race([
    browser.promise,
    result.then(() => {
      throw new Error('Sign-in finished before opening the browser.')
    }),
  ])
  return {
    result,
    authorization,
    async cancel() {
      controller.abort(new Error('Canceled'))
      await result.catch(() => {})
    },
  }
}

function postCallback(body: URLSearchParams, callbackOrigin = origin) {
  return fetch(redirect, { method: 'POST', headers: { Origin: callbackOrigin }, body })
}

test('DonationAlerts accepts a single local implicit grant with the requested state', async () => {
  const signIn = beginSignIn()
  try {
    const authorization = await signIn.authorization
    expect(authorization.origin + authorization.pathname).toBe(
      'https://www.donationalerts.com/oauth/authorize',
    )
    expect(authorization.searchParams.get('redirect_uri')).toBe(redirect)
    expect(authorization.searchParams.get('response_type')).toBe('token')
    expect(authorization.searchParams.get('client_id')).toBe('123456')
    expect(authorization.searchParams.get('scope')).toBe('oauth-user-show oauth-donation-subscribe')
    expect(authorization.searchParams.has('client_secret')).toBe(false)
    const state = authorization.searchParams.get('state')
    if (!state) throw new Error('Expected an OAuth state.')

    const page = await fetch(redirect)
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await page.text()
    expect(html.indexOf('history.replaceState')).toBeGreaterThan(html.indexOf('location.hash'))
    expect(html.indexOf('fetch(location.pathname')).toBeGreaterThan(
      html.indexOf('history.replaceState'),
    )
    const alias = await fetch(redirect.replace('localhost', '127.0.0.1'))
    expect(alias.status).toBe(404)

    const form = new URLSearchParams({
      state: 'other-state',
      access_token: 'fixture-access-token',
      token_type: 'Bearer',
      expires_in: '31536000',
    })
    expect((await postCallback(form)).status).toBe(400)
    form.set('state', state)
    expect((await postCallback(form, 'https://www.donationalerts.com')).status).toBe(403)

    const before = Date.now()
    const reply = await postCallback(form)
    expect(reply.ok).toBe(true)
    expect(await reply.text()).not.toContain('fixture-access-token')
    const token = await signIn.result
    expect(token).toEqual({ accessToken: 'fixture-access-token', expiresAt: expect.any(Number) })
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 31_536_000_000)
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + 31_536_000_000)
    await expect(fetch(redirect)).rejects.toThrow()
  } finally {
    await signIn.cancel()
  }
})

test('DonationAlerts rejects a matching response without a valid access-token lifetime', async () => {
  const signIn = beginSignIn()
  try {
    const state = (await signIn.authorization).searchParams.get('state')
    if (!state) throw new Error('Expected an OAuth state.')
    const rejected = signIn.result.catch((error: unknown) => error)
    const reply = await postCallback(
      new URLSearchParams({ state, access_token: 'fixture-access-token', token_type: 'Bearer' }),
    )
    expect(reply.status).toBe(400)
    expect(await rejected).toBeInstanceOf(DonationAlertsAuthError)
  } finally {
    await signIn.cancel()
  }
})

test('canceling DonationAlerts releases the fixed loopback port for the next sign-in', async () => {
  const first = beginSignIn()
  await first.authorization
  const canceled = first.result.catch((error: unknown) => error)
  const stopping = first.cancel()
  const next = beginSignIn()
  try {
    await expect(next.authorization).resolves.toBeInstanceOf(URL)
    expect(await canceled).toEqual(new Error('Canceled'))
  } finally {
    await Promise.all([stopping, next.cancel()])
  }
})
