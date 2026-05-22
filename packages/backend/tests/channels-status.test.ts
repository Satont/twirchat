import { afterEach, describe, expect, it, mock } from 'bun:test'

import { handleChannelsStatus } from '../src/api/channels-status.ts'

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write

describe('channels status', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
  })

  it('rejects oversized requests before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: Array.from({ length: 101 }, (_, index) => ({
          channelLogin: `channel-${index}`,
          platform: 'kick',
        })),
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: channels cannot exceed 100',
    )
    expect(fetchCalled).toBe(false)
  })

  it('rejects oversized multibyte bodies without relying on character count', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: [],
        padding: '😀'.repeat(20_000),
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: body is too large',
    )
    expect(fetchCalled).toBe(false)
  })

  it('returns an empty result when channels are missing', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({}),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).resolves.toEqual({ channels: [] })
    expect(fetchCalled).toBe(false)
  })

  it('rejects invalid JSON as a bad request before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: '{bad json',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: body must be valid JSON',
    )
    expect(fetchCalled).toBe(false)
  })

  it('rejects non-object bodies before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify([]),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: body must be an object',
    )
    expect(fetchCalled).toBe(false)
  })

  it('rejects malformed channel entries before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: [{ platform: 'kick' }],
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: channels[0].channelLogin is required',
    )
    expect(fetchCalled).toBe(false)
  })

  it('rejects unsupported platforms before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: [{ channelLogin: 'satont', platform: 'youtube' }],
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: channels[0].platform is unsupported',
    )
    expect(fetchCalled).toBe(false)
  })

  it('rejects oversized channel fields before any upstream fetch', async () => {
    let fetchCalled = false

    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return Response.json({})
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: [{ channelLogin: 'x'.repeat(101), platform: 'kick' }],
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    await expect(handleChannelsStatus(request)).rejects.toThrow(
      'Invalid request: channels[0].channelLogin is too long',
    )
    expect(fetchCalled).toBe(false)
  })

  it('caps Kick channel fetch concurrency', async () => {
    const pendingResponses: Array<() => void> = []
    let inFlight = 0
    let kickRequests = 0
    let tokenRequests = 0
    let maxInFlight = 0

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://id.kick.com/oauth/token') {
        tokenRequests += 1
        return Response.json({
          access_token: 'kick-token',
          expires_in: 3600,
        })
      }

      if (url.startsWith('https://api.kick.com/public/v1/channels?slug=')) {
        kickRequests += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)

        const slug = new URL(url).searchParams.get('slug') ?? ''

        return await new Promise<Response>((resolve) => {
          pendingResponses.push(() => {
            inFlight -= 1
            resolve(
              Response.json({
                data: [
                  {
                    category: { name: 'Games' },
                    stream: { is_live: true, viewer_count: 12 },
                    stream_title: `Live ${slug}`,
                  },
                ],
              }),
            )
          })
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    const request = new Request('http://localhost/api/channels-status', {
      body: JSON.stringify({
        channels: Array.from({ length: 10 }, (_, index) => ({
          channelLogin: `channel-${index}`,
          platform: 'kick',
        })),
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    const responsePromise = handleChannelsStatus(request)

    const waitForKickRequests = async (): Promise<void> => {
      if (kickRequests >= 5) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 0))
      await waitForKickRequests()
    }

    await waitForKickRequests()

    expect(kickRequests).toBe(5)
    expect(maxInFlight).toBeLessThanOrEqual(5)

    const drainKickResponses = async (): Promise<void> => {
      if (kickRequests >= 10 && pendingResponses.length === 0) {
        return
      }

      const resolver = pendingResponses.shift()
      if (resolver) {
        resolver()
      }

      await Promise.resolve()
      await drainKickResponses()
    }

    await drainKickResponses()

    const response = await responsePromise

    expect(response.channels).toHaveLength(10)
    expect(maxInFlight).toBe(5)
    expect(tokenRequests).toBe(1)
  })

  it('truncates Twitch failed response bodies in logs', async () => {
    const longBody = 'x'.repeat(500)
    let captured = ''

    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      return true
    }) as typeof process.stdout.write

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'https://id.twitch.tv/oauth2/token') {
        return Response.json({
          access_token: 'twitch-token',
          expires_in: 3600,
        })
      }

      if (url.startsWith('https://api.twitch.tv/helix/streams?')) {
        return new Response(longBody, { status: 500 })
      }

      if (url.startsWith('https://api.twitch.tv/helix/channels?')) {
        return new Response(longBody, { status: 502 })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof global.fetch

    try {
      await handleChannelsStatus(
        new Request('http://localhost/api/channels-status', {
          body: JSON.stringify({
            channels: [
              {
                channelId: '12345',
                channelLogin: 'satont',
                platform: 'twitch',
              },
            ],
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }),
      )
    } finally {
      process.stdout.write = originalStdoutWrite
    }

    expect(captured).toContain(longBody.slice(0, 300))
    expect(captured).not.toContain(longBody)
  })
})
