import type { TwitchWebSession, TwitchWebSessionStatus } from '@twirchat/shared/twitch-activities'
import { z } from 'zod'

import { AccountStore } from './account-store'
import { decryptAsync, encryptAsync } from './crypto'
import { getDb } from './db'

const webSessionSchema = z.object({
  token: z.string(),
  userId: z.string(),
  username: z.string(),
  clientId: z.string(),
})

const KEY = 'secret:twitch-web-session'

export function createTwitchWebSessionStore(storage: {
  read(): string | null
  write(value: string): void
  remove(): void
}) {
  return {
    async get(): Promise<TwitchWebSession | null> {
      const encrypted = storage.read()
      if (!encrypted) return null
      try {
        const value = webSessionSchema.parse(JSON.parse(await decryptAsync(encrypted)))
        return value.token && value.userId && value.username && value.clientId ? value : null
      } catch {
        return null
      }
    },
    async set(value: TwitchWebSession): Promise<void> {
      storage.write(await encryptAsync(JSON.stringify(value)))
    },
    clear(): void {
      storage.remove()
    },
    async status(): Promise<TwitchWebSessionStatus> {
      const value = await this.get()
      return value
        ? { configured: true, userId: value.userId, username: value.username }
        : { configured: false }
    },
  }
}

export function createAccountTwitchWebSessionStore(storage: {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  activeUserId(): string | null
}) {
  const scopedKey = (userId: string) => `${KEY}:${encodeURIComponent(userId)}`
  async function decode(encrypted: string | null): Promise<TwitchWebSession | null> {
    if (!encrypted) return null
    try {
      const value = webSessionSchema.parse(JSON.parse(await decryptAsync(encrypted)))
      return value.token && value.userId && value.username && value.clientId ? value : null
    } catch {
      return null
    }
  }
  async function migrateLegacy(): Promise<void> {
    const encrypted = storage.read(KEY)
    const value = await decode(encrypted)
    if (!value || !encrypted || storage.read(KEY) !== encrypted) return
    if (!storage.read(scopedKey(value.userId))) storage.write(scopedKey(value.userId), encrypted)
    storage.remove(KEY)
  }
  return {
    async get(): Promise<TwitchWebSession | null> {
      const userId = storage.activeUserId()
      if (!userId) return null
      await migrateLegacy()
      const value = await decode(storage.read(scopedKey(userId)))
      return storage.activeUserId() === userId && value?.userId === userId ? value : null
    },
    async set(value: TwitchWebSession): Promise<void> {
      if (storage.activeUserId() !== value.userId)
        throw new Error('Connect the matching Twitch account before saving its web session.')
      const encrypted = await encryptAsync(JSON.stringify(value))
      if (storage.activeUserId() !== value.userId)
        throw new Error('The active Twitch account changed. Save the web session again.')
      storage.write(scopedKey(value.userId), encrypted)
    },
    async clearForUser(userId: string): Promise<void> {
      await migrateLegacy()
      storage.remove(scopedKey(userId))
    },
    async clear(): Promise<void> {
      const userId = storage.activeUserId()
      if (userId) await this.clearForUser(userId)
    },
    async status(): Promise<TwitchWebSessionStatus> {
      const value = await this.get()
      return value
        ? { configured: true, userId: value.userId, username: value.username }
        : { configured: false }
    },
  }
}

export const TwitchWebSessionStore = createAccountTwitchWebSessionStore({
  activeUserId: () => AccountStore.findByPlatform('twitch')?.platformUserId ?? null,
  read: (key) =>
    getDb()
      .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
      .get(key)?.value ?? null,
  write: (key, value) => {
    getDb().run(
      'INSERT INTO client_identity(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  },
  remove: (key) => {
    getDb().run('DELETE FROM client_identity WHERE key = ?', [key])
  },
})
