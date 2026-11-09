import { expect, test } from 'bun:test'

import { z } from 'zod'

import { donationRedirectUri } from '../src/auth/donations'
import { generateCodeChallenge, generateCodeVerifier } from '../src/auth/pkce'
import {
  callbackPath,
  createDonationOAuthFixture,
  redirectUri,
  routeBase,
} from './donation-oauth-fixture'

const startResult = z.object({ url: z.url(), state: z.string() })

test('donation OAuth rejects expired or altered state, mismatched verifier and cross-session tickets', async () => {
  const { server, requests, relay, post, expire } = createDonationOAuthFixture()
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
