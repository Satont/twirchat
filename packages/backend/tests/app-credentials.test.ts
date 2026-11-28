import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

import { fetchTwitchHelixWithAppToken, getKickAppHeaders } from '../src/api/app-credentials'
import { fetchUrl } from './literal'

const twitchTokenUrl = 'https://id.twitch.tv/oauth2/token'
const kickTokenUrl = 'https://id.kick.com/oauth/token'
const helixUrl = 'https://api.twitch.tv/helix/users'

const originalFetch = globalThis.fetch
let now = Date.now()

async function getHelixAuthorization(): Promise<unknown> {
  return (await fetchTwitchHelixWithAppToken(helixUrl)).json()
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

test('coalesces Twitch grants, caches by provider, and refreshes at the 60-second margin', async () => {
  const twitchGrant = Promise.withResolvers<Response>()
  let twitchGrants = 0
  let kickGrants = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = fetchUrl(input)
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
  expect(await getKickAppHeaders()).toEqual({
    Authorization: 'Bearer kick',
    'Client-ID': 'test-kick-client-id',
  })
  now += 59_999
  expect(await getHelixAuthorization()).toBe('Bearer twitch-1')
  now++
  expect(await getHelixAuthorization()).toBe('Bearer twitch-2')
  expect(await getKickAppHeaders()).toEqual({
    Authorization: 'Bearer kick',
    'Client-ID': 'test-kick-client-id',
  })
  expect([twitchGrants, kickGrants]).toEqual([2, 1])
})

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
