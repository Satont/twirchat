import { expect, test } from 'bun:test'

import { createTwitchWebSessionStore } from '../src/store/twitch-web-session-store'

test('stores the web session with AES encryption and never exposes the token in status', async () => {
  let encrypted: string | null = null
  const store = createTwitchWebSessionStore({
    read: () => encrypted,
    write: (value) => {
      encrypted = value
    },
    remove: () => {
      encrypted = null
    },
  })
  expect(await store.status()).toEqual({ configured: false })
  const session = {
    token: 'secret-web-token',
    userId: '100',
    username: 'viewer',
    clientId: 'web-client',
  }
  await store.set(session)
  expect(encrypted).not.toContain('secret-web-token')
  expect(encrypted).not.toContain('viewer')
  expect(await store.get()).toEqual(session)
  expect(await store.status()).toEqual({ configured: true, userId: '100', username: 'viewer' })
  store.clear()
  expect(await store.status()).toEqual({ configured: false })
})
