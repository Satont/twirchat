import { expect, test } from 'bun:test'

import { connectionManager } from '../src/ws/connection-manager'

test('a stale socket cannot remove or receive messages for a replacement client connection', () => {
  const oldMessages: string[] = []
  const newMessages: string[] = []
  const clientSecret = crypto.randomUUID()
  const oldSocket = {
    data: { clientSecret },
    send: (message: string) => oldMessages.push(message),
  }
  const newSocket = {
    data: { clientSecret },
    send: (message: string) => newMessages.push(message),
  }
  connectionManager.register(oldSocket)
  connectionManager.register(newSocket)
  expect(connectionManager.isCurrent(oldSocket)).toBe(false)
  expect(connectionManager.remove(oldSocket)).toBe(false)
  expect(connectionManager.isCurrent(newSocket)).toBe(true)
  connectionManager.send(clientSecret, { type: 'pong' })
  expect(oldMessages).toHaveLength(0)
  expect(newMessages).toEqual(['{"type":"pong"}'])
  expect(connectionManager.remove(newSocket)).toBe(true)
})
