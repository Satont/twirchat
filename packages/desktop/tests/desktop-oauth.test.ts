import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TWITCH_TOKEN_URL,
  YOUTUBE_REDIRECT_URI,
  YOUTUBE_TOKEN_URL,
} from '@twirchat/shared/constants'

import {
  connectTwitchDevice,
  refreshTwitchToken,
  requestTwitchDeviceCode,
  waitForTwitchDeviceToken,
} from '../src/auth/twitch'
import { createTwitchChatAuthProvider } from '../src/auth/twitch-access-token'
import {
  connectTwitchPointsDevice,
  refreshTwitchPointsDevice,
  requestTwitchPointsDeviceCode,
  TWITCH_TV_CLIENT_ID,
} from '../src/auth/twitch-points'
import { getYouTubeAuthUrl, handleYouTubeCallback, refreshYouTubeToken } from '../src/auth/youtube'
import { AccountStore } from '../src/store/account-store'
import { getDb, initDb } from '../src/store/db'

const originalFetch = globalThis.fetch
const oauthEnvironment = {
  TWIRCHAT_TWITCH_CLIENT_ID: 'public-client',
  TWIRCHAT_YOUTUBE_CLIENT_ID: 'installed-client',
  TWIRCHAT_YOUTUBE_CLIENT_SECRET: 'installed-secret',
}
const savedEnvironment = Object.entries(oauthEnvironment).map(([key]) => [key, process.env[key]])
let directory = ''

beforeEach(() => {
  Object.assign(process.env, oauthEnvironment)
  directory = mkdtempSync(join(tmpdir(), 'twirchat-desktop-oauth-'))
  initDb(join(directory, 'db.sqlite'))
})
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of savedEnvironment) {
    if (key === undefined) continue
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      handler(input instanceof Request ? input.url : input.toString(), init),
    { preconnect: originalFetch.preconnect },
  )
}

function readForm(init?: RequestInit): URLSearchParams {
  expect(init?.method).toBe('POST')
  expect(init?.redirect).toBe('error')
  if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected an OAuth form.')
  return init.body
}

const code = {
  device_code: 'private-device-code',
  expires_in: 30,
  interval: 1,
  user_code: 'ABCD1234',
  verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCD1234',
}

test('Twitch device authorization polls Twitch and stores the validated user locally', async () => {
  let polls = 0
  let grantedScopes: string[] = []
  mockFetch(async (url, init) => {
    if (url === 'https://id.twitch.tv/oauth2/device') {
      const form = readForm(init)
      expect(form.get('client_id')).toBe('public-client')
      expect(form.has('client_secret')).toBe(false)
      expect(form.has('scope')).toBe(false)
      grantedScopes = form.get('scopes')?.split(' ') ?? []
      expect(grantedScopes).toContain('moderator:manage:chat_messages')
      expect(grantedScopes).toContain('moderator:manage:banned_users')
      return Response.json(code)
    }
    if (url === TWITCH_TOKEN_URL) {
      const form = readForm(init)
      expect(form.get('client_id')).toBe('public-client')
      expect(form.has('client_secret')).toBe(false)
      expect(form.get('device_code')).toBe(code.device_code)
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
      expect(form.get('scopes')).toBe(grantedScopes.join(' '))
      if (++polls === 1) return Response.json({ message: 'authorization_pending' }, { status: 400 })
      return Response.json({ access_token: 'twitch-access', refresh_token: 'twitch-refresh' })
    }
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('OAuth twitch-access')
      return Response.json({
        client_id: 'public-client',
        user_id: '42',
        login: 'twitchlogin',
        expires_in: 3600,
        scopes: grantedScopes,
      })
    }
    if (url === 'https://api.twitch.tv/helix/users?id=42') {
      const headers = new Headers(init?.headers)
      expect(headers.get('Client-Id')).toBe('public-client')
      expect(headers.get('Authorization')).toBe('Bearer twitch-access')
      return Response.json({ data: [{ display_name: 'Twitch Login' }] })
    }
    throw new Error(`Unexpected URL ${url}`)
  })

  const { signal } = new AbortController()
  const attempt = await requestTwitchDeviceCode(signal)
  expect(attempt.code.user_code).toBe(code.user_code)
  expect(attempt.code.verification_uri).toBe(code.verification_uri)
  await expect(connectTwitchDevice(attempt, signal)).resolves.toEqual({
    username: 'twitchlogin',
    displayName: 'Twitch Login',
    channelSlug: 'twitchlogin',
  })
  expect(polls).toBe(2)
  expect(AccountStore.findByPlatform('twitch')?.id).toBe('twitch:42')
  expect(AccountStore.getTokens('twitch:42')?.refreshToken).toBe('twitch-refresh')
})

test('Twitch rejects foreign verification links and cancels a poll before sending it', async () => {
  const controller = new AbortController()
  mockFetch(async () =>
    Response.json({ ...code, verification_uri: 'https://www.twitch.tv.example.invalid/activate' }),
  )
  await expect(requestTwitchDeviceCode(controller.signal)).rejects.toThrow()

  let requests = 0
  mockFetch(async () => {
    requests++
    return Response.json(code)
  })
  const attempt = await requestTwitchDeviceCode(controller.signal)
  const polling = waitForTwitchDeviceToken(attempt, controller.signal)
  controller.abort()
  await expect(polling).rejects.toThrow()
  expect(requests).toBe(1)
})

test('Twitch Channel Points use the Android TV device flow and validate the active identity', async () => {
  let polls = 0
  let deviceId: string | null = null
  mockFetch(async (url, init) => {
    const headers = new Headers(init?.headers)
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      expect(headers.get('Authorization')).toBe('OAuth points-access')
      return Response.json({
        client_id: TWITCH_TV_CLIENT_ID,
        user_id: '42',
        login: 'twitchlogin',
        expires_in: 0,
        scopes: ['channel:read:redemptions', 'channel:manage:redemptions'],
      })
    }

    const form = readForm(init)
    expect(form.get('client_id')).toBe(TWITCH_TV_CLIENT_ID)
    expect(form.has('client_secret')).toBe(false)
    expect(headers.get('Client-Id')).toBe(TWITCH_TV_CLIENT_ID)
    expect(headers.get('Origin')).toBe('https://android.tv.twitch.tv')
    expect(headers.get('Referer')).toBe('https://android.tv.twitch.tv/')
    expect(headers.get('User-Agent')).toContain('Android')
    if (url === 'https://id.twitch.tv/oauth2/device') {
      expect(form.get('scopes')).toBe('channel:read:redemptions channel:manage:redemptions')
      deviceId = headers.get('X-Device-Id')
      expect(deviceId).toMatch(/^[a-f0-9]{32}$/u)
      return Response.json({ ...code, verification_uri: 'https://www.twitch.tv/activate' })
    }

    expect(url).toBe(TWITCH_TOKEN_URL)
    expect(headers.get('X-Device-Id')).toBe(deviceId)
    expect(form.get('device_code')).toBe(code.device_code)
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(form.has('scopes')).toBe(false)
    if (++polls === 1) return Response.json({ message: 'authorization_pending' }, { status: 400 })
    return Response.json({ access_token: 'points-access' })
  })

  const { signal } = new AbortController()
  const attempt = await requestTwitchPointsDeviceCode(signal)
  expect(attempt.code.user_code).toBe(code.user_code)
  await expect(connectTwitchPointsDevice(attempt, '42', signal)).resolves.toEqual({
    token: 'points-access',
    userId: '42',
    username: 'twitchlogin',
    clientId: TWITCH_TV_CLIENT_ID,
    expiresAt: undefined,
    refreshToken: undefined,
  })
  expect(polls).toBe(2)
  expect(AccountStore.findByPlatform('twitch')).toBeNull()
})

test('Twitch Channel Points refresh rejects another identity and preserves an unrotated refresh token', async () => {
  mockFetch(async (url, init) => {
    if (url === 'https://id.twitch.tv/oauth2/validate')
      return Response.json({
        client_id: TWITCH_TV_CLIENT_ID,
        user_id: '51',
        login: 'viewer',
        expires_in: 0,
        scopes: null,
      })
    expect(url).toBe(TWITCH_TOKEN_URL)
    const form = readForm(init)
    expect(form.get('client_id')).toBe(TWITCH_TV_CLIENT_ID)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('points+refresh%')
    expect(form.has('client_secret')).toBe(false)
    return Response.json({ access_token: 'points-refreshed', expires_in: 60 })
  })

  const refreshToken = 'points+refresh%'
  await expect(refreshTwitchPointsDevice({ userId: '42', refreshToken })).rejects.toThrow(
    'connected Twitch account',
  )
  await expect(refreshTwitchPointsDevice({ userId: '51', refreshToken })).resolves.toMatchObject({
    token: 'points-refreshed',
    refreshToken,
    expiresAt: expect.any(Number),
  })
})

test('Twitch refresh is serialized and persists the rotated public-client token', async () => {
  AccountStore.upsert({
    id: 'twitch:42',
    platform: 'twitch',
    platformUserId: '42',
    username: 'twitchlogin',
    displayName: 'Twitch Login',
    accessToken: 'expired',
    refreshToken: 'refresh+encoded%',
  })
  let requests = 0
  const { promise, resolve } = Promise.withResolvers<Response>()
  mockFetch(async (url, init) => {
    requests++
    expect(url).toBe(TWITCH_TOKEN_URL)
    const form = readForm(init)
    expect(form.get('client_id')).toBe('public-client')
    expect(form.has('client_secret')).toBe(false)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('refresh+encoded%')
    return promise
  })
  const first = refreshTwitchToken('twitch:42')
  expect(refreshTwitchToken('twitch:42')).toBe(first)
  resolve(Response.json({ access_token: 'renewed', refresh_token: 'rotated', expires_in: 3600 }))
  await expect(first).resolves.toBe('renewed')
  expect(requests).toBe(1)
  expect(AccountStore.getTokens('twitch:42')?.refreshToken).toBe('rotated')
})

test('Twitch chat connections take the stored token on every connect and refresh it once', async () => {
  const now = Math.floor(Date.now() / 1000)
  AccountStore.upsert({
    id: 'twitch:42',
    platform: 'twitch',
    platformUserId: '42',
    username: 'twitchlogin',
    displayName: 'Twitch Login',
    accessToken: 'expiring',
    refreshToken: 'refresh-1',
    expiresAt: now + 60,
    scopes: ['chat:read', 'chat:edit'],
  })
  const refreshedWith: (string | null)[] = []
  mockFetch(async (url, init) => {
    expect(url).toBe(TWITCH_TOKEN_URL)
    const form = readForm(init)
    refreshedWith.push(form.get('refresh_token'))
    const n = refreshedWith.length + 1
    return Response.json({
      access_token: `access-${n}`,
      refresh_token: `refresh-${n}`,
      expires_in: 14_000,
    })
  })
  const provider = createTwitchChatAuthProvider('twitch:42')

  const first = await provider.getAccessTokenForIntent?.('chat')
  expect(first).toMatchObject({
    accessToken: 'access-2',
    userId: '42',
    scope: ['chat:read', 'chat:edit'],
  })
  expect(first?.expiresIn).toBeGreaterThan(13_000)

  // A sibling connection of the same account rotated the single-use refresh token first.
  AccountStore.updateTokens('twitch:42', 'sibling', 'refresh-sibling', now + 14_000)
  expect((await provider.refreshAccessTokenForIntent?.('chat'))?.accessToken).toBe('sibling')
  expect((await provider.getAccessTokenForIntent?.('chat'))?.accessToken).toBe('sibling')

  // The stored token itself was rejected: refresh it with the latest refresh token.
  expect((await provider.refreshAccessTokenForIntent?.('chat'))?.accessToken).toBe('access-3')
  expect(refreshedWith).toEqual(['refresh-1', 'refresh-sibling'])
})

test('YouTube validates one-time PKCE and exchanges and refreshes directly with Google', async () => {
  const authorization = new URL(getYouTubeAuthUrl())
  expect(authorization.origin).toBe('https://accounts.google.com')
  expect(authorization.searchParams.get('redirect_uri')).toBe(YOUTUBE_REDIRECT_URI)
  expect(authorization.searchParams.get('access_type')).toBe('offline')
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  const state = authorization.searchParams.get('state')
  const challenge = authorization.searchParams.get('code_challenge')
  if (!state || !challenge) throw new Error('Expected OAuth state and PKCE challenge.')

  const callback = new URL(YOUTUBE_REDIRECT_URI)
  callback.searchParams.set('code', 'google-code')
  callback.searchParams.set('state', 'invalid')
  let requests = 0
  mockFetch(async (url, init) => {
    requests++
    if (url === YOUTUBE_TOKEN_URL) {
      const form = readForm(init)
      expect(form.get('client_id')).toBe('installed-client')
      expect(form.get('client_secret')).toBe('installed-secret')
      if (form.get('grant_type') === 'refresh_token') {
        expect(form.get('refresh_token')).toBe('google-refresh')
        return Response.json({ access_token: 'google-new', expires_in: 3600 })
      }
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('redirect_uri')).toBe(YOUTUBE_REDIRECT_URI)
      expect(form.get('code')).toBe('google-code')
      const verifier = form.get('code_verifier')
      if (!verifier) throw new Error('Expected OAuth code verifier.')
      expect(new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')).toBe(challenge)
      return Response.json({
        access_token: 'google-access',
        refresh_token: 'google-refresh',
        scope: 'openid profile',
        expires_in: 3600,
      })
    }
    if (url === 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer google-access')
      return Response.json({ items: [{ id: 'UCfixture', snippet: { title: 'YouTube Login' } }] })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  await expect(handleYouTubeCallback(callback)).rejects.toThrow('session expired')
  expect(requests).toBe(0)
  callback.searchParams.set('state', state)
  expect((await handleYouTubeCallback(callback)).response.ok).toBe(true)
  await expect(handleYouTubeCallback(callback)).rejects.toThrow('session expired')
  await expect(refreshYouTubeToken('youtube:UCfixture')).resolves.toBe('google-new')
  expect(requests).toBe(3)
  expect(AccountStore.getTokens('youtube:UCfixture')?.refreshToken).toBe('google-refresh')
})
