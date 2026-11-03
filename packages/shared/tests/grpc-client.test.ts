import { expect, test } from 'bun:test'

import {
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  status,
  type ClientReadableStream,
  type ServerWritableStream,
  type ServiceError,
} from '@grpc/grpc-js'

import {
  LiveChatMessageListRequest,
  LiveChatMessageListResponse,
  V3DataLiveChatMessageServiceClient,
  V3DataLiveChatMessageServiceService,
} from '../youtube/gen/stream_list'

function deadlineStatus(call: ClientReadableStream<LiveChatMessageListResponse>): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      call.cancel()
      reject(new Error('The supplied gRPC deadline was not applied.'))
    }, 1500)
    call.once('error', (error: ServiceError) => {
      clearTimeout(timeout)
      resolve(error.code)
    })
    call.once('end', () => {
      clearTimeout(timeout)
      reject(new Error('Unexpected successful stream.'))
    })
  })
}

function collect(
  call: ClientReadableStream<LiveChatMessageListResponse>,
): Promise<LiveChatMessageListResponse[]> {
  return new Promise((resolve, reject) => {
    const results: LiveChatMessageListResponse[] = []
    call.on('data', (value: LiveChatMessageListResponse) => results.push(value))
    call.once('error', reject)
    call.once('end', () => resolve(results))
  })
}

test('generated streaming client preserves metadata and both call-options overloads on a real server', async () => {
  const server = new Server()
  const cancelled = new Set<string>()
  const metadataValues: string[] = []
  server.addService(V3DataLiveChatMessageServiceService, {
    streamList(
      call: ServerWritableStream<LiveChatMessageListRequest, LiveChatMessageListResponse>,
    ) {
      const token = call.request.pageToken ?? ''
      for (const value of call.metadata.get('x-contract'))
        if (typeof value === 'string') metadataValues.push(value)
      call.on('cancelled', () => cancelled.add(token))
      if (token === 'warm') {
        call.write(LiveChatMessageListResponse.create({ nextPageToken: token }))
        call.end()
      }
    },
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) =>
      error ? reject(error) : resolve(bound),
    )
  })
  const client = new V3DataLiveChatMessageServiceClient(
    `127.0.0.1:${port}`,
    credentials.createInsecure(),
  )
  try {
    const metadata = new Metadata()
    metadata.set('x-contract', 'present')
    const warm = await collect(
      client.streamList({ part: [], pageToken: 'warm' }, metadata, { deadline: Date.now() + 1500 }),
    )
    expect(warm.map((value) => value.nextPageToken)).toEqual(['warm'])
    expect(metadataValues).toEqual(['present'])
    expect(V3DataLiveChatMessageServiceClient.service).toBe(V3DataLiveChatMessageServiceService)
    expect(V3DataLiveChatMessageServiceClient.serviceName).toBe(
      'youtube.api.v3.V3DataLiveChatMessageService',
    )
    expect(
      await deadlineStatus(
        client.streamList({ part: [], pageToken: 'second' }, { deadline: Date.now() + 80 }),
      ),
    ).toBe(status.DEADLINE_EXCEEDED)
    expect(
      await deadlineStatus(
        client.streamList({ part: [], pageToken: 'third' }, undefined, {
          deadline: Date.now() + 80,
        }),
      ),
    ).toBe(status.DEADLINE_EXCEEDED)
    const until = Date.now() + 1000
    while ((!cancelled.has('second') || !cancelled.has('third')) && Date.now() < until)
      await Bun.sleep(2)
    expect(cancelled.has('second')).toBe(true)
    expect(cancelled.has('third')).toBe(true)
  } finally {
    client.close()
    server.forceShutdown()
  }
})
