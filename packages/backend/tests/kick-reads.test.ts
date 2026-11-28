import { afterEach, expect, mock, spyOn, test } from 'bun:test'

import { handleChannelsStatus } from '../src/api/channels-status'
import { handleSearchCategories } from '../src/api/search-categories'
import { handleStreamStatus } from '../src/api/stream-status'
import { fetchUrl } from './literal'

const originalFetch = globalThis.fetch
const grantUrl = 'https://id.kick.com/oauth/token'
const singleUrl = new URL('http://localhost/api/stream-status?platform=kick&channelId=channel')
const searchUrl = new URL('http://localhost/api/search-categories?platform=kick&query=games')

function batchRequest(count: number): Request {
  return new Request('http://localhost/api/channels-status', {
    method: 'POST',
    body: JSON.stringify({
      channels: Array.from({ length: count }, (_, index) => ({
        channelLogin: `channel-${index}`,
        platform: 'kick',
      })),
    }),
  })
}

function mockKickReads(read: (url: URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(fetchUrl(input))
      if (url.href === grantUrl) return Response.json({ access_token: 'kick', expires_in: 3600 })
      expect(url.origin).toBe('https://api.kick.com')
      return read(url, init)
    },
    { preconnect: originalFetch.preconnect },
  )
}

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

test('preserves the distinct failure contracts for Kick HTTP errors', async () => {
  mockKickReads(async () => new Response(null, { status: 502 }))
  await expect(handleStreamStatus(singleUrl)).rejects.toThrow('Kick channels API failed: 502')
  await expect(handleSearchCategories(searchUrl)).rejects.toThrow(
    'Kick categories search failed: 502',
  )
  expect(await handleChannelsStatus(batchRequest(1))).toEqual({
    channels: [{ channelLogin: 'channel-0', isLive: false, platform: 'kick', title: '' }],
  })
})

test('single status and category reads use separate operation deadlines', async () => {
  const first = new AbortController()
  const second = new AbortController()
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  const deadlines = [first.signal, second.signal]
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    ms === 20_000 ? (deadlines.shift() ?? originalTimeout(ms)) : originalTimeout(ms),
  )
  const signals: (AbortSignal | null | undefined)[] = []
  mockKickReads(async (_url, init) => {
    signals.push(init?.signal)
    return Response.json({ data: [] })
  })
  expect(await handleStreamStatus(singleUrl)).toEqual({ isLive: false, title: '' })
  expect(await handleSearchCategories(searchUrl)).toEqual({ categories: [] })
  expect(signals).toEqual([first.signal, second.signal])
  expect(timeout.mock.calls.filter(([ms]) => ms === 20_000)).toHaveLength(2)
})

test('batch shares a deadline across waves and never starts queued reads after expiry', async () => {
  const deadline = new AbortController()
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    ms === 20_000 ? deadline.signal : originalTimeout(ms),
  )
  const secondWave = Promise.withResolvers<void>()
  const allowFirstWave = Promise.withResolvers<void>()
  let requests = 0
  mockKickReads(async (_url, init) => {
    expect(init?.signal).toBe(deadline.signal)
    const index = ++requests
    if (index <= 5) await allowFirstWave.promise
    if (index === 10) secondWave.resolve()
    if (index > 5 && !deadline.signal.aborted) {
      await new Promise<void>((resolve) => {
        deadline.signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    return Response.json({ data: [] })
  })

  const batch = handleChannelsStatus(batchRequest(12))
  const outcome = Promise.allSettled([batch])
  allowFirstWave.resolve()
  const reason = new DOMException('Kick read budget elapsed', 'TimeoutError')
  try {
    await Promise.race([secondWave.promise, outcome])
  } finally {
    deadline.abort(reason)
  }
  expect(await outcome).toEqual([{ status: 'rejected', reason }])
  expect(requests).toBe(10)
  expect(timeout.mock.calls.filter(([ms]) => ms === 20_000)).toHaveLength(1)
})
