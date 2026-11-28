import { expect, spyOn, test } from 'bun:test'

import { startDesktopDevServer } from '../src/gpuix/backend/dev-server'
import { createDesktopEvents } from '../src/gpuix/backend/events'

const hostname = '127.0.0.1'

test('dev server preserves injection and resolves the current debug hook on each call', async () => {
  const events = createDesktopEvents()
  const received: unknown[] = []
  events.on('chat_message', (message) => received.push(message))
  let hook: ReturnType<Parameters<typeof startDesktopDevServer>[0]['getDebugHook']>
  const server = startDesktopDevServer({ events, port: 0, hostname, getDebugHook: () => hook })
  const post = (path: string, body: unknown) =>
    fetch(`http://${hostname}:${server.port}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  try {
    expect((await post('/dev/inject-chat', {})).status).toBe(400)
    const timestamp = new Date('2024-01-01T00:00:00.000Z')
    const message = {
      id: 'fixture',
      platform: 'twitch',
      channelId: 'fixture',
      author: { id: '1', username: 'fixture', displayName: 'Fixture', badges: [] },
      text: 'Hello',
      emotes: [],
      timestamp,
      type: 'message',
    }
    expect(await (await post('/dev/inject-chat', message)).text()).toBe('ok')
    expect(received).toEqual([message])
    expect((await post('/dev/hook', { action: 'status' })).status).toBe(404)
    hook = async (action, payload) => ({ action, payload })
    expect(await (await post('/dev/hook', { action: 'status', payload: 42 })).json()).toEqual({
      action: 'status',
      payload: 42,
    })
    hook = async () => undefined
    expect(await (await post('/dev/hook', { action: 'status' })).json()).toBeNull()
  } finally {
    await server.stop()
  }
})

test('a request waiting for JSON cannot dispatch after the listener stops', async () => {
  let dispatched = false
  const server = startDesktopDevServer({
    events: createDesktopEvents(),
    port: 0,
    hostname,
    getDebugHook: () => async () => {
      dispatched = true
    },
  })
  const parsing = Promise.withResolvers<void>()
  const body = Promise.withResolvers<unknown>()
  const json = spyOn(Request.prototype, 'json').mockImplementation(() => {
    parsing.resolve()
    return body.promise
  })
  const request = Promise.allSettled([
    fetch(`http://${hostname}:${server.port}/dev/hook`, { method: 'POST', body: '{}' }),
  ])
  try {
    await Promise.race([parsing.promise, request])
    expect(json).toHaveBeenCalledTimes(1)
    await server.stop()
    body.resolve({ action: 'status' })
    await Bun.sleep(0)
    expect(dispatched).toBe(false)
    expect(await request).toMatchObject([{ status: 'rejected' }])
  } finally {
    body.resolve(null)
    json.mockRestore()
    await server.stop()
  }
})

test('stopping the dev server is idempotent and releases its port', async () => {
  const events = createDesktopEvents()
  const server = startDesktopDevServer({ events, port: 0, hostname, getDebugHook: () => undefined })
  const stopping = server.stop()
  expect(server.stop()).toBe(stopping)
  await stopping
  const restarted = startDesktopDevServer({
    events,
    port: server.port,
    hostname,
    getDebugHook: () => undefined,
  })
  try {
    expect(restarted.port).toBe(server.port)
    expect((await fetch(`http://${hostname}:${restarted.port}/unknown`)).status).toBe(404)
  } finally {
    await restarted.stop()
  }
})
