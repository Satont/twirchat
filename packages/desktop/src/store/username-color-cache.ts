import type { NormalizedChatMessage, Platform } from '@twirchat/shared/types'

// In-memory cache for platform:username -> color mapping
// Key: "platform:lowercase_username", Value: hex color string or null
const colorCache = new Map<string, string | null>()

// Maximum cache size to prevent unbounded memory growth
const MAX_CACHE_SIZE = 5000

function makeKey(platform: Platform, username: string): string {
  return `${platform}:${username.toLowerCase()}`
}

export const UsernameColorCache = {
  /**
   * Extract username from a mention string (e.g., "@username" -> "username")
   */
  extractUsername(mention: string): string | null {
    const match = mention.match(/^@(.+)$/)
    return match ? (match[1] ?? null) : null
  },

  /**
   * Update cache with author info from a message
   */
  addMessage(msg: NormalizedChatMessage): void {
    const { platform } = msg
    const { username } = msg.author
    const { displayName } = msg.author
    const { color } = msg.author

    if (username) {
      this.set(platform, username, color ?? null)
    }
    if (displayName && displayName.toLowerCase() !== username?.toLowerCase()) {
      this.set(platform, displayName, color ?? null)
    }
  },

  /**
   * Get color for a username on a specific platform
   */
  get(platform: Platform, username: string): string | null {
    return colorCache.get(makeKey(platform, username)) ?? null
  },

  /**
   * Set color for a username on a specific platform
   */
  set(platform: Platform, username: string, color: string | null): void {
    const key = makeKey(platform, username)

    // Simple LRU eviction: if at capacity, clear half the cache
    if (colorCache.size >= MAX_CACHE_SIZE && !colorCache.has(key)) {
      const entriesToDelete = Math.floor(MAX_CACHE_SIZE / 2)
      const keys = [...colorCache.keys()].slice(0, entriesToDelete)
      for (const k of keys) {
        colorCache.delete(k)
      }
    }

    colorCache.set(key, color)
  },

  /**
   * Check if username exists in cache for a platform
   */
  has(platform: Platform, username: string): boolean {
    return colorCache.has(makeKey(platform, username))
  },

  /**
   * Get cache stats for debugging
   */
  getStats(): { size: number; maxSize: number } {
    return { maxSize: MAX_CACHE_SIZE, size: colorCache.size }
  },

  /**
   * Clear the cache
   */
  clear(): void {
    colorCache.clear()
  },
}
