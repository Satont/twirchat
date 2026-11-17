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
  expiresAt: z.number().int().positive().optional(),
  refreshToken: z.string().min(1).optional(),
})

export type StoredTwitchWebSession = z.infer<typeof webSessionSchema>

const KEY = 'secret:twitch-web-session'

async function decode(encrypted: string | null): Promise<StoredTwitchWebSession | null> {
  if (!encrypted) return null
  try {
    const value = webSessionSchema.parse(JSON.parse(await decryptAsync(encrypted)))
    return value.token && value.userId && value.username && value.clientId ? value : null
  } catch {
    return null
  }
}

export function createTwitchWebSessionStore(storage: {
  read(): string | null
  write(value: string): void
  remove(): void
}) {
  return {
    get: (): Promise<TwitchWebSession | null> => decode(storage.read()),
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

interface TwitchSessionStorage {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  activeUserId(): string | null
}

export function createAccountTwitchWebSessionStore(storage: TwitchSessionStorage, key = KEY) {
  const scopedKey = (userId: string) => `${key}:${encodeURIComponent(userId)}`
  async function migrateLegacy(): Promise<void> {
    if (key !== KEY) return
    const encrypted = storage.read(KEY)
    const value = await decode(encrypted)
    if (!value || !encrypted || storage.read(KEY) !== encrypted) return
    if (!storage.read(scopedKey(value.userId))) storage.write(scopedKey(value.userId), encrypted)
    storage.remove(KEY)
  }
  return {
    async get(): Promise<StoredTwitchWebSession | null> {
      const userId = storage.activeUserId()
      if (!userId) return null
      await migrateLegacy()
      const value = await decode(storage.read(scopedKey(userId)))
      return storage.activeUserId() === userId && value?.userId === userId ? value : null
    },
    async set(value: StoredTwitchWebSession, signal?: AbortSignal): Promise<void> {
      signal?.throwIfAborted()
      if (storage.activeUserId() !== value.userId)
        throw new Error('Connect the matching Twitch account before saving its web session.')
      const encrypted = await encryptAsync(JSON.stringify(value))
      signal?.throwIfAborted()
      if (storage.activeUserId() !== value.userId)
        throw new Error('The active Twitch account changed. Save the web session again.')
      storage.write(scopedKey(value.userId), encrypted)
    },
    async replace(
      previous: StoredTwitchWebSession,
      next: StoredTwitchWebSession,
    ): Promise<boolean> {
      const userKey = scopedKey(previous.userId)
      const stored = storage.read(userKey)
      const current = await decode(stored)
      if (current?.token !== previous.token || current.refreshToken !== previous.refreshToken)
        return false
      const encrypted = await encryptAsync(JSON.stringify(next))
      if (storage.read(userKey) !== stored) return false
      storage.write(userKey, encrypted)
      return true
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

const storage: TwitchSessionStorage = {
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
}

export const TwitchWebSessionStore = createAccountTwitchWebSessionStore(storage)
export const TwitchPointsSessionStore = createAccountTwitchWebSessionStore(
  storage,
  'secret:twitch-points-session',
)
