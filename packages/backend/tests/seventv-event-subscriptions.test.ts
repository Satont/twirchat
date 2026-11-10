import { expect, test } from 'bun:test'

import { SevenTVEventClient } from '../src/seventv/event-client'
import type { SevenTVEventMessage } from '../src/seventv/event-client'
import { sevenTVEventMessageSchema } from '../src/seventv/event-schemas'

type EventSocket = Bun.ServerWebSocket<SevenTVEventMessage[]>

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000
  while (!check()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for 7TV subscription.')
    await Bun.sleep(5)
  }
}

function hello(socket: EventSocket, sessionId: string): void {
  socket.send(
    JSON.stringify({
      op: 1,
      d: { heartbeat_interval: 45000, session_id: sessionId, subscription_limit: 500 },
    }),
  )
}

test('7TV reconnect restores desired subscriptions on each new session', async () => {
  const firstOpened = Promise.withResolvers<EventSocket>()
  const secondOpened = Promise.withResolvers<EventSocket>()
  const thirdOpened = Promise.withResolvers<EventSocket>()
  const sessions = [firstOpened, secondOpened, thirdOpened]
  const server = Bun.serve<SevenTVEventMessage[]>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      return listener.upgrade(request, { data: [] })
        ? undefined
        : new Response('WebSocket upgrade required', { status: 400 })
    },
    websocket: {
      open(ws) {
        sessions.shift()?.resolve(ws)
      },
      message(ws, raw) {
        const message = sevenTVEventMessageSchema.parse(JSON.parse(raw.toString()))
        ws.data.push(message)
        if (message.op === 34) {
          ws.send(
            JSON.stringify({
              op: 5,
              d: {
                command: 'RESUME',
                data: { success: false, dispatches_replayed: 0, subscriptions_restored: 0 },
              },
            }),
          )
        }
      },
    },
  })
  const client = new SevenTVEventClient(`ws://127.0.0.1:${server.port}`)
  const type = 'emote_set.update'
  const retained = { object_id: 'retained-set' }
  const retired = { object_id: 'retired-set' }
  const added = { object_id: 'new-set' }
  const temporary = { object_id: 'temporary-set' }
  const retainedSubscribe = { op: 35, d: { type, condition: retained } }
  const addedSubscribe = { op: 35, d: { type, condition: added } }

  try {
    client.subscribe(type, retained)
    client.subscribe(type, retired)
    await client.connect()
    const first = await firstOpened.promise
    hello(first, 'first-session')
    await until(() => first.data.length >= 2)
    expect(first.data).toEqual([retainedSubscribe, { op: 35, d: { type, condition: retired } }])

    const disconnected = Promise.withResolvers<void>()
    client.onDisconnected = disconnected.resolve
    first.close(1012, 'Restart')
    await disconnected.promise
    client.onDisconnected = null
    client.unsubscribe(type, retired)
    client.subscribe(type, added)

    const second = await secondOpened.promise
    hello(second, 'second-session')
    await until(() => second.data.length > 0)
    expect(second.data[0]).toEqual(retainedSubscribe)
    await until(() => second.data.length >= 2)
    expect(second.data).toEqual([retainedSubscribe, addedSubscribe])

    second.send(JSON.stringify({ op: 4 }))
    const third = await thirdOpened.promise
    await until(() => client.isConnected)
    client.subscribe(type, temporary)
    client.unsubscribe(type, temporary)
    hello(third, 'third-session')
    await until(() => third.data.length >= 2)
    expect(third.data).toEqual([retainedSubscribe, addedSubscribe])

    client.unsubscribe(type, added)
    client.unsubscribe(type, added)
    client.subscribe(type, temporary)
    await until(() => third.data.length >= 4)
    expect(third.data).toEqual([
      retainedSubscribe,
      addedSubscribe,
      { op: 36, d: { type, condition: added } },
      { op: 35, d: { type, condition: temporary } },
    ])
  } finally {
    client.disconnect()
    await server.stop(true)
  }
})
