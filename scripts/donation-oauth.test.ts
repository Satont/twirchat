import { expect, test } from 'bun:test'

import {
  createDonationOAuthFixture,
  redirectUri,
} from '../packages/backend/tests/donation-oauth-fixture'
import {
  authorizeDonation,
  DonationOAuthNotEnabled,
  DonationOAuthReconnectRequired,
  getDonationOAuthAvailability,
  refreshDonation,
} from '../packages/desktop/src/auth/donations'
import { getRuntimeConfig, setRuntimeConfig } from '../packages/desktop/src/runtime-config'

test('desktop reads OAuth availability and handles a disabled provider before opening the browser', async () => {
  const { server } = createDonationOAuthFixture({ memealertsConfigured: false })
  const previous = getRuntimeConfig()
  setRuntimeConfig({ backendUrl: server.url.origin, clientSecret: 'desktop-test' })
  try {
    expect(await getDonationOAuthAvailability()).toEqual({
      donationalerts: true,
      memealerts: false,
    })
    await expect(
      authorizeDonation({
        provider: 'memealerts',
        signal: AbortSignal.timeout(2000),
        openBrowser: async () => {
          throw new Error('Unexpected browser launch')
        },
      }),
    ).rejects.toBeInstanceOf(DonationOAuthNotEnabled)
  } finally {
    setRuntimeConfig(previous)
    await server.stop(true)
  }
})

test('desktop treats older or malformed availability responses as unknown', async () => {
  const previous = getRuntimeConfig()
  let response = new Response(null, { status: 404 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => response,
  })
  setRuntimeConfig({ backendUrl: server.url.origin })
  try {
    expect(await getDonationOAuthAvailability()).toBeNull()
    response = Response.json({ donationalerts: true, memealerts: 'false' })
    expect(await getDonationOAuthAvailability()).toBeNull()
  } finally {
    setRuntimeConfig(previous)
    await server.stop(true)
  }
})

test('donation OAuth relays an opaque ticket to the desktop and preserves an unrotated refresh token', async () => {
  const { server, requests, relay, rejectRefresh } = createDonationOAuthFixture()
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
