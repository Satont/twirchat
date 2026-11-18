import { expect, test } from 'bun:test'

import type { Account } from '@twirchat/shared/types'

import { createTwirChannelLookup } from '../src/services/twir-api'
import { resolveTwirTargets, type TwirChannelTarget } from '../src/services/twir-channels'
import { createTwirCommandsClient } from '../src/services/twir-commands'
import { createTwirNowPlayingClient } from '../src/services/twir-now-playing'

const API = 'https://twir.app/api'
const UUID = '42d0d76c-0691-4d5c-8d56-3608adc05dc6'
const COMMANDS = [
  { name: 'Hello', description: null },
  { name: 'prediction start', description: 'Start a prediction' },
  { name: '7tv delete', description: null },
]
const TARGETS: readonly TwirChannelTarget[] = [{ platform: 'kick', platformChannelId: '12345' }]

test('looks up a platform ID then fetches commands by Twir UUID, coalescing concurrent reads', async () => {
  const urls: string[] = []
  const getCommands = createTwirCommandsClient({
    fetcher: async (url, init) => {
      urls.push(url)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return url.endsWith('/commands')
        ? Response.json([
            ...COMMANDS.map((command) => ({ ...command, module: 'custom', responses: [] })),
            ...[
              '',
              ' prediction',
              'prediction ',
              'prediction  start',
              'prediction\tstart',
              'prediction\n',
              'prediction\u00a0start',
              'prediction\u0000',
              'prediction\ud800',
            ].map((name) => ({ name, description: null })),
          ])
        : Response.json({ channel_id: UUID })
    },
  })
  const first = getCommands(TARGETS)
  expect(getCommands(TARGETS)).toBe(first)
  expect(await first).toEqual(COMMANDS)
  expect(await getCommands(TARGETS)).toEqual(COMMANDS)
  expect(urls).toEqual([
    `${API}/v1/channels/by-platform/kick/12345`,
    `${API}/v2/channels/${UUID}/commands`,
  ])
})

test('resolves a watched channel slug before querying the Twir API', async () => {
  const watched: TwirChannelTarget = { platform: 'youtube', channelSlug: '@watched' }
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
  expect(await getCommands([watched])).toEqual(COMMANDS)
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
  expect(await getCommands(TARGETS)).toEqual([])
  expect(await getCommands(TARGETS)).toEqual([])
  expect(requests).toBe(1)
  now = 5 * 60_000
  expect(await getCommands(TARGETS)).toEqual([])
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
  expect(await getCommands(TARGETS)).toEqual([])
  expect(await getCommands(TARGETS)).toEqual([])
  expect(requests).toBe(1)
  now = 30_000
  expect(await getCommands(TARGETS)).toEqual([])
  expect(requests).toBe(3)
  now = 60_000
  expect(await getCommands(TARGETS)).toEqual(COMMANDS)
  expect(requests).toBe(4)
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
  expect(await getCommands(TARGETS)).toEqual([])
  commandList = COMMANDS
  expect(await getCommands(TARGETS, { refresh: true })).toEqual(COMMANDS)
  expect(await getCommands(TARGETS)).toEqual(COMMANDS)
  commandList = []
  expect(await getCommands(TARGETS, { refresh: true })).toEqual([])
  expect(await getCommands(TARGETS)).toEqual([])
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
  const initial = getCommands(TARGETS)
  expect(await Promise.all([initial, getCommands(TARGETS, { refresh: true })])).toEqual([
    COMMANDS,
    COMMANDS,
  ])
  expect(requests).toBe(2)

  const { promise, resolve } = Promise.withResolvers<Response>()
  pending = promise
  const refresh = getCommands(TARGETS, { refresh: true })
  expect(getCommands(TARGETS, { refresh: true })).toBe(refresh)
  const normal = getCommands(TARGETS)
  resolve(Response.json([{ name: false, description: null }]))
  await expect(refresh).rejects.toThrow('Twir returned an invalid response.')
  expect(await normal).toEqual(COMMANDS)
  expect(await getCommands(TARGETS)).toEqual(COMMANDS)
  expect(requests).toBe(4)

  pending = Promise.resolve(Response.json([]))
  expect(await getCommands(TARGETS, { refresh: true })).toEqual([])
  expect(await getCommands(TARGETS)).toEqual([])
  expect(requests).toBe(6)
})

function account(platform: Account['platform'], platformUserId: string): Account {
  return {
    id: `${platform}:${platformUserId}`,
    platform,
    platformUserId,
    username: 'streamer',
    displayName: 'Streamer',
    scopes: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

test('prioritizes Twitch in My Channels and keeps watched channels scoped to the pane', () => {
  const accounts = [account('kick', '12'), account('twitch', '34'), account('vkplay', '56')]
  expect(resolveTwirTargets({ accounts })).toEqual([
    { platform: 'twitch', platformChannelId: '34' },
    { platform: 'kick', platformChannelId: '12' },
    { platform: 'vkplay', platformChannelId: '56' },
  ])
  expect(
    resolveTwirTargets({
      accounts,
      watchedChannel: { platform: 'twitch', channelSlug: 'someone' },
      watchedChannelId: 'someone',
    }),
  ).toEqual([{ platform: 'twitch', channelSlug: 'someone' }])
  expect(
    resolveTwirTargets({ accounts, watchedChannel: { platform: 'kick', channelSlug: 'someone' } }),
  ).toEqual([])
})

test('commands and current track share first-channel resolution, even when it is idle', async () => {
  const targets = resolveTwirTargets({
    accounts: [account('kick', '12'), account('twitch', '34'), account('vkplay', '56')],
  })
  const urls: string[] = []
  const fetcher = async (url: string, init: RequestInit) => {
    expect(init.credentials).toBe('omit')
    urls.push(url)
    if (url.endsWith('/twitch/34')) return new Response(null, { status: 404 })
    if (url.endsWith('/kick/12')) return Response.json({ channel_id: UUID })
    if (url.endsWith('/commands')) return Response.json([])
    return Response.json({ data: null })
  }
  const lookupChannel = createTwirChannelLookup({ fetcher })
  const getCommands = createTwirCommandsClient({ fetcher, lookupChannel })
  const getTrack = createTwirNowPlayingClient({ fetcher, lookupChannel })
  expect(await Promise.all([getCommands(targets), getTrack(targets), getTrack(targets)])).toEqual([
    [],
    null,
    null,
  ])
  expect(urls.slice(0, 2)).toEqual([
    `${API}/v1/channels/by-platform/twitch/34`,
    `${API}/v1/channels/by-platform/kick/12`,
  ])
  expect(urls.slice(2).toSorted()).toEqual([
    `${API}/v1/channels/${UUID}/now-playing`,
    `${API}/v2/channels/${UUID}/commands`,
  ])
})

test('does not move to lower priority on a transient channel lookup error', async () => {
  const targets = resolveTwirTargets({ accounts: [account('kick', '12'), account('twitch', '34')] })
  const urls: string[] = []
  const getTrack = createTwirNowPlayingClient({
    fetcher: async (url) => {
      urls.push(url)
      return new Response(null, { status: 503 })
    },
  })
  expect(await getTrack(targets)).toBeNull()
  expect(await getTrack(targets)).toBeNull()
  expect(urls).toEqual([`${API}/v1/channels/by-platform/twitch/34`])
})

test.each([
  ['https://i.scdn.co/image/ab67616d0000b273a3cf', 'https://i.scdn.co/image/ab67616d0000b273a3cf'],
  [
    'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
    'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
  ],
  [null, undefined],
  [123, undefined],
  ['not a URL', undefined],
  ['http://i.scdn.co/image/abc', undefined],
  ['https://user:secret@i.scdn.co/image/abc', undefined],
  ['https://i.scdn.co:8443/image/abc', undefined],
  ['https://i.scdn.co.evil.example/image/abc', undefined],
  ['https://127.0.0.1/image/abc', undefined],
  ['https://i.scdn.co/other/abc', undefined],
])('accepts only supported public artwork URLs (%s)', async (imageUrl, expected) => {
  const getTrack = createTwirNowPlayingClient({
    fetcher: async (url) =>
      url.endsWith('/twitch/34')
        ? Response.json({ channel_id: UUID })
        : Response.json({
            data: {
              title: 'Evening Drive',
              artist: 'Night Shift',
              imageUrl,
              canvasUrl: 'https://i.scdn.co/image/abc',
            },
          }),
  })
  const targets = resolveTwirTargets({ accounts: [account('twitch', '34')] })
  const track = await getTrack(targets)
  expect(track).toEqual({ title: 'Evening Drive', artist: 'Night Shift', imageUrl: expected })
})

test('refreshes current tracks and backs off after rate limiting without retaining stale data', async () => {
  let now = 0
  let trackRequests = 0
  const getTrack = createTwirNowPlayingClient({
    now: () => now,
    fetcher: async (url) => {
      if (url.endsWith('/vk_video_live/56')) return Response.json({ channel_id: UUID })
      expect(url).toBe(`${API}/v1/channels/${UUID}/now-playing`)
      trackRequests++
      if (now === 30_000) return new Response(null, { status: 429 })
      return Response.json({ data: { title: ' Evening\nDrive ', artist: 'Night Shift' } })
    },
  })
  const targets = resolveTwirTargets({ accounts: [account('vkplay', '56')] })
  expect(await getTrack(targets)).toEqual({ title: 'Evening Drive', artist: 'Night Shift' })
  expect(await getTrack(targets)).toEqual({ title: 'Evening Drive', artist: 'Night Shift' })
  expect(trackRequests).toBe(1)
  now = 30_000
  expect(await getTrack(targets)).toBeNull()
  now = 60_000
  expect(await getTrack(targets)).toBeNull()
  expect(trackRequests).toBe(2)
  now = 90_000
  expect(await getTrack(targets)).toEqual({ title: 'Evening Drive', artist: 'Night Shift' })
  expect(trackRequests).toBe(3)
})
