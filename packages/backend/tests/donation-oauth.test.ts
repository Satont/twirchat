import { expect, test } from 'bun:test'

import { z } from 'zod'

import {
  authorizeDonation,
  DonationOAuthReconnectRequired,
  refreshDonation,
} from '../../desktop/src/auth/donations'
import { getRuntimeConfig, setRuntimeConfig } from '../../desktop/src/runtime-config'
import { createDonationOAuth, donationRedirectUri } from '../src/auth/donations'
import { generateCodeChallenge, generateCodeVerifier } from '../src/auth/pkce'
import { createDonationOAuthRoutes } from '../src/routes/donations'

const callbackPath = '/auth/donations/donationalerts/callback'
const redirectUri = `https://chat.example.com${callbackPath}`
const routeBase = '/api/auth/donations/donationalerts'
const startResult = z.object({ url: z.url(), state: z.string() })

function fixture() {
  let time = Date.now()
  let refreshRejected = false
  let authCalls = 0
  const requests: Array<{ url: string; fields: URLSearchParams }> = []
  const oauth = createDonationOAuth({
    now: () => time,
    async request(url, options) {
      expect(options.redirect).toBe('manual')
      const fields = options.body
      if (!(fields instanceof URLSearchParams)) throw new Error('Expected OAuth form')
      requests.push({ url: url.href, fields })
      if (fields.get('grant_type') === 'refresh_token') {
        if (refreshRejected)
          return Response.json({ error: 'invalid_grant', detail: 'private-token' }, { status: 400 })
        return Response.json({ access_token: 'renewed', token_type: 'Bearer', expires_in: 3600 })
      }
      return Response.json({
        access_token: 'initial',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-secret',
      })
    },
  })
  const credentials = { clientId: 'client-id', clientSecret: 'client-secret', redirectUri }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    routes: createDonationOAuthRoutes(
      {
        donationalerts: credentials,
        memealerts: {
          ...credentials,
          redirectUri: 'https://chat.example.com/auth/donations/memealerts/callback',
        },
      },
      oauth,
      async (req) => {
        authCalls++
        return req.headers.get('X-Client-Secret')
          ? { clientSecret: 'desktop-test' }
          : new Response(null, { status: 401 })
      },
    ),
  })
  return {
    server,
    requests,
    authCalls: () => authCalls,
    expire: () => (time += 5 * 60_000),
    rejectRefresh: () => (refreshRejected = true),
    post: (endpoint: string, body: unknown) =>
      fetch(new URL(`${routeBase}/${endpoint}`, server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Secret': 'desktop-test' },
        body: JSON.stringify(body),
      }),
    relay: (state: string, path = callbackPath) => {
      const url = new URL(path, server.url)
      url.search = new URLSearchParams({ state, code: 'upstream-authorization-code' }).toString()
      return fetch(url, { redirect: 'manual' })
    },
  }
}

test('donation OAuth relays an opaque ticket to the desktop and preserves an unrotated refresh token', async () => {
  const { server, requests, relay, rejectRefresh } = fixture()
  const previous = getRuntimeConfig()
  setRuntimeConfig({ backendUrl: server.url.origin, clientSecret: 'desktop-test' })
  const cancellation = new AbortController()
  const opened = Promise.withResolvers<URL>()
  const signIn = authorizeDonation({
    provider: 'donationalerts',
    signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(2000)]),
    async openBrowser(url) {
      opened.resolve(new URL(url))
    },
  })
  try {
    const authorize = await Promise.race([
      opened.promise,
      signIn.then(() => new URL('about:blank')),
    ])
    expect(authorize.origin + authorize.pathname).toBe(
      'https://www.donationalerts.com/oauth/authorize',
    )
    expect(authorize.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(authorize.searchParams.get('scope')).toBe('oauth-user-show oauth-donation-subscribe')
    expect(authorize.href).not.toContain('client-secret')
    const callback = await relay(authorize.searchParams.get('state') ?? '')
    expect(callback.status).toBe(303)
    expect(callback.headers.get('cache-control')).toBe('no-store')
    expect(callback.headers.get('referrer-policy')).toBe('no-referrer')
    const location = new URL(callback.headers.get('location') ?? '')
    expect(location.hostname).toBe('127.0.0.1')
    expect(location.pathname).toBe('/auth/donations/callback')
    expect(location.href).not.toContain('upstream-authorization-code')
    const invalid = new URL(location)
    invalid.searchParams.set('state', 'invalid')
    expect((await fetch(invalid)).status).toBe(400)
    expect(requests).toHaveLength(0)

    expect((await fetch(location)).status).toBe(200)
    const tokens = await signIn
    expect(tokens).toMatchObject({ accessToken: 'initial', refreshToken: 'refresh-secret' })
    await expect(fetch(location)).rejects.toThrow()
    expect(requests[0]?.url).toBe('https://www.donationalerts.com/oauth/token')
    expect(Object.fromEntries(requests[0]?.fields ?? [])).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      grant_type: 'authorization_code',
      code: 'upstream-authorization-code',
      redirect_uri: redirectUri,
    })

    const refreshOptions = {
      provider: 'donationalerts',
      refreshToken: tokens.refreshToken,
      signal: AbortSignal.timeout(2000),
    } satisfies Parameters<typeof refreshDonation>[0]
    expect(await refreshDonation(refreshOptions)).toMatchObject({
      accessToken: 'renewed',
      refreshToken: 'refresh-secret',
    })
    expect(requests[1]?.fields.get('scope')).toBe('oauth-user-show oauth-donation-subscribe')
    rejectRefresh()
    await expect(refreshDonation(refreshOptions)).rejects.toBeInstanceOf(
      DonationOAuthReconnectRequired,
    )
  } finally {
    cancellation.abort()
    await signIn.catch(() => {})
    setRuntimeConfig(previous)
    await server.stop(true)
  }
})

test('donation OAuth rejects expired or altered state, mismatched verifier and cross-session tickets', async () => {
  const { server, requests, relay, post, expire } = fixture()
  try {
    const verifier = generateCodeVerifier()
    const start = await post('start', {
      codeChallenge: generateCodeChallenge(verifier),
      port: 42123,
    })
    const { state } = startResult.parse(await start.json())
    expect((await relay(`${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`)).status).toBe(
      400,
    )
    expect((await relay(state, '/auth/donations/memealerts/callback')).status).toBe(400)
    const callback = await relay(state)
    const location = new URL(callback.headers.get('location') ?? '')
    expect(location.port).toBe('42123')
    const ticket = location.searchParams.get('ticket')
    expect(
      (await post('exchange', { state, ticket, codeVerifier: generateCodeVerifier() })).status,
    ).toBe(400)
    const other = startResult.parse(
      await (
        await post('start', { codeChallenge: generateCodeChallenge(verifier), port: 42124 })
      ).json(),
    )
    expect(
      (await post('exchange', { state: other.state, ticket, codeVerifier: verifier })).status,
    ).toBe(400)
    expire()
    expect((await relay(state)).status).toBe(400)
    expect((await post('exchange', { state, ticket, codeVerifier: verifier })).status).toBe(400)
    expect(requests).toHaveLength(0)
  } finally {
    await server.stop(true)
  }
})

test('donation OAuth only accepts the registered callback path over HTTPS or loopback HTTP', () => {
  const uri = donationRedirectUri('donationalerts')
  expect(uri.safeParse(redirectUri).success).toBe(true)
  expect(uri.safeParse(`http://127.0.0.1:3000${callbackPath}`).success).toBe(true)
  expect(uri.safeParse(`http://chat.example.com${callbackPath}`).success).toBe(false)
  expect(uri.safeParse(`${redirectUri}?code=anything`).success).toBe(false)
  expect(uri.safeParse(redirectUri.replace('donationalerts', 'memealerts')).success).toBe(false)
})

test('donation OAuth rejects invalid and oversized streamed requests before registering clients', async () => {
  const { server, post, authCalls } = fixture()
  try {
    expect((await post('start', { codeChallenge: 'invalid', port: 0 })).status).toBe(400)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8192))
        controller.enqueue(new Uint8Array(8192))
        controller.enqueue(new Uint8Array(8192))
        controller.close()
      },
    })
    const response = await fetch(new URL(`${routeBase}/start`, server.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Secret': 'desktop-test' },
      body,
    })
    expect(response.status).toBe(413)
    expect(authCalls()).toBe(0)
  } finally {
    await server.stop(true)
  }
})
