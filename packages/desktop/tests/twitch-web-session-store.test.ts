import { expect, test } from 'bun:test'

import {
  createAccountTwitchWebSessionStore,
  createTwitchWebSessionStore,
} from '../src/store/twitch-web-session-store'

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

test('points refresh cannot restore a disconnected session or overwrite a freshly authorized one', async () => {
  const entries = new Map<string, string>()
  const store = createAccountTwitchWebSessionStore(
    {
      activeUserId: () => '100',
      read: (key) => entries.get(key) ?? null,
      write: (key, value) => entries.set(key, value),
      remove: (key) => entries.delete(key),
    },
    'points',
  )
  const session = {
    token: 'old',
    refreshToken: 'old-refresh',
    userId: '100',
    username: 'viewer',
    clientId: 'tv-client',
  }
  const rotated = { ...session, token: 'rotated', refreshToken: 'rotated-refresh' }
  await store.set(session)
  expect(await store.replace(session, rotated)).toBe(true)
  expect(await store.get()).toEqual(rotated)
  await store.clear()
  expect(await store.replace(rotated, session)).toBe(false)
  await store.set({ ...session, token: 'reconnected' })
  expect(await store.replace(rotated, session)).toBe(false)
  expect((await store.get())?.token).toBe('reconnected')
})
