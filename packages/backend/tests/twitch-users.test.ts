import { afterEach, describe, expect, it, mock } from 'bun:test'

import { getTwitchAppToken } from '../src/api/stream-status.ts'
import {
  fetchTwitchUserById,
  isTwitchUserId,
  normalizeTwitchLogin,
  resolveTwitchUserId,
  resolveTwitchUserIdsByLogin,
} from '../src/api/twitch-users.ts'
import { fetchUrl } from './literal'

const originalFetch = globalThis.fetch

describe('twitch-users helpers', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('normalizes Twitch logins', () => {
    expect(normalizeTwitchLogin('@Satont ')).toBe('satont')
    expect(normalizeTwitchLogin('https://www.twitch.tv/Satont/')).toBe('satont')
    expect(normalizeTwitchLogin(' @XQC ')).toBe('xqc')
    expect(normalizeTwitchLogin('https://www.twitch.tv/XQC/')).toBe('xqc')
  })

  it('accepts existing short logins and the maximum supported length', () => {
    for (const login of ['a', 'ab', 'xqc', 'a'.repeat(25)]) {
      expect(normalizeTwitchLogin(login)).toBe(login)
    }
  })

  it('rejects invalid Twitch logins', () => {
    for (const login of [
      '',
      '   ',
      '@',
      'bad slug',
      '@bad/slash',
      'bad-slug',
      'тест',
      'a'.repeat(26),
    ]) {
      expect(normalizeTwitchLogin(login)).toBeNull()
    }
  })

  it('detects Twitch numeric user ids', () => {
    expect(isTwitchUserId('12345')).toBe(true)
    expect(isTwitchUserId('abc123')).toBe(false)
    expect(isTwitchUserId(undefined)).toBe(false)
  })

  it('returns numeric Twitch ids without fetching', async () => {
    let called = false
    global.fetch = Object.assign(
      mock(async () => {
        called = true
        return Response.json({})
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(resolveTwitchUserId('12345')).resolves.toBe('12345')
    expect(called).toBe(false)
  })

  it('resolves only valid normalized logins', async () => {
    const calls: string[] = []
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request) => {
        const url = fetchUrl(input)
        calls.push(url)

        return Response.json({
          data: [
            { id: '100', login: 'satont' },
            { id: '200', login: 'other_user' },
          ],
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await resolveTwitchUserIdsByLogin(
      ['@Satont', 'bad slug', 'other_user'],
      'test-user-token',
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('login=satont')
    expect(calls[0]).toContain('login=other_user')
    expect(calls[0]).not.toContain('bad%20slug')
    expect(result.get('satont')).toBe('100')
    expect(result.get('other_user')).toBe('200')
  })

  it('refreshes a cached app token and retries Helix user lookup after a 401', async () => {
    const calls: string[] = []
    const authorizations: Array<string | null> = []
    let tokenRequestCount = 0
    let priming = true

    global.fetch = Object.assign(
      mock(async (input: string | URL | Request, init?: RequestInit) => {
        const url = fetchUrl(input)
        calls.push(url)

        if (url === 'https://id.twitch.tv/oauth2/token') {
          tokenRequestCount += 1

          return Response.json({
            access_token: priming ? 'stale-token' : 'fresh-token',
            expires_in: 3600,
          })
        }

        if (url.startsWith('https://api.twitch.tv/helix/users?')) {
          const authHeader = new Headers(init?.headers).get('Authorization')
          authorizations.push(authHeader)

          if (authorizations.length === 1) {
            return new Response('Unauthorized', { status: 401 })
          }

          return Response.json({
            data: [{ id: '100', login: 'satont' }],
          })
        }

        throw new Error(`Unexpected fetch: ${url}`)
      }),
      { preconnect: originalFetch.preconnect },
    )

    const initialToken = await getTwitchAppToken()
    priming = false
    calls.length = 0
    tokenRequestCount = 0

    const result = await resolveTwitchUserIdsByLogin(['satont'])

    expect(result.get('satont')).toBe('100')
    expect(authorizations).toEqual([`Bearer ${initialToken}`, 'Bearer fresh-token'])
    expect(tokenRequestCount).toBe(1)
    expect(calls).toEqual([
      'https://api.twitch.tv/helix/users?login=satont',
      'https://id.twitch.tv/oauth2/token',
      'https://api.twitch.tv/helix/users?login=satont',
    ])
  })

  it('fetches Twitch user profile by id', async () => {
    global.fetch = Object.assign(
      mock(async (input: string | URL | Request) => {
        const url = fetchUrl(input)

        if (url === 'https://id.twitch.tv/oauth2/token') {
          return Response.json({ access_token: 'app-token', expires_in: 3600 })
        }

        if (url === 'https://api.twitch.tv/helix/users?id=12345') {
          return Response.json({
            data: [
              {
                id: '12345',
                login: 'satont',
                display_name: 'Satont',
                profile_image_url: 'https://example.com/avatar.png',
              },
            ],
          })
        }

        throw new Error(`Unexpected fetch: ${url}`)
      }),
      { preconnect: originalFetch.preconnect },
    )

    const profile = await fetchTwitchUserById('12345')

    expect(profile).toEqual({
      id: '12345',
      login: 'satont',
      display_name: 'Satont',
      profile_image_url: 'https://example.com/avatar.png',
    })
  })
})
