import { refreshTwitchPointsDevice } from '../auth/twitch-points'
import {
  TwitchPointsSessionStore,
  type StoredTwitchWebSession,
} from '../store/twitch-web-session-store'

interface PendingRefresh {
  token: string
  retryAt: number
  request: Promise<StoredTwitchWebSession | null>
}

const pending = new Map<string, PendingRefresh>()

export async function currentTwitchPointsSession(
  rejected?: TwitchWebSession,
): Promise<StoredTwitchWebSession | null> {
  const saved = await TwitchPointsSessionStore.get()
  if (!saved || (rejected && saved.userId !== rejected.userId)) return null
  const previous = pending.get(saved.userId)
  if (previous?.token === saved.token && previous.retryAt > Date.now()) return previous.request
  const expired = saved.expiresAt !== undefined && saved.expiresAt <= Date.now() / 1000
  if (!expired && rejected?.token !== saved.token) return saved
  if (!saved.refreshToken) return null

  const refresh: PendingRefresh = {
    token: saved.token,
    retryAt: Infinity,
    request: refreshTwitchPointsDevice({ userId: saved.userId, refreshToken: saved.refreshToken })
      .then(async (next) => {
        await TwitchPointsSessionStore.replace(saved, next)
        return TwitchPointsSessionStore.get()
      })
      .then((current) => (current?.userId === saved.userId ? current : null))
      .catch(() => {
        refresh.retryAt = Date.now() + 60_000
        return null
      })
      .finally(() => {
        if (refresh.retryAt === Infinity && pending.get(saved.userId) === refresh)
          pending.delete(saved.userId)
      }),
  }
  pending.set(saved.userId, refresh)
  for (const [userId, entry] of pending) if (entry.retryAt <= Date.now()) pending.delete(userId)
  return refresh.request
}
import type { TwitchWebSession } from '@twirchat/shared/twitch-activities'
