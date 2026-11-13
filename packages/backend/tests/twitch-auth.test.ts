import { afterEach, expect, test } from 'bun:test'

import { TWITCH_TOKEN_URL } from '@twirchat/shared/constants'
import { TWITCH_SCOPES } from '@twirchat/shared/twitch-scopes'

import { buildTwitchAuthUrl } from '../src/auth/twitch.ts'
import { authRoutes } from '../src/routes/auth.ts'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockTwitchToken(handler: (form: URLSearchParams) => Response) {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      expect(input instanceof Request ? input.url : input.toString()).toBe(TWITCH_TOKEN_URL)
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected an OAuth form.')
      return handler(init.body)
    },
    { preconnect: originalFetch.preconnect },
  )
}

function refresh(refreshToken: string) {
  return authRoutes['/api/auth/twitch/refresh'].POST(
    new Request('http://backend.test/api/auth/twitch/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  )
}

test('Twitch authorize URL carries the PKCE challenge and every desktop scope', () => {
  const url = new URL(
    buildTwitchAuthUrl('challenge', 'state', 'http://localhost:45821/auth/twitch/callback').url,
  )
  expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize')
  expect(url.searchParams.get('client_id')).toBe('test-twitch-client-id')
  expect(url.searchParams.get('code_challenge')).toBe('challenge')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('scope')?.split(' ')).toEqual([...TWITCH_SCOPES])
  expect(url.searchParams.has('client_secret')).toBe(false)
})

test('Twitch refresh signs the request with the client secret', async () => {
  mockTwitchToken((form) => {
    expect(form.get('client_id')).toBe('test-twitch-client-id')
    expect(form.get('client_secret')).toBe('test-twitch-client-secret')
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('refresh-1')
    return Response.json({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 14_000,
    })
  })
  const res = await refresh('refresh-1')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresIn: 14_000,
  })
})

test('Twitch refresh passes a refusal through and reports outages separately', async () => {
  mockTwitchToken(() =>
    Response.json({ status: 400, message: 'Invalid refresh token' }, { status: 400 }),
  )
  const rejected = await refresh('revoked')
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toEqual({
    error: 'twitch_rejected',
    message: 'Invalid refresh token',
  })

  mockTwitchToken(() => new Response('upstream down', { status: 503 }))
  const outage = await refresh('refresh-1')
  expect(outage.status).toBe(502)
})
