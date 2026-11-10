import { afterEach, describe, expect, mock, test } from 'bun:test'

import { getTwitchViewerList } from '../src/services/twitch-viewer-list'
import { fetchUrl } from './fixture-values'

const originalFetch = globalThis.fetch
const broadcasterLogin = 'streamer'

function mockRequests(respond: (url: URL, init?: RequestInit) => Response) {
  const requests: string[] = []
  globalThis.fetch = Object.assign(
    mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(fetchUrl(input))
      requests.push(url.pathname)
      return respond(url, init)
    }),
    { preconnect: originalFetch.preconnect },
  )
  return requests
}

function validatedToken(scopes = ['moderator:read:chatters']) {
  return Response.json({
    client_id: 'app',
    user_id: '321',
    login: 'testuser',
    scopes,
    expires_in: 3600,
  })
}

describe('getTwitchViewerList', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('requests public groups anonymously and counts only unique, valid logins', async () => {
    const requests = mockRequests((url, init) => {
      expect(url.href).toBe('https://api.tackling.cc/twitch/Chatters?login=streamer&limit=1000')
      expect([...new Headers(init?.headers)]).toEqual([['accept', 'application/json']])
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Response.json({
        count: 999,
        broadcasters: [' Streamer '],
        moderators: ['STREAMER', 'Mod'],
        vips: ['MOD', 'VIP'],
        chatbots: ['ViP', 'Bot'],
        staff: ['Bot', 'Staff'],
        viewers: ['VIP', 'STAFF', 'Viewer', '<invalid>'],
      })
    })

    expect(await getTwitchViewerList({ broadcasterLogin: ' Streamer ' })).toEqual({
      source: 'community',
      viewers: [
        { username: 'streamer', displayName: 'streamer', role: 'broadcaster' },
        { username: 'mod', displayName: 'mod', role: 'moderators' },
        { username: 'vip', displayName: 'vip', role: 'vips' },
        { username: 'bot', displayName: 'bot', role: 'bots' },
        { username: 'staff', displayName: 'staff', role: 'chatters' },
        { username: 'viewer', displayName: 'viewer', role: 'chatters' },
      ],
    })
    expect(requests).toEqual(['/twitch/Chatters'])
  })

  test.each([401, 403])(
    'uses the fallback when Helix rejects chatter access with %i',
    async (status) => {
      const requests = mockRequests((url) => {
        switch (url.pathname) {
          case '/oauth2/validate':
            return validatedToken()
          case '/helix/users':
            return Response.json({ data: [{ id: '123' }] })
          case '/helix/chat/chatters':
            return new Response(null, { status })
          case '/twitch/Chatters':
            return Response.json({ viewers: [] })
          default:
            throw new Error(`Unexpected URL: ${url}`)
        }
      })

      expect(
        await getTwitchViewerList({ broadcasterLogin, accessToken: `helix-${status}` }),
      ).toEqual({
        source: 'community',
        viewers: [],
      })
      expect(requests).toEqual([
        '/oauth2/validate',
        '/helix/users',
        '/helix/chat/chatters',
        '/twitch/Chatters',
      ])
    },
  )

  test.each([
    ['no-scope', () => validatedToken([])],
    ['expired', () => new Response(null, { status: 401 })],
  ])(
    'uses the fallback without querying Helix for a %s token',
    async (accessToken, tokenResponse) => {
      const requests = mockRequests((url) => {
        if (url.pathname === '/oauth2/validate') return tokenResponse()
        if (url.pathname === '/twitch/Chatters') return Response.json({ viewers: [] })
        throw new Error(`Unexpected URL: ${url}`)
      })

      expect((await getTwitchViewerList({ broadcasterLogin, accessToken })).source).toBe(
        'community',
      )
      expect(requests).toEqual(['/oauth2/validate', '/twitch/Chatters'])
    },
  )

  test.each(['empty', 'populated'])('keeps a successful %s Helix list', async (kind) => {
    const chatters =
      kind === 'empty' ? [] : [{ user_id: '123', user_login: 'streamer', user_name: 'Streamer' }]
    const requests = mockRequests((url) => {
      switch (url.pathname) {
        case '/oauth2/validate':
          return validatedToken()
        case '/helix/users':
          return url.searchParams.has('login')
            ? Response.json({ data: [{ id: '123' }] })
            : Response.json({
                data: [{ id: '123', profile_image_url: 'https://example.test/avatar' }],
              })
        case '/helix/chat/chatters':
          return Response.json({ data: chatters, total: chatters.length, pagination: {} })
        default:
          throw new Error(`Unexpected URL: ${url}`)
      }
    })

    const result = await getTwitchViewerList({ broadcasterLogin, accessToken: `helix-${kind}` })
    expect(result).toEqual({
      source: 'helix',
      viewers:
        kind === 'empty'
          ? []
          : [
              {
                userId: '123',
                username: 'streamer',
                displayName: 'Streamer',
                avatarUrl: 'https://example.test/avatar',
                role: 'broadcaster',
              },
            ],
    })
    expect(requests).not.toContain('/twitch/Chatters')
  })

  test.each([404, 502])('preserves unrelated Helix failures with status %i', async (status) => {
    const requests = mockRequests((url) => {
      if (url.pathname === '/oauth2/validate') return validatedToken()
      if (url.pathname === '/helix/users')
        return Response.json({ data: status === 404 ? [] : [{ id: '123' }] })
      if (url.pathname === '/helix/chat/chatters') return new Response(null, { status: 503 })
      throw new Error(`Unexpected URL: ${url}`)
    })

    await expect(
      getTwitchViewerList({ broadcasterLogin, accessToken: `error-${status}` }),
    ).rejects.toMatchObject({ status })
    expect(requests).not.toContain('/twitch/Chatters')
  })

  test('caps an oversized community list after assigning priority roles', async () => {
    mockRequests(() =>
      Response.json({
        moderators: ['mod'],
        viewers: Array.from({ length: 1100 }, (_, index) => `viewer${index}`),
      }),
    )

    const result = await getTwitchViewerList({ broadcasterLogin })
    expect(result.viewers).toHaveLength(1000)
    expect(result.viewers[0]).toMatchObject({ username: 'mod', role: 'moderators' })
    expect(result.viewers[999]?.username).toBe('viewer998')
  })

  test.each([
    ['HTTP failure', () => new Response(null, { status: 503 })],
    ['invalid JSON', () => new Response('invalid JSON')],
    ['missing groups', () => Response.json({ count: 0 })],
    ['invalid groups', () => Response.json({ viewers: [123] })],
    ['oversized body', () => new Response(' '.repeat(1024 * 1024 + 1))],
  ])('surfaces %s instead of an empty success', async (_kind, response) => {
    mockRequests(response)

    await expect(getTwitchViewerList({ broadcasterLogin })).rejects.toThrow()
  })
})
