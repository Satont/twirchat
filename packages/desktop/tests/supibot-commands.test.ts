import { expect, test } from 'bun:test'

import { createSupibotCommandsClient } from '../src/services/supibot-commands'

const API = 'https://supinic.com/api/bot'
const CHANNELS_URL = `${API}/channel/list?platformName=twitch`
const CATALOG_URL = `${API}/command/list/`
const ALICE_URL = `${API}/user/alice/alias/list/`
const BOB_URL = `${API}/user/bob/alias/list/`

test('keeps Supibot user aliases separate from same-name commands and from other accounts', async () => {
  const requests: string[] = []
  const getCommands = createSupibotCommandsClient({
    fetcher: async (url, init) => {
      requests.push(url)
      expect(init.credentials).toBe('omit')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      switch (url) {
        case CHANNELS_URL:
          return Response.json({
            statusCode: 200,
            data: [
              { name: 'Qa', platformName: 'twitch', mode: 'Moderator' },
              { name: 'other', platformName: 'twitch', mode: 'Write' },
              { name: 'read_only', platformName: 'twitch', mode: 'Read' },
              { name: 'inactive', platformName: 'twitch', mode: 'Last seen' },
              { name: 'kick_only', platformName: 'kick', mode: 'Write' },
            ],
          })
        case CATALOG_URL:
          return Response.json({
            data: [
              { name: 'ping', aliases: ['Pong', 'two words'], description: 'Ping' },
              { name: 'alias', aliases: ['$'] },
            ],
          })
        case ALICE_URL:
          return Response.json({
            statusCode: 200,
            data: [
              { name: 'ping', description: 'My ping' },
              { name: 'aliceOnly', invocation: 'other', description: null },
              { name: 'AliceOnly', description: 'Duplicate' },
            ],
          })
        case BOB_URL:
          return Response.json({ data: [{ name: 'bobOnly' }] })
        default:
          throw new Error(`Unexpected Supibot request: ${url}`)
      }
    },
  })

  const [alice, bob, anonymous] = await Promise.all([
    getCommands({ channelLogin: 'QA', userLogin: 'Alice' }),
    getCommands({ channelLogin: 'qa', userLogin: 'bob' }),
    getCommands({ channelLogin: 'qa' }),
  ])
  expect(anonymous).toMatchObject([
    { prefix: '$', name: 'ping', description: 'Ping' },
    { prefix: '$', name: 'alias' },
    { prefix: '$', name: 'Pong', aliasFor: 'ping' },
    { prefix: '$', name: '$', aliasFor: 'alias' },
  ])
  expect(alice).toMatchObject([
    ...anonymous,
    { prefix: '$$', name: 'ping', description: 'My ping' },
    { prefix: '$$', name: 'aliceOnly', description: '$other' },
  ])
  expect(bob).toMatchObject([...anonymous, { prefix: '$$', name: 'bobOnly' }])
  expect(await getCommands({ channelLogin: 'other', userLogin: 'ALICE' })).toEqual(alice)
  const inactiveChannels = ['missing', 'read_only', 'inactive', 'kick_only', '../bad']
  const inactive = await Promise.all(
    inactiveChannels.map((channelLogin) =>
      getCommands({ channelLogin, userLogin: 'should_not_fetch' }),
    ),
  )
  expect(inactive).toEqual([[], [], [], [], []])
  expect(await getCommands({ channelLogin: 'qa', userLogin: '../invalid' })).toEqual(anonymous)
  expect(requests).toEqual([CHANNELS_URL, CATALOG_URL, ALICE_URL, BOB_URL])
})

test('retries catalog and alias failures independently without hiding available suggestions', async () => {
  let now = 1000
  let catalogRequests = 0
  let aliasRequests = 0
  const getCommands = createSupibotCommandsClient({
    now: () => now,
    fetcher: async (url) => {
      if (url === CHANNELS_URL) {
        return Response.json({
          data: [{ name: 'qa', platformName: 'twitch', mode: 'Write' }],
        })
      }
      if (url === CATALOG_URL) {
        catalogRequests++
        return catalogRequests === 1
          ? new Response(null, { status: 503 })
          : Response.json({ data: [{ name: 'ping' }] })
      }
      if (url === ALICE_URL) {
        aliasRequests++
        return aliasRequests === 1
          ? new Response(null, { status: 503 })
          : Response.json({ data: [{ name: 'first' }] })
      }
      if (url === BOB_URL) return Response.json({ data: [{ name: 'second' }] })
      throw new Error(`Unexpected Supibot request: ${url}`)
    },
  })

  const alice = { channelLogin: 'qa', userLogin: 'alice' }
  expect(await getCommands(alice)).toEqual([])
  expect(await getCommands({ channelLogin: 'qa', userLogin: 'bob' })).toMatchObject([
    { prefix: '$$', name: 'second' },
  ])
  now += 30_001
  expect(await getCommands({ channelLogin: 'qa' })).toMatchObject([{ prefix: '$', name: 'ping' }])
  expect(aliasRequests).toBe(1)
  expect(await getCommands(alice)).toMatchObject([
    { prefix: '$', name: 'ping' },
    { prefix: '$$', name: 'first' },
  ])
  expect(catalogRequests).toBe(2)
  expect(aliasRequests).toBe(2)
})
