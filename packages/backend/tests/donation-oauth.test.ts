import { expect, test } from 'bun:test'

import { z } from 'zod'

import { memeAlertsRedirectUri } from '../src/auth/donations'
import { generateCodeChallenge, generateCodeVerifier } from '../src/auth/pkce'
import {
  callbackPath,
  createDonationOAuthFixture,
  redirectUri,
  routeBase,
} from './donation-oauth-fixture'

const startResult = z.object({ url: z.url(), state: z.string() })

test.each([[true], [false]])(
  'donation OAuth availability reports the MemeAlerts configuration to authenticated clients',
  async (memealertsConfigured) => {
    const { server } = createDonationOAuthFixture({ memealertsConfigured })
    try {
      const url = new URL('/api/auth/donations/availability', server.url)
      expect((await fetch(url)).status).toBe(401)
      const response = await fetch(url, { headers: { 'X-Client-Secret': 'desktop-test' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        donationalerts: false,
        memealerts: memealertsConfigured,
      })
    } finally {
      await server.stop(true)
    }
  },
)

test('retired DonationAlerts server OAuth routes return 404', async () => {
  const { server, authCalls } = createDonationOAuthFixture()
  try {
    const responses = await Promise.all([
      ...['start', 'exchange', 'refresh'].map((endpoint) =>
        fetch(new URL(`/api/auth/donations/donationalerts/${endpoint}`, server.url), {
          method: 'POST',
          headers: { 'X-Client-Secret': 'desktop-test' },
        }),
      ),
      fetch(new URL('/auth/donations/donationalerts/callback', server.url)),
    ])
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404])
    expect(authCalls()).toBe(0)
  } finally {
    await server.stop(true)
  }
})

test('donation OAuth rejects expired or altered state, mismatched verifier and cross-session tickets', async () => {
  const { server, requests, relay, post, expire } = createDonationOAuthFixture()
  try {
    const verifier = generateCodeVerifier()
    const start = await post('start', {
      codeChallenge: generateCodeChallenge(verifier),
      port: 42123,
    })
    const { state } = startResult.parse(await start.json())
    expect(state.startsWith('v1.memealerts.')).toBe(true)
    expect((await relay(`${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`)).status).toBe(
      400,
    )
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
  const uri = memeAlertsRedirectUri
  expect(uri.safeParse(redirectUri).success).toBe(true)
  expect(uri.safeParse(`http://127.0.0.1:3000${callbackPath}`).success).toBe(true)
  expect(uri.safeParse(`http://chat.example.com${callbackPath}`).success).toBe(false)
  expect(uri.safeParse(`${redirectUri}?code=anything`).success).toBe(false)
  expect(uri.safeParse(redirectUri.replace('memealerts', 'donationalerts')).success).toBe(false)
})

test('donation OAuth rejects invalid and oversized streamed requests before registering clients', async () => {
  const { server, post, authCalls } = createDonationOAuthFixture()
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
