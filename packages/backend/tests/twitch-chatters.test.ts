import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { config } from '../src/config.ts'
import { ClientStore } from '../src/db/index.ts'
import { streamRoutes } from '../src/routes/stream.ts'

const originalFetch = globalThis.fetch
const originalUpsert = ClientStore.upsert
const chattersRoute = streamRoutes['/api/twitch/chatters'].POST

function request(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/twitch/chatters', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Secret': 'test-client-secret',
    },
    method: 'POST',
    signal,
  })
}

function resolvedUserResponse(): Response {
  return Response.json({ data: [{ id: '123', login: 'streamer' }] })
}

describe('POST /api/twitch/chatters', () => {
  beforeEach(() => {
    ClientStore.upsert = mock(async (secret: string) => ({
      createdAt: new Date(),
      lastSeenAt: new Date(),
      secret,
    }))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ClientStore.upsert = originalUpsert
  })

  test('returns 400 for missing request fields without fetching Twitch', async () => {
    let fetchCalled = false
    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof fetch

    const response = await chattersRoute(request({ accessToken: 'token' }))

    expect(response.status).toBe(400)
    expect(fetchCalled).toBe(false)
  })

  test('returns 404 when the broadcaster cannot be resolved', async () => {
    globalThis.fetch = mock(async () => Response.json({ data: [] })) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(404)
  })

  test('follows every cursor and deduplicates chatters', async () => {
    const calls: { init?: RequestInit; url: string }[] = []
    const controller = new AbortController()
    const inputRequest = request(
      { accessToken: 'secret-token', broadcasterLogin: 'streamer', moderatorId: '456' },
      controller.signal,
    )

    globalThis.fetch = mock(
      async (fetchInput: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = String(fetchInput)
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
      },
    ) as unknown as typeof fetch

    const response = await chattersRoute(inputRequest)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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
    expect(calls[1]?.init?.signal).toBe(inputRequest.signal)
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe('Bearer secret-token')
  })

  test('merges avatars onto the matching chatters', async () => {
    const controller = new AbortController()
    const inputRequest = request(
      { accessToken: 'secret-token', broadcasterLogin: 'streamer', moderatorId: '456' },
      controller.signal,
    )
    let avatarInit: RequestInit | undefined

    globalThis.fetch = mock(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input))
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
      },
    ) as unknown as typeof fetch

    const response = await chattersRoute(inputRequest)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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
    expect(headers.get('Client-Id')).toBe(config.TWITCH_CLIENT_ID)
    expect(avatarInit?.signal).toBe(inputRequest.signal)
  })

  test('chunks avatar lookups at 100 user IDs', async () => {
    const avatarRequests: URL[] = []
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
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
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'secret-token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(200)
    expect(avatarRequests).toHaveLength(2)
    expect(avatarRequests[0]?.searchParams.getAll('id')).toHaveLength(100)
    expect(avatarRequests[1]?.searchParams.getAll('id')).toEqual(['101'])
  })

  test('leaves avatarUrl absent when Twitch does not return a user', async () => {
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
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
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'secret-token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
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
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
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
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'secret-token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      broadcasterId: '123',
      chatters: [{ userId: '1', userLogin: 'one', userName: 'One' }],
      total: 1,
    })
  })

  test('returns 502 when Twitch repeats a pagination cursor', async () => {
    let chatterPage = 0
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/helix/users?')) return resolvedUserResponse()
      chatterPage += 1
      return Response.json({
        data: [{ user_id: String(chatterPage), user_login: 'user', user_name: 'User' }],
        pagination: { cursor: 'repeated-cursor' },
        total: 1,
      })
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Twitch chatters response repeated a pagination cursor',
    })
  })

  test.each([
    { data: { pagination: {}, total: 0 }, name: 'missing data' },
    {
      data: { data: [{ user_id: '1' }], pagination: {}, total: 1 },
      name: 'malformed chatter',
    },
  ])('returns 502 for $name Helix data', async ({ data }) => {
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/helix/users?')) return resolvedUserResponse()
      return Response.json(data)
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(502)
  })

  test.each([401, 403])('preserves Twitch upstream %i status', async (status) => {
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/helix/users?')) return resolvedUserResponse()
      return new Response('upstream failure', { status })
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(status)
  })

  test('maps other upstream statuses to 502', async () => {
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/helix/users?')) return resolvedUserResponse()
      return new Response('upstream failure', { status: 500 })
    }) as unknown as typeof fetch

    const response = await chattersRoute(
      request({ accessToken: 'token', broadcasterLogin: 'streamer', moderatorId: '456' }),
    )

    expect(response.status).toBe(502)
  })
})
