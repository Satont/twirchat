import { expect, spyOn, test } from 'bun:test'

import { z } from 'zod'

import { getEmoteSetById, getUserByConnection } from '../src/seventv/client'

const requestSchema = z.object({ query: z.string(), variables: z.record(z.string(), z.string()) })

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
    const signal = new AbortController().signal
    const user = await getUserByConnection('KICK', 'channel', signal)
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
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal)

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
