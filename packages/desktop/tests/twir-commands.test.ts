import { expect, test } from 'bun:test'

import { createTwirCommandsClient, type TwirCommandTarget } from '../src/services/twir-commands'

const API = 'https://twir.app/api'
const UUID = '42d0d76c-0691-4d5c-8d56-3608adc05dc6'
const COMMANDS = [{ name: 'Hello', description: null }]
const TARGET: TwirCommandTarget = { platform: 'kick', platformChannelId: '12345' }

test('looks up a platform ID then fetches commands by Twir UUID, coalescing concurrent reads', async () => {
  const urls: string[] = []
  const getCommands = createTwirCommandsClient({
    fetcher: async (url, init) => {
      urls.push(url)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return url.endsWith('/commands')
        ? Response.json([
            { ...COMMANDS[0], module: 'custom', responses: [] },
            { name: '', description: null },
            { name: 'multiple words', description: null },
          ])
        : Response.json({ channel_id: UUID })
    },
  })
  const first = getCommands(TARGET)
  expect(getCommands(TARGET)).toBe(first)
  expect(await first).toEqual(COMMANDS)
  expect(await getCommands(TARGET)).toEqual(COMMANDS)
  expect(urls).toEqual([
    `${API}/v1/channels/by-platform/kick/12345`,
    `${API}/v2/channels/${UUID}/commands`,
  ])
})

test('resolves a watched channel slug before querying the Twir API', async () => {
  const watched: TwirCommandTarget = { platform: 'youtube', channelSlug: '@watched' }
  const channelId = 'UC0123456789012345678901'
  const getCommands = createTwirCommandsClient({
    resolveChannelId: async (target) => {
      expect(target).toEqual(watched)
      return channelId
    },
    fetcher: async (url) => {
      if (url.endsWith('/commands')) return Response.json(COMMANDS)
      expect(url).toBe(`${API}/v1/channels/by-platform/youtube/${channelId}`)
      return Response.json({ channel_id: UUID })
    },
  })
  expect(await getCommands(watched)).toEqual(COMMANDS)
})

test('caches unmapped channels and refreshes the lookup after the TTL', async () => {
  let now = 0
  let requests = 0
  const getCommands = createTwirCommandsClient({
    now: () => now,
    fetcher: async () => {
      requests++
      return new Response(null, { status: 404 })
    },
  })
  expect(await getCommands(TARGET)).toEqual([])
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(1)
  now = 5 * 60_000
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(2)
})

test('rejects malformed responses and retries after a short cooldown', async () => {
  let now = 0
  let requests = 0
  const getCommands = createTwirCommandsClient({
    now: () => now,
    fetcher: async (url) => {
      requests++
      if (url.endsWith('/commands'))
        return Response.json(now < 60_000 ? [{ name: false, description: null }] : COMMANDS)
      return Response.json({ channel_id: now === 0 ? '../invalid' : UUID })
    },
  })
  expect(await getCommands(TARGET)).toEqual([])
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(1)
  now = 30_000
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(3)
  now = 60_000
  expect(await getCommands(TARGET)).toEqual(COMMANDS)
  expect(requests).toBe(5)
})

test('explicit reload bypasses an unmapped or fresh cached result and replaces it', async () => {
  let commandList: typeof COMMANDS | undefined
  let requests = 0
  const getCommands = createTwirCommandsClient({
    fetcher: async (url) => {
      requests++
      if (!commandList) return new Response(null, { status: 404 })
      return url.endsWith('/commands')
        ? Response.json(commandList)
        : Response.json({ channel_id: UUID })
    },
  })
  expect(await getCommands(TARGET)).toEqual([])
  commandList = COMMANDS
  expect(await getCommands(TARGET, { refresh: true })).toEqual(COMMANDS)
  expect(await getCommands(TARGET)).toEqual(COMMANDS)
  commandList = []
  expect(await getCommands(TARGET, { refresh: true })).toEqual([])
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(5)
})

test('normal and explicit reloads share pending work and failed reloads keep prior commands', async () => {
  let pending: Promise<Response> | undefined
  let requests = 0
  const getCommands = createTwirCommandsClient({
    fetcher: async (url) => {
      requests++
      if (url.endsWith('/commands')) return pending ?? Response.json(COMMANDS)
      return Response.json({ channel_id: UUID })
    },
  })
  const initial = getCommands(TARGET)
  expect(await Promise.all([initial, getCommands(TARGET, { refresh: true })])).toEqual([
    COMMANDS,
    COMMANDS,
  ])
  expect(requests).toBe(2)

  const { promise, resolve } = Promise.withResolvers<Response>()
  pending = promise
  const refresh = getCommands(TARGET, { refresh: true })
  expect(getCommands(TARGET, { refresh: true })).toBe(refresh)
  const normal = getCommands(TARGET)
  resolve(Response.json([{ name: false, description: null }]))
  await expect(refresh).rejects.toThrow('Twir returned an invalid response.')
  expect(await normal).toEqual(COMMANDS)
  expect(await getCommands(TARGET)).toEqual(COMMANDS)
  expect(requests).toBe(4)

  pending = Promise.resolve(Response.json([]))
  expect(await getCommands(TARGET, { refresh: true })).toEqual([])
  expect(await getCommands(TARGET)).toEqual([])
  expect(requests).toBe(6)
})
