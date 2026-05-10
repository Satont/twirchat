import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  isTwitchUserId,
  normalizeTwitchLogin,
  resolveTwitchUserId,
  resolveTwitchUserIdsByLogin,
} from '../src/api/twitch-users.ts'

describe('twitch-users helpers', () => {
  beforeEach(() => {
    global.fetch = fetch
  })

  it('normalizes Twitch logins', () => {
    expect(normalizeTwitchLogin('@Satont ')).toBe('satont')
    expect(normalizeTwitchLogin('https://www.twitch.tv/Satont/')).toBe('satont')
  })

  it('rejects invalid Twitch logins', () => {
    expect(normalizeTwitchLogin('ab')).toBeNull()
    expect(normalizeTwitchLogin('bad slug')).toBeNull()
    expect(normalizeTwitchLogin('@bad/slash')).toBeNull()
  })

  it('detects Twitch numeric user ids', () => {
    expect(isTwitchUserId('12345')).toBe(true)
    expect(isTwitchUserId('abc123')).toBe(false)
    expect(isTwitchUserId(undefined)).toBe(false)
  })

  it('returns numeric Twitch ids without fetching', async () => {
    let called = false
    global.fetch = mock(async () => {
      called = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    await expect(resolveTwitchUserId('12345')).resolves.toBe('12345')
    expect(called).toBe(false)
  })

  it('resolves only valid normalized logins', async () => {
    const calls: string[] = []
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)

      return Response.json({
        data: [
          { id: '100', login: 'satont' },
          { id: '200', login: 'other_user' },
        ],
      })
    }) as unknown as typeof global.fetch

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

  it('retries app-token-backed Helix user lookup after a 401', async () => {
    const calls: string[] = []
    let tokenRequestCount = 0

    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)

      if (url === 'https://id.twitch.tv/oauth2/token') {
        tokenRequestCount += 1

        return Response.json({
          access_token: tokenRequestCount === 1 ? 'stale-token' : 'fresh-token',
          expires_in: 3600,
        })
      }

      if (url.startsWith('https://api.twitch.tv/helix/users?')) {
        const authHeader = new Headers(init?.headers).get('Authorization')

        if (authHeader === 'Bearer stale-token') {
          return new Response('Unauthorized', { status: 401 })
        }

        return Response.json({
          data: [{ id: '100', login: 'satont' }],
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    const result = await resolveTwitchUserIdsByLogin(['satont'])

    expect(result.get('satont')).toBe('100')
    expect(tokenRequestCount).toBe(2)
    expect(calls).toEqual([
      'https://id.twitch.tv/oauth2/token',
      'https://api.twitch.tv/helix/users?login=satont',
      'https://id.twitch.tv/oauth2/token',
      'https://api.twitch.tv/helix/users?login=satont',
    ])
  })
})
