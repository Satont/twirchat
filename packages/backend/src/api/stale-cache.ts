import { logger } from '@twirchat/shared/logger'

const log = logger('stale-cache')

interface Entry<T> {
  value: T
  expiresAt: number
}

export interface StaleCacheOptions<T> {
  name: string
  ttlMs: number
  /** How long a stale value is served after a failed reload before the next attempt. */
  retryMs: number
  maxEntries: number
  load(key: string): Promise<T>
  now?: () => number
}

/**
 * Bounded LRU cache that shares in-flight loads and keeps serving the last good value while
 * reloads fail, so an upstream outage does not turn into errors for every caller.
 */
export function createStaleCache<T>(options: StaleCacheOptions<T>) {
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry<T>>()
  const pending = new Map<string, Promise<T>>()

  const store = (key: string, value: T, ttlMs: number) => {
    entries.delete(key)
    entries.set(key, { value, expiresAt: now() + ttlMs })
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  const reload = async (key: string): Promise<T> => {
    try {
      const value = await options.load(key)
      store(key, value, options.ttlMs)
      return value
    } catch (error) {
      const stale = entries.get(key)
      if (!stale) throw error
      log.warn('Serving stale entry after reload failure', {
        cache: options.name,
        key,
        error: String(error),
      })
      store(key, stale.value, options.retryMs)
      return stale.value
    }
  }

  return {
    get(key: string): Promise<T> {
      const entry = entries.get(key)
      if (entry && entry.expiresAt > now()) {
        entries.delete(key)
        entries.set(key, entry)
        return Promise.resolve(entry.value)
      }
      const existing = pending.get(key)
      if (existing) return existing
      const result = reload(key).finally(() => pending.delete(key))
      pending.set(key, result)
      return result
    },
  }
}
