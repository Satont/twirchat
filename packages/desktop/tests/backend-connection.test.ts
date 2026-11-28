import { expect, spyOn, test } from 'bun:test'

import { BackendConnection } from '../src/backend-connection'
import { getRuntimeConfig, setRuntimeConfig } from '../src/runtime-config'

function openBackend() {
  const previous = getRuntimeConfig()
  const ping = Promise.withResolvers<string>()
  const closed = Promise.withResolvers<void>()
  const closePeer = Promise.withResolvers<() => void>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (request.headers.get('X-Client-Secret') === 'fixture' && server.upgrade(request)) return
      return new Response(null, { status: 401 })
    },
    websocket: {
      open(ws) {
        closePeer.resolve(() => ws.close())
      },
      message(ws, message) {
        ping.resolve(String(message))
        ws.send('{"type":"pong"}')
      },
      close() {
        closed.resolve()
      },
    },
  })
  setRuntimeConfig({ backendWsUrl: `ws://127.0.0.1:${server.port}/ws` })
  return { server, ping, closed, closePeer, restore: () => setRuntimeConfig(previous) }
}

test('disconnect closes the hosted socket and clears its single heartbeat', async () => {
  const backend = openBackend()
  const connection = new BackendConnection('fixture')
  const interval = spyOn(globalThis, 'setInterval')
  const opened = Promise.withResolvers<void>()
  const clear = spyOn(globalThis, 'clearInterval')
  const listen = spyOn(WebSocket.prototype, 'addEventListener')
  const statuses: [boolean, boolean][] = []
  const pong = Promise.withResolvers<void>()
  connection.onConnectionStatus((connected) => {
    statuses.push([connected, connection.isConnected])
    if (connected) opened.resolve()
  })
  connection.onMessage((message) => {
    if (message.type === 'pong') pong.resolve()
  })
  try {
    connection.connect()
    connection.connect()
    await opened.promise
    const heartbeatIndex = interval.mock.calls.findIndex(([, delay]) => delay === 30_000)
    expect(interval.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(1)
    const heartbeat = interval.mock.calls[heartbeatIndex]?.[0]
    if (typeof heartbeat !== 'function') throw new Error('Expected a scheduled heartbeat')
    heartbeat()
    expect(await backend.ping.promise).toBe('{"type":"ping"}')
    await pong.promise
    const timer = interval.mock.results[heartbeatIndex]?.value
    const listeners = listen.mock.calls.filter(([event]) =>
      ['open', 'message', 'close', 'error'].includes(event),
    )
    expect(listeners.map(([event]) => event)).toEqual(['open', 'message', 'close', 'error'])
    const options = listeners[0]?.[2]
    const signal = typeof options === 'object' ? options.signal : undefined
    expect(signal?.aborted).toBe(false)
    expect(listeners.every(([, , candidate]) => candidate === options)).toBe(true)
    connection.disconnect()
    expect(signal?.aborted).toBe(true)
    connection.disconnect()
    await backend.closed.promise
    expect(clear).toHaveBeenCalledWith(timer)
    expect(statuses).toEqual([
      [true, true],
      [false, false],
    ])
  } finally {
    connection.disconnect()
    interval.mockRestore()
    clear.mockRestore()
    listen.mockRestore()
    backend.restore()
    await backend.server.stop(true)
  }
})

test("a synchronous restart cancels the retired socket's scheduled reconnect", async () => {
  const backend = openBackend()
  const connection = new BackendConnection('fixture')
  const reopened = Promise.withResolvers<void>()
  const timeout = spyOn(globalThis, 'setTimeout')
  const clear = spyOn(globalThis, 'clearTimeout')
  let restarting = false
  const unsubscribe = connection.onConnectionStatus((connected) => {
    if (connected && restarting) reopened.resolve()
    if (!connected && !restarting) {
      restarting = true
      connection.disconnect()
      connection.connect()
    }
  })
  try {
    connection.connect()
    const closePeer = await backend.closePeer.promise
    closePeer()
    await reopened.promise
    const index = timeout.mock.calls.findIndex(([, delay]) => delay === 3000)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(clear).toHaveBeenCalledWith(timeout.mock.results[index]?.value)
    expect(connection.isConnected).toBe(true)
  } finally {
    unsubscribe()
    connection.disconnect()
    timeout.mockRestore()
    clear.mockRestore()
    backend.restore()
    await backend.server.stop(true)
  }
})
