import { describe, expect, test } from 'bun:test'
import {
  createKickAvatarResolver,
  KICK_AVATAR_NEGATIVE_TTL_MS,
  KICK_AVATAR_FETCH_TIMEOUT_MS,
  KICK_AVATAR_POSITIVE_TTL_MS,
} from '@desktop/platforms/kick/avatar-cache'

function createJsonResponse(profilePicture?: string | null, status = 200): Response {
  return new Response(JSON.stringify({ user: { profile_pic: profilePicture ?? null } }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

describe('createKickAvatarResolver', () => {
  test('uses sender profile picture immediately and seeds cache', async () => {
    const fetchCalls: string[] = []
    const resolver = createKickAvatarResolver({
      fetchFn: async (input) => {
        fetchCalls.push(String(input))
        return createJsonResponse('https://files.kick.com/from-api.webp')
      },
      now: () => 0,
    })

    const fromMessage = await resolver({
      authorId: '42',
      lookupSource: 'slug',
      profilePicture: 'https://files.kick.com/from-message.webp',
      slugOrUsername: 'satont',
    })

    const fromCache = await resolver({
      authorId: '42',
      lookupSource: 'slug',
      slugOrUsername: 'satont',
    })

    expect(fromMessage).toBe('https://files.kick.com/from-message.webp')
    expect(fromCache).toBe('https://files.kick.com/from-message.webp')
    expect(fetchCalls).toHaveLength(0)
  })

  test('caches positive lookup results for 24 hours by author id', async () => {
    let currentTime = 0
    const fetchCalls: string[] = []
    const resolver = createKickAvatarResolver({
      fetchFn: async (input) => {
        fetchCalls.push(String(input))
        return createJsonResponse('https://files.kick.com/avatar.webp')
      },
      now: () => currentTime,
    })

    const first = await resolver({ authorId: '7', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_POSITIVE_TTL_MS - 1
    const second = await resolver({
      authorId: '7',
      lookupSource: 'slug',
      slugOrUsername: 'renamed-user',
    })

    expect(first).toBe('https://files.kick.com/avatar.webp')
    expect(second).toBe('https://files.kick.com/avatar.webp')
    expect(fetchCalls).toEqual(['https://kick.com/api/v2/channels/satont/'])
  })

  test('refetches after positive ttl expires', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async () => {
        fetchCount += 1
        return createJsonResponse(`https://files.kick.com/avatar-${fetchCount}.webp`)
      },
      now: () => currentTime,
    })

    const first = await resolver({ authorId: '7', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_POSITIVE_TTL_MS
    const second = await resolver({ authorId: '7', lookupSource: 'slug', slugOrUsername: 'satont' })

    expect(first).toBe('https://files.kick.com/avatar-1.webp')
    expect(second).toBe('https://files.kick.com/avatar-2.webp')
    expect(fetchCount).toBe(2)
  })

  test('negative-caches missing avatars for 10 minutes', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async () => {
        fetchCount += 1
        return createJsonResponse(null)
      },
      now: () => currentTime,
    })

    const first = await resolver({ authorId: '99', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_NEGATIVE_TTL_MS - 1
    const second = await resolver({
      authorId: '99',
      lookupSource: 'slug',
      slugOrUsername: 'satont',
    })

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(fetchCount).toBe(1)
  })

  test('refetches after negative ttl expires', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async () => {
        fetchCount += 1
        return fetchCount === 1
          ? createJsonResponse('')
          : createJsonResponse('https://files.kick.com/avatar.webp')
      },
      now: () => currentTime,
    })

    const first = await resolver({ authorId: '99', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_NEGATIVE_TTL_MS
    const second = await resolver({
      authorId: '99',
      lookupSource: 'slug',
      slugOrUsername: 'satont',
    })

    expect(first).toBeUndefined()
    expect(second).toBe('https://files.kick.com/avatar.webp')
    expect(fetchCount).toBe(2)
  })

  test('dedupes concurrent lookups for the same author', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: () => {
        fetchCount += 1
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
      },
      now: () => 0,
    })

    const firstPromise = resolver({
      authorId: '55',
      lookupSource: 'slug',
      slugOrUsername: 'satont',
    })
    const secondPromise = resolver({
      authorId: '55',
      lookupSource: 'slug',
      slugOrUsername: 'satont',
    })

    resolveFetch?.(createJsonResponse('https://files.kick.com/avatar.webp'))

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toBe('https://files.kick.com/avatar.webp')
    expect(second).toBe('https://files.kick.com/avatar.webp')
    expect(fetchCount).toBe(1)
  })

  test('returns undefined without stable author id or lookup slug', async () => {
    const fetchCalls: string[] = []
    const resolver = createKickAvatarResolver({
      fetchFn: async (input) => {
        fetchCalls.push(String(input))
        return createJsonResponse('https://files.kick.com/avatar.webp')
      },
      now: () => 0,
    })

    const withoutAuthorId = await resolver({ lookupSource: 'slug', slugOrUsername: 'satont' })
    const withoutSlug = await resolver({ authorId: '11', lookupSource: 'slug' })

    expect(withoutAuthorId).toBeUndefined()
    expect(withoutSlug).toBeUndefined()
    expect(fetchCalls).toHaveLength(0)
  })

  test('does not negative-cache transient non-ok responses', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async () => {
        fetchCount += 1
        return createJsonResponse(null, 500)
      },
      now: () => currentTime,
    })

    await resolver({ authorId: '88', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_NEGATIVE_TTL_MS - 1
    await resolver({ authorId: '88', lookupSource: 'slug', slugOrUsername: 'satont' })

    expect(fetchCount).toBe(2)
  })

  test('does not negative-cache username fallback misses', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async () => {
        fetchCount += 1
        return createJsonResponse(null)
      },
      now: () => currentTime,
    })

    await resolver({ authorId: '101', lookupSource: 'username', slugOrUsername: 'Satont' })
    currentTime += KICK_AVATAR_NEGATIVE_TTL_MS - 1
    await resolver({ authorId: '101', lookupSource: 'username', slugOrUsername: 'Satont' })

    expect(fetchCount).toBe(2)
  })

  test('passes timeout signal to fetch and avoids caching timed out lookups', async () => {
    let currentTime = 0
    let fetchCount = 0
    const resolver = createKickAvatarResolver({
      fetchFn: async (_input, init) => {
        fetchCount += 1
        expect(init?.signal).toBeDefined()
        const timeoutSignal = init?.signal as AbortSignal
        expect(timeoutSignal.aborted).toBe(false)
        throw new DOMException('timed out', 'TimeoutError')
      },
      now: () => currentTime,
    })

    await resolver({ authorId: '201', lookupSource: 'slug', slugOrUsername: 'satont' })
    currentTime += KICK_AVATAR_FETCH_TIMEOUT_MS
    await resolver({ authorId: '201', lookupSource: 'slug', slugOrUsername: 'satont' })

    expect(fetchCount).toBe(2)
  })
})
