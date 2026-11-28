import type { SevenTVEmote } from '@twirchat/shared/protocol'

import type { SevenTVChannelKey } from './channel-key'

interface SnapshotMetadata {
  userId?: string
  platformUserId?: string
  emotes: Map<string, SevenTVEmote>
}

export type CachedEmoteSet = SnapshotMetadata &
  ({ id: string; name: string } | { id: null; name: null })

interface CacheEntry {
  data: CachedEmoteSet
  expiresAt: number
}

const CATALOG_TTL_MS = 5 * 60 * 1000

export class SevenTVCache {
  private cache = new Map<SevenTVChannelKey, CacheEntry>()

  get(key: SevenTVChannelKey): CachedEmoteSet | undefined {
    // Return even if expired - caller can decide to use stale data.
    return this.cache.get(key)?.data
  }

  isExpired(key: SevenTVChannelKey): boolean {
    const entry = this.cache.get(key)
    return !entry || Date.now() > entry.expiresAt
  }

  set(key: SevenTVChannelKey, data: CachedEmoteSet, ttl = CATALOG_TTL_MS): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    })
  }

  invalidate(key: SevenTVChannelKey): void {
    this.cache.delete(key)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

export const sevenTVCache = new SevenTVCache()

setInterval(() => sevenTVCache.cleanup(), CATALOG_TTL_MS)
