/**
 * Moderation route tests
 *
 * Tests cover:
 * - Missing auth (401 without X-Client-Secret)
 * - Unsupported platform (400)
 * - Missing account (400)
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'

const mockFindByClientAndPlatform = mock(() => Promise.resolve(null))

mock.module('../src/db/index.ts', () => ({
  AccountStore: {
    findByClientAndPlatform: mockFindByClientAndPlatform,
  },
}))

mock.module('../src/routes/utils.ts', () => ({
  json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
      status,
    })
  },
  requireClient(req: Request): { clientSecret: string } | Response {
    const secret = req.headers.get('X-Client-Secret')
    if (!secret) {
      return new Response(JSON.stringify({ error: 'Missing X-Client-Secret header' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      })
    }
    return { clientSecret: secret }
  },
}))

const { moderationRoutes } = await import('../src/routes/moderation.ts')

// Extract route handlers for direct testing
const banRoute = moderationRoutes['/api/moderation/ban'] as {
  POST: (req: Request) => Promise<Response>
}
const deleteRoute = moderationRoutes['/api/moderation/delete'] as {
  POST: (req: Request) => Promise<Response>
}

describe('POST /api/moderation/ban', () => {
  afterEach(() => {
    mockFindByClientAndPlatform.mockClear()
  })

  it('returns 401 without X-Client-Secret', async () => {
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'twitch',
          targetUserId: '123',
          channelId: '456',
          durationSeconds: 600,
        }),
      }),
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Missing X-Client-Secret')
  })

  it('returns 400 for unsupported platform', async () => {
    // We'll test with invalid platform directly by constructing the request
    // The route validates platform after auth, so we need to mock auth
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'youtube',
          targetUserId: '123',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Unsupported platform')
    expect(body.error).toContain('youtube')
  })

  it('returns 400 for missing account', async () => {
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'twitch',
          targetUserId: '123',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('No twitch account connected')
  })

  it('returns 400 for missing targetUserId', async () => {
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'twitch',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('targetUserId is required')
  })

  it('returns 400 for missing channelId', async () => {
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'twitch',
          targetUserId: '123',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('channelId is required')
  })

  it('returns 400 for invalid JSON body', async () => {
    const response = await banRoute.POST(
      new Request('http://localhost:3000/api/moderation/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: 'not valid json',
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Invalid JSON')
  })
})

describe('POST /api/moderation/delete', () => {
  afterEach(() => {
    mockFindByClientAndPlatform.mockClear()
  })

  it('returns 401 without X-Client-Secret', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'twitch',
          messageId: 'msg-123',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Missing X-Client-Secret')
  })

  it('returns 400 for unsupported platform', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'youtube',
          messageId: 'msg-123',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Unsupported platform')
    expect(body.error).toContain('youtube')
  })

  it('returns 400 for missing account', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'kick',
          messageId: 'msg-123',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('No kick account connected')
  })

  it('returns 400 for missing messageId', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'twitch',
          channelId: '456',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('messageId is required')
  })

  it('returns 400 for missing channelId', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: JSON.stringify({
          platform: 'twitch',
          messageId: 'msg-123',
        }),
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('channelId is required')
  })

  it('returns 400 for invalid JSON body', async () => {
    const response = await deleteRoute.POST(
      new Request('http://localhost:3000/api/moderation/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Secret': 'test-secret',
        },
        body: 'invalid json',
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Invalid JSON')
  })
})
