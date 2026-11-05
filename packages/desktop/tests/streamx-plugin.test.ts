import { expect, test } from 'bun:test'

import type { ServerWebSocket } from 'bun'

import { createStreamxTransport } from '../../../plugins/streamx'
import type { PluginTransportMessage, PluginTransportStatus } from '../src/plugins/api'
import { transportMessageSchema } from '../src/plugins/protocol'

function message(id: string, words: string[], seconds: string, senderColor?: string) {
  return {
    id,
    createdAt: `2026-01-01T00:00:${seconds}Z`,
    sender: { id: 'sender-id', name: 'sender', displayName: 'Sender' },
    senderColor,
    segments: words.map((content) => ({ content })),
  }
}

function push(socket: ServerWebSocket, chatMessages: ReturnType<typeof message>) {
  socket.send(JSON.stringify({ type: 'next', id: '1', payload: { data: { chatMessages } } }))
}

test('subscribes before loading history, merges overlapping chat and closes the socket on abort', async () => {
  const frames: unknown[] = []
  const queries: unknown[] = []
  const history = Promise.withResolvers<void>()
  const subscribed = Promise.withResolvers<ServerWebSocket>()
  const closed = Promise.withResolvers<void>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request, listener) {
      if (request.headers.get('upgrade') === 'websocket') {
        const protocol = request.headers.get('sec-websocket-protocol')
        if (
          protocol === 'graphql-transport-ws' &&
          listener.upgrade(request, {
            data: undefined,
            headers: { 'Sec-WebSocket-Protocol': protocol },
          })
        )
          return undefined
        return new Response('Unsupported WebSocket protocol', { status: 400 })
      }
      const operation: unknown = await request.json()
      queries.push(operation)
      if (queries.length === 1) {
        return Response.json({ data: { fetchUserByName: { id: 'channel-id' } } })
      }
      await history.promise
      return Response.json({
        data: {
          chatMessagesLatest: [
            message('old', ['Earlier', 'message'], '01', 'red'),
            message('overlap', ['History', 'copy'], '02'),
          ],
        },
      })
    },
    websocket: {
      message(socket, data) {
        const frame: unknown = JSON.parse(String(data))
        frames.push(frame)
        if (!frame || typeof frame !== 'object' || !('type' in frame)) return
        switch (frame.type) {
          case 'connection_init':
            socket.send(JSON.stringify({ type: 'connection_ack' }))
            break
          case 'subscribe':
            subscribed.resolve(socket)
            push(socket, message('overlap', ['Live', 'copy'], '02'))
            socket.send(JSON.stringify({ type: 'ping' }))
            break
          case 'pong':
            history.resolve()
            break
        }
      },
      close() {
        closed.resolve()
      },
    },
  })

  const abort = new AbortController()
  const messages: PluginTransportMessage[] = []
  const statuses: PluginTransportStatus[] = []
  const merged = Promise.withResolvers<void>()
  const live = Promise.withResolvers<void>()
  const transport = createStreamxTransport(new URL('/api/query', server.url).href)
  try {
    expect('sendMessage' in transport).toBe(false)
    await transport.connect('example', {
      signal: abort.signal,
      emitMessage(received) {
        messages.push(transportMessageSchema.parse(received))
        if (messages.length === 2) merged.resolve()
        if (messages.length === 3) live.resolve()
      },
      setStatus(status) {
        statuses.push(status)
      },
    })
    await merged.promise
    expect(queries).toEqual([
      { query: expect.stringContaining('fetchUserByName'), variables: { channelName: 'example' } },
      {
        query: expect.stringContaining('chatMessagesLatest'),
        variables: { channelID: 'channel-id', limit: 50 },
      },
    ])
    expect(frames.slice(0, 3)).toEqual([
      expect.objectContaining({ type: 'connection_init' }),
      {
        id: '1',
        type: 'subscribe',
        payload: {
          query: expect.stringContaining('chatMessages('),
          variables: { channelID: 'channel-id' },
        },
      },
      expect.objectContaining({ type: 'pong' }),
    ])
    expect(statuses).toEqual([{ status: 'connecting' }, { status: 'connected' }])
    expect(messages.map(({ id, text, historical }) => [id, text, historical])).toEqual([
      ['old', 'Earlier message', true],
      ['overlap', 'Live copy', undefined],
    ])

    expect(messages[0]?.author.color).toBeUndefined()
    push(
      await subscribed.promise,
      message('new', ['Привет,', 'мир!', 'KEKW', 'https://example.org'], '03', '#6dA2fB'),
    )
    await live.promise
    expect(messages[2]).toEqual({
      id: 'new',
      author: { id: 'sender-id', name: 'Sender', username: 'sender', color: '#6dA2fB' },
      text: 'Привет, мир! KEKW https://example.org',
      timestamp: Date.parse('2026-01-01T00:00:03Z'),
    })
    abort.abort()
    await closed.promise
  } finally {
    abort.abort()
    history.resolve()
    await server.stop(true)
  }
})
