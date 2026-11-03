import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'

import {
  type ServerWritableStream,
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  status,
} from '@grpc/grpc-js'
import type { BackendToDesktopMessage, DesktopToBackendMessage } from '@twirchat/shared/protocol'
import {
  createYouTubeChatNormalizer,
  createYouTubeGrpcSession,
  resolveYouTubeLiveChat,
} from '@twirchat/shared/youtube'
import {
  type DeepPartial,
  type LiveChatMessageListRequest,
  LiveChatMessageListResponse,
  LiveChatMessage,
  V3DataLiveChatMessageServiceClient,
  V3DataLiveChatMessageServiceService,
} from '@twirchat/shared/youtube/gen/stream_list'

import { createYouTubeChatRelay } from '../src/platforms/youtube/relay'
import { required } from './fixture-values'

const response = (items: DeepPartial<LiveChatMessage>[] = [], nextPageToken?: string) =>
  LiveChatMessageListResponse.fromPartial({ items, nextPageToken })
const item = (id: string, snippet: DeepPartial<LiveChatMessage>['snippet']) => ({
  id,
  snippet,
  authorDetails: { channelId: 'user', displayName: 'Viewer' },
})
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await Bun.sleep(5)
  }
}

function fakeClient() {
  const calls: {
    request: unknown
    metadata: Metadata
    stream: EventEmitter & { cancel: () => void }
  }[] = []
  let closed = 0
  const factory = () => ({
    streamList(request: unknown, metadata: Metadata) {
      const stream = Object.assign(new EventEmitter(), { cancel: () => {} })
      calls.push({ request, metadata, stream })
      return stream
    },
    close() {
      closed++
    },
  })
  return {
    calls,
    factory,
    get closed() {
      return closed
    },
  }
}

describe('official YouTube streaming', () => {
  test('normalizes text, badges, paid, memberships, polls, moderation and bounded combo deltas', () => {
    const normalizer = createYouTubeChatNormalizer({ channelId: '@streamer' })
    const entries = [
      {
        ...item('text', { type: 1, textMessageDetails: { messageText: 'hello' } }),
        authorDetails: {
          channelId: 'user',
          displayName: 'Viewer',
          isChatOwner: true,
          isChatModerator: true,
          isChatSponsor: true,
          isVerified: true,
        },
      },
      item('super', {
        type: 15,
        superChatDetails: { amountMicros: 2500000, currency: 'USD', userComment: 'hi' },
      }),
      item('sticker', {
        type: 16,
        superStickerDetails: {
          amountMicros: 1000000,
          currency: 'EUR',
          superStickerMetadata: { stickerId: 'sticker' },
        },
      }),
      item('new', { type: 7, newSponsorDetails: { memberLevelName: 'Gold' } }),
      item('milestone', { type: 17, memberMilestoneChatDetails: { memberMonth: 12 } }),
      item('gifting', { type: 18, membershipGiftingDetails: { giftMembershipsCount: 5 } }),
      item('received', { type: 19, giftMembershipReceivedDetails: { gifterChannelId: 'gifter' } }),
      item('poll', { type: 20, displayMessage: 'Poll?', pollDetails: { status: 1 } }),
      item('deleted', { type: 8, messageDeletedDetails: { deletedMessageId: 'text' } }),
      item('retracted', { type: 9, messageRetractedDetails: { retractedMessageId: 'other' } }),
      item('timeout', {
        type: 10,
        userBannedDetails: {
          banType: 2,
          banDurationSeconds: 60,
          bannedUserDetails: { channelId: 'bad' },
        },
      }),
      item('ban', {
        type: 10,
        userBannedDetails: { banType: 1, bannedUserDetails: { channelId: 'worse' } },
      }),
      item('gift', {
        type: 21,
        giftDetails: {
          giftName: 'Rose',
          jewelsAmount: 5,
          comboCount: 2,
          giftDuration: { seconds: 2, nanos: 0 },
        },
      }),
      item('tombstone', { type: 2 }),
    ]
    // Roundtrip protobuf, including legacy moderation fields and the new gift payload.
    const wire = LiveChatMessageListResponse.decode(
      LiveChatMessageListResponse.encode(response(entries, 'cursor')).finish(),
    )
    const first = normalizer.normalize(wire)
    expect(first.messages).toHaveLength(2)
    expect(first.messages[0]?.author.badges).toHaveLength(4)
    expect(first.events).toHaveLength(7)
    expect(first.events[0]?.data.amount).toBe(2.5)
    expect(first.moderation.map((x) => x.action)).toEqual([
      'delete_message',
      'delete_message',
      'timeout',
      'ban',
    ])
    expect(normalizer.normalize(wire)).toEqual({ messages: [], events: [], moderation: [] })
    const delta = normalizer.normalize(
      response([item('gift', { type: 21, giftDetails: { comboCount: 5 } })]),
    )
    expect(delta.events[0]?.data.count).toBe(3)
    expect(delta.events[0]?.id).toBe('youtube:gift:combo:5')
    expect(
      normalizer.normalize(response([item('gift', { type: 21, giftDetails: { comboCount: 3 } })]))
        .events,
    ).toHaveLength(0)
    expect(normalizer.normalize(response([item('ended', { type: 4 })])).ended).toBe(true)
  })

  test('one-shot official discovery resolves handles and stops offline without polling', async () => {
    const urls: string[] = []
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        urls.push(url.pathname)
        expect(url.searchParams.get('key')).toBe('server-key')
        expect(init?.signal).toBeDefined()
        if (url.pathname.endsWith('/channels'))
          return Response.json({ items: [{ id: 'UCchannel' }] })
        if (url.pathname.endsWith('/search'))
          return Response.json({ items: [{ id: { videoId: 'video' } }] })
        return Response.json({
          items: [
            {
              snippet: { channelId: 'UCchannel' },
              liveStreamingDetails: { activeLiveChatId: 'chat' },
            },
          ],
        })
      },
      { preconnect: fetch.preconnect },
    )
    expect(
      await resolveYouTubeLiveChat({
        channelId: '@handle',
        credentials: { apiKey: 'server-key' },
        fetcher,
      }),
    ).toEqual({ channelId: 'UCchannel', videoId: 'video', liveChatId: 'chat' })
    expect(urls).toHaveLength(3)
    let requests = 0
    await expect(
      resolveYouTubeLiveChat({
        channelId: 'UCchannel',
        credentials: { accessToken: 'oauth' },
        fetcher: Object.assign(
          async () => {
            requests++
            return Response.json({ items: [] })
          },
          { preconnect: fetch.preconnect },
        ),
      }),
    ).rejects.toThrow('No active')
    await Bun.sleep(10)
    expect(requests).toBe(1)
  })

  test('stream uses bearer metadata, resumes, refreshes auth once and ignores canceled callbacks', async () => {
    const client = fakeClient()
    const batches: unknown[] = []
    const authRequests: boolean[] = []
    const session = createYouTubeGrpcSession({
      liveChatId: 'chat',
      clientFactory: client.factory,
      retryDelayMs: 1,
      getCredentials: (force = false) => {
        authRequests.push(force)
        return { accessToken: force ? 'new' : 'old' }
      },
      onBatch: (batch) => batches.push(batch),
      onStatus: () => {},
    })
    await session.start()
    expect(client.calls[0]?.metadata.get('authorization')).toEqual(['Bearer old'])
    required(client.calls[0]).stream.emit('data', response([item('a', { type: 1 })], 'resume'))
    required(client.calls[0]).stream.emit('error', { code: status.UNAVAILABLE })
    await until(() => client.calls.length === 2)
    expect(client.calls[1]?.request).toMatchObject({
      pageToken: 'resume',
      part: ['id', 'snippet', 'authorDetails'],
    })
    required(client.calls[1]).stream.emit('error', { code: status.UNAUTHENTICATED })
    await until(() => client.calls.length === 3)
    expect(client.calls[2]?.metadata.get('authorization')).toEqual(['Bearer new'])
    expect(authRequests).toEqual([false, false, true])
    session.stop()
    required(client.calls[2]).stream.emit('data', response([item('stale', { type: 1 })]))
    expect(batches).toHaveLength(1)
    expect(client.closed).toBe(3)
  })

  for (const code of [3, 5, 7, 8, 9])
    test(`status ${code} terminates without a retry`, async () => {
      const client = fakeClient()
      const statuses: unknown[] = []
      const session = createYouTubeGrpcSession({
        liveChatId: 'chat',
        clientFactory: client.factory,
        retryDelayMs: 1,
        getCredentials: () => ({ apiKey: 'key' }),
        onBatch: () => {},
        onStatus: (...args) => statuses.push(args),
      })
      await session.start()
      expect(client.calls[0]?.metadata.get('x-goog-api-key')).toEqual(['key'])
      required(client.calls[0]).stream.emit('error', { code, message: 'terminal' })
      await Bun.sleep(5)
      expect(client.calls).toHaveLength(1)
      expect(statuses.at(-1)).toEqual(['error', 'terminal Reconnect manually.', true])
      session.stop()
    })

  test('real local gRPC streams multiple batches, reconnects with cursor and cancels', async () => {
    const server = new Server()
    const received: string[] = []
    let connection = 0
    let canceled = false
    server.addService(V3DataLiveChatMessageServiceService, {
      streamList(
        call: ServerWritableStream<LiveChatMessageListRequest, LiveChatMessageListResponse>,
      ) {
        expect(call.metadata.get('authorization')).toEqual(['Bearer fixture'])
        connection++
        received.push(call.request.pageToken ?? '')
        if (connection === 1) {
          call.write(
            response(
              [item('first', { type: 1, textMessageDetails: { messageText: 'one' } })],
              'first-token',
            ),
          )
          call.write(
            response(
              [item('second', { type: 1, textMessageDetails: { messageText: 'two' } })],
              'second-token',
            ),
          )
          setTimeout(() => call.end(), 10)
        } else {
          call.write(
            response(
              [item('third', { type: 1, textMessageDetails: { messageText: 'three' } })],
              'third-token',
            ),
          )
          call.on('cancelled', () => {
            canceled = true
          })
        }
      },
    })
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    )
    const batches: string[] = []
    const session = createYouTubeGrpcSession({
      liveChatId: 'fixture',
      retryDelayMs: 1,
      getCredentials: () => ({ accessToken: 'fixture' }),
      clientFactory: () =>
        new V3DataLiveChatMessageServiceClient(`127.0.0.1:${port}`, credentials.createInsecure()),
      onBatch: (batch) => batches.push(required(required(batch.items[0]).id)),
      onStatus: () => {},
    })
    try {
      await session.start()
      await until(() => batches.length === 3)
      expect(batches).toEqual(['first', 'second', 'third'])
      expect(received).toEqual(['', 'second-token'])
      expect(session.getResumeToken()).toBe('third-token')
      session.stop()
      await until(() => canceled)
    } finally {
      session.stop()
      server.forceShutdown()
    }
  })

  test('relay resumes after backend reconnect and unsubscribes without credentials', () => {
    const commands: DesktopToBackendMessage[] = []
    const messages = new Set<(message: BackendToDesktopMessage) => void>()
    const connections = new Set<(connected: boolean) => void>()
    const connection = {
      isConnected: false,
      send: (command: DesktopToBackendMessage) => commands.push(command),
      onMessage: (handler: (message: BackendToDesktopMessage) => void) => {
        messages.add(handler)
        return () => messages.delete(handler)
      },
      onConnectionStatus: (handler: (connected: boolean) => void) => {
        connections.add(handler)
        return () => connections.delete(handler)
      },
    }
    const events: unknown[] = []
    const cancel = createYouTubeChatRelay(connection).subscribe(
      { channelId: '@streamer' },
      (event) => events.push(event),
    )
    for (const handler of connections) handler(true)
    const command = required(commands[0])
    if (command.type !== 'youtube_chat_subscribe')
      throw new Error('Expected a subscription command.')
    const id = command.subscriptionId
    for (const handler of messages)
      handler({
        type: 'youtube_chat_event',
        event: {
          type: 'batch',
          subscriptionId: id,
          batch: { messages: [], events: [], moderation: [] },
          nextPageToken: 'cursor',
        },
      })
    for (const handler of connections) handler(false)
    for (const handler of connections) handler(true)
    expect(commands.at(-1)).toMatchObject({ type: 'youtube_chat_subscribe', pageToken: 'cursor' })
    cancel()
    expect(commands.at(-1)).toEqual({ type: 'youtube_chat_unsubscribe', subscriptionId: id })
    expect(messages.size).toBe(0)
    expect(connections.size).toBe(0)
  })
})

test('relay suppresses replayed monetary events and computes gift deltas across backend reconnects', () => {
  let receive: ((message: BackendToDesktopMessage) => void) | undefined
  let subscriptionId = ''
  const connection = {
    isConnected: true,
    send(command: DesktopToBackendMessage) {
      if (command.type === 'youtube_chat_subscribe') subscriptionId = command.subscriptionId
    },
    onMessage(handler: (message: BackendToDesktopMessage) => void) {
      receive = handler
      return () => {}
    },
    onConnectionStatus() {
      return () => {}
    },
  }
  const amounts: number[] = []
  const stop = createYouTubeChatRelay(connection).subscribe({ channelId: 'UCchannel' }, (event) => {
    if (event.type === 'batch')
      for (const entry of event.batch.events)
        amounts.push(Number(entry.data.count ?? entry.data.amount))
  })
  const emit = (count: number) =>
    required(receive)({
      type: 'youtube_chat_event',
      event: {
        type: 'batch',
        subscriptionId,
        batch: {
          messages: [],
          moderation: [],
          events: [
            {
              id: 'paid',
              platform: 'youtube',
              type: 'superchat',
              user: { id: 'u', displayName: 'User' },
              timestamp: new Date(),
              data: { amount: 10 },
            },
            {
              id: `gift:combo:${count}`,
              platform: 'youtube',
              type: 'superchat',
              user: { id: 'u', displayName: 'User' },
              timestamp: new Date(),
              data: { count, comboCount: count },
            },
          ],
        },
      },
    })
  emit(2)
  emit(2)
  emit(5)
  expect(amounts).toEqual([10, 2, 3])
  stop()
})

test('stream ignores delayed credentials after stop and bounds authentication refresh', async () => {
  const fake = fakeClient()

  const { promise: credentialsReady, resolve } = Promise.withResolvers<{ accessToken: string }>()
  const session = createYouTubeGrpcSession({
    liveChatId: 'chat',
    clientFactory: fake.factory,
    getCredentials: () => credentialsReady,
    onBatch: () => {},
    onStatus: () => {},
  })
  const starting = session.start()
  session.stop()
  resolve({ accessToken: 'old' })
  await starting
  expect(fake.calls).toHaveLength(0)
  let refreshes = 0
  const statuses: unknown[] = []
  const other = createYouTubeGrpcSession({
    liveChatId: 'chat',
    clientFactory: fake.factory,
    getCredentials: () => {
      refreshes++
      return { accessToken: 'invalid' }
    },
    onBatch: () => {},
    onStatus: (...args) => statuses.push(args),
  })
  await other.start()
  required(fake.calls[0]).stream.emit('error', { code: status.UNAUTHENTICATED, message: 'expired' })
  await until(() => fake.calls.length === 2)
  required(fake.calls[1]).stream.emit('error', { code: status.UNAUTHENTICATED, message: 'expired' })
  expect(refreshes).toBe(2)
  expect(statuses.at(-1)).toEqual(['error', 'expired Reconnect manually.', true])
  other.stop()
})

test('transient rate limit retries with the same cursor while ended streams stay stopped', async () => {
  const fake = fakeClient()
  const statuses: unknown[] = []
  const session = createYouTubeGrpcSession({
    liveChatId: 'chat',
    clientFactory: fake.factory,
    retryDelayMs: 1,
    getCredentials: () => ({ apiKey: 'fixture' }),
    onBatch: () => {},
    onStatus: (...args) => statuses.push(args),
  })
  await session.start()
  required(fake.calls[0]).stream.emit('data', response([], 'cursor'))
  required(fake.calls[0]).stream.emit('error', {
    code: status.RESOURCE_EXHAUSTED,
    message: 'rate limit exceeded',
  })
  await until(() => fake.calls.length === 2)
  expect(fake.calls[1]?.request).toMatchObject({ pageToken: 'cursor' })
  required(fake.calls[1]).stream.emit('data', response([item('ended', { type: 4 })]))
  await Bun.sleep(5)
  expect(fake.calls).toHaveLength(2)
  expect(statuses.at(-1)).toEqual([
    'disconnected',
    'YouTube live chat ended. Reconnect manually for a new broadcast.',
    true,
  ])
  session.stop()
})

test('legacy lowercased YouTube IDs give an actionable error without guessing identity', async () => {
  let requests = 0
  await expect(
    resolveYouTubeLiveChat({
      channelId: 'ucabcdefghijklmnopqrstuv',
      credentials: { apiKey: 'fixture' },
      fetcher: Object.assign(
        async () => {
          requests++
          return Response.json({})
        },
        { preconnect: fetch.preconnect },
      ),
    }),
  ).rejects.toThrow('original UC… ID or @handle')
  expect(requests).toBe(0)
})
