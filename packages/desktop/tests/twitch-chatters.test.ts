import { afterEach, describe, expect, mock, test } from 'bun:test'

import { getTwitchChatters } from '../src/services/twitch-chatters'
import { fetchUrl } from './fixture-values'

const originalFetch = globalThis.fetch

const credentials = {
  accessToken: 'secret-token',
  broadcasterLogin: 'streamer',
  clientId: 'public-client',
  moderatorId: '456',
}

function resolvedUserResponse(): Response {
  return Response.json({ data: [{ id: '123', login: 'streamer' }] })
}

describe('getTwitchChatters', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns 404 when the broadcaster cannot be resolved', async () => {
    globalThis.fetch = Object.assign(
      mock(async () => Response.json({ data: [] })),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).rejects.toMatchObject({ status: 404 })
  })

  test('follows every cursor and deduplicates chatters', async () => {
    const calls: { init?: RequestInit; url: string }[] = []
    const controller = new AbortController()
    globalThis.fetch = Object.assign(
      mock(async (fetchInput: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = fetchUrl(fetchInput)
        calls.push({ init, url })
        if (url.includes('/helix/users?')) return resolvedUserResponse()
        if (!url.includes('/helix/chat/chatters?')) throw new Error(`Unexpected fetch: ${url}`)

        const cursor = new URL(url).searchParams.get('after')
        if (!cursor) {
          return Response.json({
            data: [
              { user_id: '1', user_login: 'one', user_name: 'One' },
              { user_id: '2', user_login: 'two', user_name: 'Two' },
            ],
            pagination: { cursor: 'next-page' },
            total: 3,
          })
        }

        return Response.json({
          data: [
            { user_id: '2', user_login: 'two', user_name: 'Two' },
            { user_id: '3', user_login: 'three', user_name: 'Three' },
          ],
          pagination: {},
          total: 2,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials, controller.signal)).resolves.toEqual({
      broadcasterId: '123',
      chatters: [
        { userId: '1', userLogin: 'one', userName: 'One' },
        { userId: '2', userLogin: 'two', userName: 'Two' },
        { userId: '3', userLogin: 'three', userName: 'Three' },
      ],
      total: 3,
    })
    expect(calls).toHaveLength(4)
    expect(calls[1]?.url).not.toContain('secret-token')
    expect(calls[2]?.url).toContain('after=next-page')
    expect(calls[1]?.init?.signal).toBe(controller.signal)
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe('Bearer secret-token')
  })

  test('merges avatars onto the matching chatters', async () => {
    const controller = new AbortController()
    let avatarInit: RequestInit | undefined

    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(fetchUrl(input))
        if (url.pathname.endsWith('/users')) {
          if (url.searchParams.has('login')) {
            return resolvedUserResponse()
          }
          avatarInit = init
          return Response.json({
            data: [
              { id: '2', profile_image_url: 'https://cdn.example/two.png' },
              { id: '1', profile_image_url: 'https://cdn.example/one.png' },
            ],
          })
        }
        return Response.json({
          data: [
            { user_id: '1', user_login: 'one', user_name: 'One' },
            { user_id: '2', user_login: 'two', user_name: 'Two' },
          ],
          pagination: {},
          total: 2,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials, controller.signal)).resolves.toEqual({
      broadcasterId: '123',
      chatters: [
        {
          userId: '1',
          userLogin: 'one',
          userName: 'One',
          avatarUrl: 'https://cdn.example/one.png',
        },
        {
          userId: '2',
          userLogin: 'two',
          userName: 'Two',
          avatarUrl: 'https://cdn.example/two.png',
        },
      ],
      total: 2,
    })
    const headers = new Headers(avatarInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret-token')
    expect(headers.get('Client-Id')).toBe(credentials.clientId)
    expect(avatarInit?.signal).toBe(controller.signal)
  })

  test('adds paginated moderator and VIP roles only to present chatters', async () => {
    const moderatorCursors: (string | null)[] = []
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(fetchUrl(input))
        switch (url.pathname) {
          case '/helix/users':
            return resolvedUserResponse()
          case '/helix/chat/chatters':
            return Response.json({
              data: ['123', '1', '2', '3'].map((id) => ({
                user_id: id,
                user_login: `user-${id}`,
                user_name: `User ${id}`,
              })),
              pagination: {},
              total: 4,
            })
          case '/helix/moderation/moderators': {
            expect(url.searchParams.get('broadcaster_id')).toBe('123')
            expect(url.searchParams.get('first')).toBe('100')
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-token')
            const cursor = url.searchParams.get('after')
            moderatorCursors.push(cursor)
            return cursor
              ? Response.json({ data: [{ user_id: '1' }, { user_id: '123' }], pagination: {} })
              : Response.json({ data: [{ user_id: '999' }], pagination: { cursor: 'next' } })
          }
          case '/helix/channels/vips':
            return Response.json({ data: [{ user_id: '1' }, { user_id: '2' }], pagination: {} })
          default:
            throw new Error(`Unexpected fetch: ${url}`)
        }
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await getTwitchChatters({
      ...credentials,
      moderatorId: '123',
      scopes: ['moderation:read', 'channel:manage:vips'],
    })
    expect(result.total).toBe(4)
    expect(result.chatters.map(({ userId, role }) => [userId, role])).toEqual([
      ['123', undefined],
      ['1', 'moderator'],
      ['2', 'vip'],
      ['3', undefined],
    ])
    expect(moderatorCursors).toEqual([null, 'next'])
  })

  test.each([
    { moderatorId: '456', scopes: ['moderation:read', 'channel:read:vips'] },
    { moderatorId: '123', scopes: ['moderator:read:chatters'] },
  ])('skips role endpoints without owner access and matching scopes', async (auth) => {
    const paths: string[] = []
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(fetchUrl(input))
        paths.push(url.pathname)
        if (url.pathname === '/helix/users') return resolvedUserResponse()
        return Response.json({ data: [], pagination: {}, total: 0 })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await getTwitchChatters({ ...credentials, ...auth })
    expect(paths).toEqual(['/helix/users', '/helix/chat/chatters'])
  })

  test('keeps VIPs and the chatter list if moderator pagination fails', async () => {
    let moderatorPages = 0
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(fetchUrl(input))
        switch (url.pathname) {
          case '/helix/users':
            return resolvedUserResponse()
          case '/helix/chat/chatters':
            return Response.json({
              data: [{ user_id: '1', user_login: 'one', user_name: 'One' }],
              pagination: {},
              total: 1,
            })
          case '/helix/moderation/moderators':
            moderatorPages++
            return Response.json({ data: [{ user_id: '1' }], pagination: { cursor: 'repeat' } })
          case '/helix/channels/vips':
            return Response.json({ data: [{ user_id: '1' }], pagination: {} })
          default:
            throw new Error(`Unexpected fetch: ${url}`)
        }
      }),
      { preconnect: originalFetch.preconnect },
    )

    const result = await getTwitchChatters({
      ...credentials,
      moderatorId: '123',
      scopes: ['channel:manage:moderators', 'channel:read:vips'],
    })
    expect(result.chatters).toEqual([
      { userId: '1', userLogin: 'one', userName: 'One', role: 'vip' },
    ])
    expect(moderatorPages).toBe(2)
  })

  test('chunks avatar lookups at 100 user IDs', async () => {
    const avatarRequests: URL[] = []
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(fetchUrl(input))
        if (url.pathname.endsWith('/users')) {
          if (url.searchParams.has('login')) {
            return resolvedUserResponse()
          }
          avatarRequests.push(url)
          return Response.json({ data: [] })
        }
        return Response.json({
          data: Array.from({ length: 101 }, (_, index) => ({
            user_id: String(index + 1),
            user_login: `user-${index + 1}`,
            user_name: `User ${index + 1}`,
          })),
          pagination: {},
          total: 101,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await getTwitchChatters(credentials)
    expect(avatarRequests).toHaveLength(2)
    expect(avatarRequests[0]?.searchParams.getAll('id')).toHaveLength(100)
    expect(avatarRequests[1]?.searchParams.getAll('id')).toEqual(['101'])
  })

  test('leaves avatarUrl absent when Twitch does not return a user', async () => {
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(fetchUrl(input))
        if (url.pathname.endsWith('/users')) {
          if (url.searchParams.has('login')) {
            return resolvedUserResponse()
          }
          return Response.json({
            data: [{ id: '1', profile_image_url: 'https://cdn.example/one.png' }],
          })
        }
        return Response.json({
          data: [
            { user_id: '1', user_login: 'one', user_name: 'One' },
            { user_id: '2', user_login: 'two', user_name: 'Two' },
          ],
          pagination: {},
          total: 2,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).resolves.toEqual({
      broadcasterId: '123',
      chatters: [
        {
          userId: '1',
          userLogin: 'one',
          userName: 'One',
          avatarUrl: 'https://cdn.example/one.png',
        },
        { userId: '2', userLogin: 'two', userName: 'Two' },
      ],
      total: 2,
    })
  })

  test('returns chatters without avatars when the users endpoint fails', async () => {
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(fetchUrl(input))
        if (url.pathname.endsWith('/users')) {
          if (url.searchParams.has('login')) {
            return resolvedUserResponse()
          }
          return new Response('users unavailable', { status: 503 })
        }
        return Response.json({
          data: [{ user_id: '1', user_login: 'one', user_name: 'One' }],
          pagination: {},
          total: 1,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).resolves.toEqual({
      broadcasterId: '123',
      chatters: [{ userId: '1', userLogin: 'one', userName: 'One' }],
      total: 1,
    })
  })

  test('returns 502 when Twitch repeats a pagination cursor', async () => {
    let chatterPage = 0
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input)
        if (url.includes('/helix/users?')) return resolvedUserResponse()
        chatterPage += 1
        return Response.json({
          data: [{ user_id: String(chatterPage), user_login: 'user', user_name: 'User' }],
          pagination: { cursor: 'repeated-cursor' },
          total: 1,
        })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).rejects.toMatchObject({
      status: 502,
      message: 'Twitch chatters response repeated a pagination cursor',
    })
  })

  test.each([
    { data: { pagination: {}, total: 0 }, name: 'missing data' },
    {
      data: { data: [{ user_id: '1' }], pagination: {}, total: 1 },
      name: 'malformed chatter',
    },
  ])('returns 502 for $name Helix data', async ({ data }) => {
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input)
        if (url.includes('/helix/users?')) return resolvedUserResponse()
        return Response.json(data)
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).rejects.toMatchObject({ status: 502 })
  })

  test.each([401, 403])('preserves Twitch upstream %i status', async (status) => {
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input)
        if (url.includes('/helix/users?')) return resolvedUserResponse()
        return new Response('upstream failure', { status })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).rejects.toMatchObject({ status })
  })

  test('maps other upstream statuses to 502', async () => {
    globalThis.fetch = Object.assign(
      mock(async (input: Parameters<typeof fetch>[0]) => {
        const url = fetchUrl(input)
        if (url.includes('/helix/users?')) return resolvedUserResponse()
        return new Response('upstream failure', { status: 500 })
      }),
      { preconnect: originalFetch.preconnect },
    )

    await expect(getTwitchChatters(credentials)).rejects.toMatchObject({ status: 502 })
  })
})
