import { describe, expect, test } from 'bun:test'

import type { createYouTubeGrpcSession } from '@twirchat/shared/youtube'
import type { YouTubeChatRelayEvent } from '@twirchat/shared/youtube-chat'

import { type YouTubeRelayOptions, YouTubeChatRelay } from '../src/youtube/relay'
import { required } from './literal'

type Options = Parameters<typeof createYouTubeGrpcSession>[0]
function fixture(
  settings: {
    apiKey?: string
    maxStreams?: number
    maxSubscriptions?: number
    maxSubscriptionsPerClient?: number
  } = {},
) {
  const sent: { client: string; event: YouTubeChatRelayEvent }[] = []
  const sessions: { options: Options; stopped: number; started: number }[] = []
  let resolutions = 0
  const relay = new YouTubeChatRelay({
    apiKey: 'server-only-key',
    ...settings,
    send: (client, event) => {
      sent.push({ client, event })
    },
    resolve: async ({ channelId }) => {
      resolutions++
      return {
        channelId,
        videoId: 'video',
        liveChatId: channelId === 'other' ? 'other-chat' : 'shared-chat',
      }
    },
    createSession: (options) => {
      const state = { options, stopped: 0, started: 0 }
      sessions.push(state)
      return {
        start: async () => {
          state.started++
        },
        stop: () => {
          state.stopped++
        },
        getResumeToken: () => 'next-token',
      }
    },
  })
  return {
    relay,
    sent,
    sessions,
    get resolutions() {
      return resolutions
    },
  }
}
const request = (channelId = 'channel', subscriptionId = 'sub') => ({ channelId, subscriptionId })

describe('anonymous YouTube gRPC relay', () => {
  test('coalesces metadata and one upstream across clients; disconnect stops only last subscriber', async () => {
    const f = fixture()
    await Promise.all([f.relay.subscribe('a', request()), f.relay.subscribe('b', request())])
    expect(f.resolutions).toBe(1)
    expect(f.sessions).toHaveLength(1)
    expect(required(f.sessions[0]).started).toBe(1)
    expect(await required(f.sessions[0]).options.getCredentials()).toEqual({
      apiKey: 'server-only-key',
    })
    f.relay.cleanupClient('a')
    expect(required(f.sessions[0]).stopped).toBe(0)
    f.relay.unsubscribe('a', 'sub')
    required(f.sessions[0]).options.onStatus('connected')
    expect(f.sent.at(-1)?.client).toBe('b')
    f.relay.cleanupClient('b')
    expect(required(f.sessions[0]).stopped).toBe(1)
    expect(JSON.stringify(f.sent)).not.toContain('server-only-key')
  })

  test('normalizes shared upstream batches in each subscriber channel context', async () => {
    const f = fixture()
    await f.relay.subscribe('a', request('channel'))
    await f.relay.subscribe('b', request('@alias'))
    required(f.sessions[0]).options.onBatch({
      items: [
        {
          id: 'message',
          snippet: {
            type: 1,
            displayMessage: 'hello',
            publishedAt: '2026-01-01T00:00:00Z',
            textMessageDetails: { messageText: 'hello' },
            authorChannelId: 'author',
          },
          authorDetails: { channelId: 'author', displayName: 'Reader' },
        },
      ],
    })
    const batches = f.sent.filter((item) => item.event.type === 'batch')
    expect(batches).toHaveLength(2)
    expect(
      batches.map((item) => item.event.type === 'batch' && item.event.batch.messages[0]?.channelId),
    ).toEqual(['channel', '@alias'])
    f.relay.stop()
  })

  test('replacement and disconnect invalidate pending metadata and stale stream callbacks', async () => {
    const f = fixture()
    await f.relay.subscribe('a', request())
    const first = required(f.sessions[0])
    await f.relay.subscribe('a', request('other'))
    expect(first.stopped).toBe(1)
    const count = f.sent.length
    first.options.onStatus('error', 'secret-key-in-google-error', true)
    first.options.onBatch({ items: [] })
    expect(f.sent).toHaveLength(count)
    f.relay.stop()

    const { promise: resolution, resolve: finish } =
      Promise.withResolvers<Awaited<ReturnType<NonNullable<YouTubeRelayOptions['resolve']>>>>()
    let started = 0
    const relay = new YouTubeChatRelay({
      apiKey: 'key',
      send: () => {},
      resolve: () => resolution,
      createSession: () => {
        started++
        throw new Error('must not run')
      },
    })
    const pending = relay.subscribe('client', request())
    relay.cleanupClient('client')
    finish({ channelId: 'channel', videoId: 'v', liveChatId: 'chat' })
    await pending
    expect(started).toBe(0)
  })

  test('missing key and invalid payload fail closed without Google calls', async () => {
    const f = fixture({ apiKey: undefined })
    await f.relay.subscribe('a', request())
    await f.relay.subscribe('a', { ...request(), channelId: 'https://evil.test' })
    await f.relay.subscribe('a', { ...request(), subscriptionId: {} })
    await f.relay.subscribe('a', null)
    expect(f.resolutions).toBe(0)
    expect(f.sessions).toHaveLength(0)
    expect(f.sent.every((item) => item.event.type === 'status' && item.event.terminal)).toBe(true)
  })

  test('bounds per-client/global subscriptions and upstream streams', async () => {
    const f = fixture({ maxSubscriptionsPerClient: 1, maxSubscriptions: 2, maxStreams: 1 })
    await f.relay.subscribe('a', request())
    await f.relay.subscribe('a', request('channel', 'second'))
    await f.relay.subscribe('b', request())
    await f.relay.subscribe('c', request())
    expect(f.sessions).toHaveLength(1)
    expect(
      f.sent.filter((item) => item.event.type === 'status' && item.event.terminal),
    ).toHaveLength(2)
    f.relay.cleanupClient('b')
    await f.relay.subscribe('c', request('other'))
    expect(f.sessions).toHaveLength(1)
    expect(f.sent.at(-1)?.event.type).toBe('status')
    f.relay.stop()
    expect(required(f.sessions[0]).stopped).toBe(1)
  })

  test('terminal statuses sanitize credentials and require explicit resubscription', async () => {
    const f = fixture()
    await f.relay.subscribe('a', request())
    required(f.sessions[0]).options.onStatus('error', 'server-only-key private Google error', true)
    expect(required(f.sessions[0]).stopped).toBe(1)
    expect(f.sent.at(-1)?.event).toMatchObject({
      status: 'error',
      terminal: true,
      error: 'YouTube chat stream unavailable',
    })
    expect(JSON.stringify(f.sent)).not.toContain('server-only-key')
    await f.relay.subscribe('a', request())
    expect(f.sessions).toHaveLength(2)
    f.relay.stop()
  })
})

test('pending replacement cannot publish stale resolution or create an abandoned stream', async () => {
  const pending = new Map<
    string,
    (chat: { channelId: string; videoId: string; liveChatId: string }) => void
  >()
  const events: YouTubeChatRelayEvent[] = []
  const chats: string[] = []
  const relay = new YouTubeChatRelay({
    apiKey: 'key',
    send: (_, event) => {
      events.push(event)
    },
    resolve: ({ channelId }) =>
      new Promise((resolve) => {
        pending.set(channelId, resolve)
      }),
    createSession: (options) => {
      chats.push(options.liveChatId)
      return { start: async () => {}, stop: () => {}, getResumeToken: () => undefined }
    },
  })
  const old = relay.subscribe('client', request('old'))
  const replacement = relay.subscribe('client', request('new'))
  required(pending.get('old'))({ channelId: 'old', videoId: 'old-video', liveChatId: 'old-chat' })
  await old
  expect(chats).toHaveLength(0)
  required(pending.get('new'))({ channelId: 'new', videoId: 'new-video', liveChatId: 'new-chat' })
  await replacement
  expect(chats).toEqual(['new-chat'])
  expect(events.filter((event) => event.type === 'ready')).toEqual([
    {
      type: 'ready',
      subscriptionId: 'sub',
      channelId: 'new',
      videoId: 'new-video',
      liveChatId: 'new-chat',
    },
  ])
  relay.stop()
})

test('abandoned pending metadata requests remain globally bounded', async () => {
  const pending: (() => void)[] = []
  const events: YouTubeChatRelayEvent[] = []
  let resolved = 0
  const relay = new YouTubeChatRelay({
    apiKey: 'key',
    send: (_, event) => {
      events.push(event)
    },
    resolve: ({ channelId }) => {
      resolved++
      return new Promise((resolve) => {
        pending.push(() => resolve({ channelId, videoId: 'video', liveChatId: channelId }))
      })
    },
    createSession: () => {
      throw new Error('abandoned resolution must not start')
    },
  })
  const subscriptions = Array.from({ length: 128 }, (_, index) => {
    const subscription = relay.subscribe('client', request(`channel-${index}`))
    relay.cleanupClient('client')
    return subscription
  })
  await relay.subscribe('client', request('overflow'))
  expect(resolved).toBe(128)
  expect(events.at(-1)).toMatchObject({ type: 'status', terminal: true, status: 'error' })
  for (const finish of pending) finish()
  await Promise.all(subscriptions)
  relay.stop()
})
