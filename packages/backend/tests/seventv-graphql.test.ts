import { expect, spyOn, test } from 'bun:test'

import { z } from 'zod'

import { getEmoteSetById, getUserByConnection } from '../src/seventv/client'

const requestSchema = z.object({ query: z.string(), variables: z.record(z.string(), z.string()) })

test.each(['headers', 'body', 'caller cancellation'])(
  '7TV catalog requests abort during %s',
  async (phase) => {
    const deadline = new AbortController()
    const caller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const originalFetch = globalThis.fetch
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        if (phase === 'headers') {
          entered.resolve()
          return release.promise
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'))
            },
          }),
        )
      },
    })
    const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          expect(url).toBe('https://7tv.io/v4/gql')
          const response = await originalFetch(server.url, init)
          if (phase !== 'headers') entered.resolve()
          return response
        },
        { preconnect: originalFetch.preconnect },
      ),
    )
    const result = Promise.allSettled([
      phase === 'headers'
        ? getEmoteSetById('set')
        : getUserByConnection('KICK', 'channel', caller.signal),
    ])
    const watchdog = Promise.withResolvers<never>()
    const timer = setTimeout(
      () => watchdog.reject(new Error('Loopback request did not settle')),
      2_000,
    )
    try {
      await Promise.race([entered.promise, result, watchdog.promise])
      // Assert the budget before aborting so a missing signal fails without waiting on the server.
      expect(timeout.mock.calls).toEqual([[10_000]])
      const cancellation = phase === 'caller cancellation'
      const reason = new DOMException(
        'Fixture stopped',
        cancellation ? 'AbortError' : 'TimeoutError',
      )
      if (cancellation) caller.abort(reason)
      else deadline.abort(reason)
      const [settled] = await Promise.race([result, watchdog.promise])
      expect(settled?.status === 'rejected' ? settled.reason : undefined).toBe(reason)
    } finally {
      clearTimeout(timer)
      release.resolve(new Response(null, { status: 503 }))
      timeout.mockRestore()
      fetchMock.mockRestore()
      await server.stop(true)
    }
  },
)

test('7TV catalog requests validate the same set shape without collapsing null and omission', async () => {
  const valid = { id: 'set', name: 'Set', emotes: { items: [] } }
  const invalid = { ...valid, emotes: { items: [{ id: 'incomplete' }] } }
  const connection = (style: { activeEmoteSet?: typeof valid | typeof invalid | null }) =>
    Response.json({ data: { users: { userByConnection: { id: 'user', style } } } })
  const byId = (emoteSet: typeof valid | typeof invalid) =>
    Response.json({ data: { emoteSets: { emoteSet } } })
  const fetchMock = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(connection({ activeEmoteSet: valid }))
    .mockResolvedValueOnce(byId(valid))
    .mockResolvedValueOnce(connection({ activeEmoteSet: null }))
    .mockResolvedValueOnce(connection({}))
    .mockResolvedValueOnce(connection({ activeEmoteSet: invalid }))
    .mockResolvedValueOnce(byId(invalid))
  try {
    const user = await getUserByConnection('KICK', 'channel')
    expect(user.users.userByConnection?.style.activeEmoteSet).toEqual(valid)
    expect((await getEmoteSetById('set')).emoteSets.emoteSet).toEqual(valid)
    const requests = fetchMock.mock.calls.map(([url, init]) => {
      expect(url).toBe('https://7tv.io/v4/gql')
      expect(init?.method).toBe('POST')
      if (typeof init?.body !== 'string') throw new Error('Expected a GraphQL request body')
      return requestSchema.parse(JSON.parse(init.body))
    })
    expect(requests[0]?.variables).toEqual({ platform: 'KICK', platformId: 'channel' })
    expect(requests[0]?.query).toContain('query GetUserByConnection(')
    expect(requests[1]?.variables).toEqual({ id: 'set' })
    expect(requests[1]?.query).toContain('query GetEmoteSetById(')
    expect(requests.map(({ query }) => query.includes('emotes(perPage: 1000)'))).toEqual([
      true,
      true,
    ])

    const inactive = await getUserByConnection('KICK', 'channel')
    expect(inactive.users.userByConnection?.style.activeEmoteSet).toBeNull()
    const incomplete = await getUserByConnection('KICK', 'channel')
    expect(incomplete.users.userByConnection?.style.activeEmoteSet).toBeUndefined()
    await expect(getUserByConnection('KICK', 'channel')).rejects.toBeInstanceOf(z.ZodError)
    await expect(getEmoteSetById('set')).rejects.toBeInstanceOf(z.ZodError)
  } finally {
    fetchMock.mockRestore()
  }
})
