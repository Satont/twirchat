import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

import { createKickRead, fetchTwitchHelixWithAppToken } from '../src/api/app-credentials'
import { fetchUrl } from './literal'

const twitchTokenUrl = 'https://id.twitch.tv/oauth2/token'
const kickTokenUrl = 'https://id.kick.com/oauth/token'
const kickReadUrl = 'https://api.kick.com/public/v1/channels'
const helixUrl = 'https://api.twitch.tv/helix/users'

const originalFetch = globalThis.fetch
let now = Date.now()

async function getHelixAuthorization(): Promise<unknown> {
  return (await fetchTwitchHelixWithAppToken(helixUrl)).json()
}

async function getKickReadHeaders(): Promise<unknown> {
  const read = await createKickRead()
  return (await read('/public/v1/channels')).json()
}

function kickReadResponse(init: RequestInit | undefined): Response {
  const headers = new Headers(init?.headers)
  return Response.json({
    Authorization: headers.get('Authorization'),
    'Client-ID': headers.get('Client-ID'),
  })
}

beforeEach(() => {
  // Advance past any cached grant from an earlier test in this file.
  now += 86_400_000
  spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

test('app grant HTTP failures discard provider bodies and expose safe errors', async () => {
  const probes: (() => void)[] = []
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      expect([twitchTokenUrl, kickTokenUrl]).toContain(fetchUrl(input))
      const response = new Response('Unauthorized: synthetic upstream detail', { status: 401 })
      if (!response.body) throw new Error('Expected a fixture body')
      const text = spyOn(response, 'text')
      const cancel = spyOn(response.body, 'cancel')
      probes.push(() => {
        expect(text).not.toHaveBeenCalled()
        expect(cancel).toHaveBeenCalledTimes(1)
      })
      return response
    },
    { preconnect: originalFetch.preconnect },
  )
  const errors = await Promise.allSettled([getHelixAuthorization(), createKickRead()])
  expect(errors).toEqual([
    { status: 'rejected', reason: new Error('Unable to obtain Twitch application credentials.') },
    { status: 'rejected', reason: new Error('Unable to obtain Kick application credentials.') },
  ])
  expect(probes).toHaveLength(2)
  for (const verify of probes) verify()
})

test('coalesces Twitch grants, caches by provider, and refreshes at the 60-second margin', async () => {
  const twitchGrant = Promise.withResolvers<Response>()
  let twitchGrants = 0
  let kickGrants = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url === kickReadUrl) return kickReadResponse(init)
      if (url === helixUrl) return Response.json(new Headers(init?.headers).get('Authorization'))
      if (url !== twitchTokenUrl && url !== kickTokenUrl)
        throw new Error(`Unexpected fetch: ${url}`)
      const provider = url === twitchTokenUrl ? 'twitch' : 'kick'
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Content-Type')).toBe(
        'application/x-www-form-urlencoded',
      )
      expect(init?.body).toEqual(
        new URLSearchParams({
          client_id: `test-${provider}-client-id`,
          client_secret: `test-${provider}-client-secret`,
          grant_type: 'client_credentials',
        }),
      )
      if (provider === 'kick') {
        kickGrants++
        return Response.json({ access_token: 'kick', expires_in: 3600 })
      }
      twitchGrants++
      if (twitchGrants === 1) return twitchGrant.promise
      return Response.json({ access_token: 'twitch-2', expires_in: 120 })
    },
    { preconnect: originalFetch.preconnect },
  )

  const first = getHelixAuthorization()
  const second = getHelixAuthorization()
  twitchGrant.resolve(Response.json({ access_token: 'twitch-1', expires_in: 120 }))
  expect(await Promise.all([first, second])).toEqual(['Bearer twitch-1', 'Bearer twitch-1'])
  expect(twitchGrants).toBe(1)
  expect(await getKickReadHeaders()).toEqual({
    Authorization: 'Bearer kick',
    'Client-ID': 'test-kick-client-id',
  })
  now += 59_999
  expect(await getHelixAuthorization()).toBe('Bearer twitch-1')
  now++
  expect(await getHelixAuthorization()).toBe('Bearer twitch-2')
  expect(await getKickReadHeaders()).toEqual({
    Authorization: 'Bearer kick',
    'Client-ID': 'test-kick-client-id',
  })
  expect([twitchGrants, kickGrants]).toEqual([2, 1])
})

test('Kick shares a cold or expiring grant across callers', async () => {
  let grant = Promise.withResolvers<string>()
  let requests = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (fetchUrl(input) === kickReadUrl) return kickReadResponse(init)
      expect(fetchUrl(input)).toBe(kickTokenUrl)
      requests++
      return Response.json({ access_token: await grant.promise, expires_in: 120 })
    },
    { preconnect: originalFetch.preconnect },
  )

  async function expectSharedGrant(token: string) {
    const first = getKickReadHeaders()
    const second = getKickReadHeaders()
    grant.resolve(token)
    const expected = { Authorization: `Bearer ${token}`, 'Client-ID': 'test-kick-client-id' }
    expect(await Promise.all([first, second])).toEqual([expected, expected])
    expect(await getKickReadHeaders()).toEqual(expected)
  }

  await expectSharedGrant('kick-first')
  now += 60_000
  grant = Promise.withResolvers<string>()
  await expectSharedGrant('kick-renewed')
  expect(requests).toBe(2)
})

test('a timed-out Kick grant rejects all waiters and does not poison the cache', async () => {
  const deadline = new AbortController()
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    ms === 8000 ? deadline.signal : originalTimeout(ms),
  )
  let requests = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (fetchUrl(input) === kickReadUrl) return kickReadResponse(init)
      expect(fetchUrl(input)).toBe(kickTokenUrl)
      if (++requests > 1) return Response.json({ access_token: 'kick-recovered', expires_in: 120 })
      const signal = init?.signal
      if (!signal) throw new Error('Expected a grant deadline')
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
    { preconnect: originalFetch.preconnect },
  )

  const waiting = Promise.allSettled([getKickReadHeaders(), getKickReadHeaders()])
  const reason = new DOMException('Grant deadline elapsed', 'TimeoutError')
  deadline.abort(reason)
  expect(await waiting).toEqual([
    { status: 'rejected', reason },
    { status: 'rejected', reason },
  ])
  expect(timeout.mock.calls).toEqual([[20_000], [8000], [20_000]])
  timeout.mockRestore()
  expect(await getKickReadHeaders()).toEqual({
    Authorization: 'Bearer kick-recovered',
    'Client-ID': 'test-kick-client-id',
  })
  expect(requests).toBe(2)
})

for (const [description, renewedToken] of [
  ['with a different token', 'grant-2'],
  ['with the same token', 'grant-1'],
]) {
  test(`a delayed Helix 401 cannot evict a newer grant ${description}`, async () => {
    const firstAttempt = Promise.withResolvers<void>()
    const delayedResponse = Promise.withResolvers<Response>()
    const attempts: (string | null)[] = []
    let grants = 0
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = fetchUrl(input)
        if (url === twitchTokenUrl) {
          grants++
          return Response.json({
            access_token: grants === 1 ? 'grant-1' : renewedToken,
            expires_in: 3600,
          })
        }
        if (url !== helixUrl) throw new Error(`Unexpected fetch: ${url}`)
        const authorization = new Headers(init?.headers).get('Authorization')
        attempts.push(authorization)
        if (attempts.length === 1) {
          firstAttempt.resolve()
          return delayedResponse.promise
        }
        if (attempts.length === 2) return new Response(null, { status: 401 })
        return Response.json(authorization)
      },
      { preconnect: originalFetch.preconnect },
    )

    const delayed = getHelixAuthorization()
    await firstAttempt.promise
    const refreshed = await getHelixAuthorization()
    delayedResponse.resolve(new Response(null, { status: 401 }))
    expect(await delayed).toBe(`Bearer ${renewedToken}`)
    expect(refreshed).toBe(`Bearer ${renewedToken}`)
    expect(await getHelixAuthorization()).toBe(`Bearer ${renewedToken}`)
    expect(attempts).toEqual([
      'Bearer grant-1',
      'Bearer grant-1',
      `Bearer ${renewedToken}`,
      `Bearer ${renewedToken}`,
      `Bearer ${renewedToken}`,
    ])
    expect(grants).toBe(2)
  })
}

test('Helix preserves caller options, owns auth headers, and retries a 401 only once', async () => {
  const signal = new AbortController().signal
  const headers = { Authorization: 'override', 'Client-Id': 'override', 'X-Example': 'kept' }
  const attempts: (string | null)[] = []
  let grants = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
      if (url === twitchTokenUrl) {
        grants++
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return Response.json({ access_token: `grant-${grants}`, expires_in: 3600 })
      }
      if (url !== helixUrl) throw new Error(`Unexpected fetch: ${url}`)
      const sent = new Headers(init?.headers)
      expect(init?.signal).toBe(signal)
      expect(init?.method).toBe('HEAD')
      expect(sent.get('Client-Id')).toBe('test-twitch-client-id')
      expect(sent.get('X-Example')).toBe('kept')
      attempts.push(sent.get('Authorization'))
      return new Response(null, { status: 401 })
    },
    { preconnect: originalFetch.preconnect },
  )

  const response = await fetchTwitchHelixWithAppToken(helixUrl, { headers, method: 'HEAD', signal })
  expect(response.status).toBe(401)
  expect(grants).toBe(2)
  expect(attempts).toEqual(['Bearer grant-1', 'Bearer grant-2'])
  expect(headers.Authorization).toBe('override')
})
