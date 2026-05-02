import { describe, expect, it, mock } from 'bun:test'
import {
  isTwitchUserId,
  normalizeTwitchLogin,
  resolveTwitchUserIdsByLogin,
} from '../src/api/twitch-users.ts'

describe('twitch-users helpers', () => {
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
})
