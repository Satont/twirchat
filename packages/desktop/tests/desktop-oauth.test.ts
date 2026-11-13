import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TWITCH_REDIRECT_URI,
  YOUTUBE_REDIRECT_URI,
  YOUTUBE_TOKEN_URL,
} from '@twirchat/shared/constants'
import { z } from 'zod'

import { OAuthRefreshError } from '../src/auth/refresh-token'
import { getTwitchAuthUrl, handleTwitchCallback, refreshTwitchToken } from '../src/auth/twitch'
import { createTwitchChatAuthProvider } from '../src/auth/twitch-access-token'
import { getYouTubeAuthUrl, handleYouTubeCallback, refreshYouTubeToken } from '../src/auth/youtube'
import { getBackendUrl } from '../src/runtime-config'
import { AccountStore } from '../src/store/account-store'
import { getDb, initDb } from '../src/store/db'

const originalFetch = globalThis.fetch
const oauthEnvironment = {
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

const backendJsonSchema = z.record(z.string(), z.string())

function readBackendJson(init?: RequestInit): Record<string, string> {
  expect(init?.method).toBe('POST')
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON body.')
  return backendJsonSchema.parse(JSON.parse(init.body))
}

const backend = (path: string) => `${getBackendUrl()}${path}`

function saveTwitchAccount(refreshToken: string) {
  AccountStore.upsert({
    id: 'twitch:42',
    platform: 'twitch',
    platformUserId: '42',
    username: 'twitchlogin',
    displayName: 'Twitch Login',
    accessToken: 'expired',
    refreshToken,
  })
}

test('Twitch sign-in uses one-time PKCE and exchanges the code through the backend', async () => {
  let challenge = ''
  let state = ''
  let requests = 0
  mockFetch(async (url, init) => {
    requests++
    if (url === backend('/api/auth/twitch/start')) {
      const body = readBackendJson(init)
      expect(body.redirectUri).toBe(TWITCH_REDIRECT_URI)
      expect(body).not.toHaveProperty('codeVerifier')
      challenge = body.codeChallenge ?? ''
      state = body.state ?? ''
      return Response.json({ url: `https://id.twitch.tv/oauth2/authorize?state=${state}` })
    }
    if (url === backend('/api/auth/twitch/exchange')) {
      const body = readBackendJson(init)
      expect(body.code).toBe('twitch-code')
      expect(body.redirectUri).toBe(TWITCH_REDIRECT_URI)
      const verifier = body.codeVerifier ?? ''
      expect(new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')).toBe(challenge)
      return Response.json({ accessToken: 'twitch-access', refreshToken: 'twitch-refresh' })
    }
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('OAuth twitch-access')
      return Response.json({
        client_id: 'backend-client',
        user_id: '42',
        login: 'twitchlogin',
        expires_in: 3600,
        scopes: ['chat:read'],
      })
    }
    if (url === 'https://api.twitch.tv/helix/users?id=42') {
      const headers = new Headers(init?.headers)
      expect(headers.get('Client-Id')).toBe('backend-client')
      expect(headers.get('Authorization')).toBe('Bearer twitch-access')
      return Response.json({ data: [{ display_name: 'Twitch Login' }] })
    }
    throw new Error(`Unexpected URL ${url}`)
  })

  expect(new URL(await getTwitchAuthUrl()).origin).toBe('https://id.twitch.tv')
  const callback = new URL(TWITCH_REDIRECT_URI)
  callback.searchParams.set('code', 'twitch-code')
  callback.searchParams.set('state', 'forged')
  await expect(handleTwitchCallback(callback)).rejects.toThrow('session expired')
  expect(requests).toBe(1)

  callback.searchParams.set('state', state)
  const result = await handleTwitchCallback(callback)
  expect(result.user).toEqual({ username: 'twitchlogin', displayName: 'Twitch Login' })
  expect(result.channelSlug).toBe('twitchlogin')
  expect(AccountStore.findByPlatform('twitch')?.id).toBe('twitch:42')
  expect(AccountStore.getTokens('twitch:42')?.refreshToken).toBe('twitch-refresh')
  await expect(handleTwitchCallback(callback)).rejects.toThrow('session expired')
})

test('Twitch sign-in refuses an authorize URL outside Twitch', async () => {
  mockFetch(async () => Response.json({ url: 'https://id.twitch.tv.example.invalid/authorize' }))
  await expect(getTwitchAuthUrl()).rejects.toThrow()
})

test('Twitch refresh goes through the backend once and persists the rotated token', async () => {
  saveTwitchAccount('refresh+encoded%')
  let requests = 0
  const { promise, resolve } = Promise.withResolvers<Response>()
  mockFetch(async (url, init) => {
    requests++
    expect(url).toBe(backend('/api/auth/twitch/refresh'))
    expect(readBackendJson(init)).toEqual({ refreshToken: 'refresh+encoded%' })
    return promise
  })
  const first = refreshTwitchToken('twitch:42')
  expect(refreshTwitchToken('twitch:42')).toBe(first)
  resolve(Response.json({ accessToken: 'renewed', refreshToken: 'rotated', expiresIn: 3600 }))
  await expect(first).resolves.toBe('renewed')
  expect(requests).toBe(1)
  expect(AccountStore.getTokens('twitch:42')?.refreshToken).toBe('rotated')
})

test('Twitch refresh only reports a revoked token when Twitch says so', async () => {
  saveTwitchAccount('revoked')
  const refusal = async (response: Response) => {
    mockFetch(async () => response)
    const error = await refreshTwitchToken('twitch:42').catch((caught: unknown) => caught)
    if (!(error instanceof OAuthRefreshError)) throw new Error('Expected a refresh refusal.')
    return error
  }

  const revoked = await refusal(
    Response.json({ error: 'twitch_rejected', message: 'Invalid refresh token' }, { status: 400 }),
  )
  expect(revoked.invalidRefreshToken).toBe(true)
  const outage = await refusal(Response.json({ error: 'Twitch is unavailable' }, { status: 502 }))
  expect(outage.invalidRefreshToken).toBe(false)
  const misconfigured = await refusal(
    Response.json({ error: 'twitch_rejected', message: 'missing client secret' }, { status: 400 }),
  )
  expect(misconfigured.invalidRefreshToken).toBe(false)
  expect(AccountStore.getTokens('twitch:42')?.refreshToken).toBe('revoked')
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
    expect(url).toBe(backend('/api/auth/twitch/refresh'))
    refreshedWith.push(readBackendJson(init).refreshToken ?? null)
    const n = refreshedWith.length + 1
    return Response.json({
      accessToken: `access-${n}`,
      refreshToken: `refresh-${n}`,
      expiresIn: 14_000,
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
