import type { Platform } from "@twirchat/shared";

export interface SevenTVEmote {
  id: string;
  alias: string;
  name: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  imageUrl: string;
}

export interface CachedEmoteSet {
  id: string;
  channelId: string;
  platform: Platform;
  emotes: Map<string, SevenTVEmote>; // alias -> emote
  fetchedAt: number;
  ttl: number;
}

interface CacheEntry {
  data: CachedEmoteSet;
  expiresAt: number;
}

export class SevenTVCache {
  private cache = new Map<string, CacheEntry>(); // channelKey -> entry
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  private getKey(platform: Platform, channelId: string): string {
    return `${platform}:${channelId}`;
  }

  get(platform: Platform, channelId: string): CachedEmoteSet | undefined {
    const key = this.getKey(platform, channelId);
    const entry = this.cache.get(key);
    
    if (!entry) return undefined;
    
    // Return even if expired - caller can decide to use stale data
    return entry.data;
  }

  isExpired(platform: Platform, channelId: string): boolean {
    const key = this.getKey(platform, channelId);
    const entry = this.cache.get(key);
    
    if (!entry) return true;
    return Date.now() > entry.expiresAt;
  }

  set(platform: Platform, channelId: string, data: CachedEmoteSet, ttl?: number): void {
    const key = this.getKey(platform, channelId);
    const effectiveTtl = ttl ?? this.DEFAULT_TTL;
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + effectiveTtl,
    });
  }

  has(platform: Platform, channelId: string): boolean {
    return this.cache.has(this.getKey(platform, channelId));
  }

  invalidate(platform: Platform, channelId: string): void {
    this.cache.delete(this.getKey(platform, channelId));
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  updateEmote(platform: Platform, channelId: string, emoteId: string, update: Partial<SevenTVEmote>): boolean {
    const key = this.getKey(platform, channelId);
    const entry = this.cache.get(key);
    
    if (!entry) return false;
    
    // Find emote by ID
    for (const [alias, emote] of entry.data.emotes) {
      if (emote.id === emoteId) {
        Object.assign(emote, update);
        // If alias changed, update the map key
        if (update.alias && update.alias !== alias) {
          entry.data.emotes.delete(alias);
          entry.data.emotes.set(update.alias.toLowerCase(), emote);
        }
        return true;
      }
    }
    
    return false;
  }

  addEmote(platform: Platform, channelId: string, emote: SevenTVEmote): boolean {
    const key = this.getKey(platform, channelId);
    const entry = this.cache.get(key);
    
    if (!entry) return false;
    
    entry.data.emotes.set(emote.alias.toLowerCase(), emote);
    return true;
  }

  removeEmote(platform: Platform, channelId: string, emoteId: string): boolean {
    const key = this.getKey(platform, channelId);
    const entry = this.cache.get(key);
    
    if (!entry) return false;
    
    for (const [alias, emote] of entry.data.emotes) {
      if (emote.id === emoteId) {
        entry.data.emotes.delete(alias);
        return true;
      }
    }
    
    return false;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const sevenTVCache = new SevenTVCache();

// Periodic cleanup every 5 minutes
setInterval(() => {
  sevenTVCache.cleanup();
}, 5 * 60 * 1000);
