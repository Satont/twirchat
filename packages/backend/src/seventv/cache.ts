import type { Platform } from '@twirchat/shared'

import type { SevenTVEmote } from './emote.ts'

interface SnapshotMetadata {
  userId?: string
  platformUserId?: string
  channelId: string
  platform: Platform
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
  private cache = new Map<string, CacheEntry>() // ChannelKey -> entry

  private getKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`
  }

  get(platform: Platform, channelId: string): CachedEmoteSet | undefined {
    const key = this.getKey(platform, channelId)
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    // Return even if expired - caller can decide to use stale data
    return entry.data
  }

  isExpired(platform: Platform, channelId: string): boolean {
    const key = this.getKey(platform, channelId)
    const entry = this.cache.get(key)

    if (!entry) {
      return true
    }
    return Date.now() > entry.expiresAt
  }

  set(platform: Platform, channelId: string, data: CachedEmoteSet, ttl = CATALOG_TTL_MS): void {
    const key = this.getKey(platform, channelId)

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    })
  }

  invalidate(platform: Platform, channelId: string): void {
    this.cache.delete(this.getKey(platform, channelId))
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
