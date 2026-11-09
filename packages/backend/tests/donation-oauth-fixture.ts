import { expect } from 'bun:test'

import { createDonationOAuth } from '../src/auth/donations'
import { createDonationOAuthRoutes } from '../src/routes/donations'

export const callbackPath = '/auth/donations/donationalerts/callback'
export const redirectUri = `https://chat.example.com${callbackPath}`
export const routeBase = '/api/auth/donations/donationalerts'

export function createDonationOAuthFixture() {
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
