import { useMemo, useCallback } from 'react'
import { watchedMessagesStore, homeMessagesStore } from '@gpuix/state/app'
import { collectUserBadges } from '@gpuix/components/user-card-dialog/utils'
import type { Platform } from '@twirchat/shared/types'

const cache = new Map<string, { badges: ReturnType<typeof collectUserBadges>; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useRetainedBadges(
  platform: Platform,
  platformUserId: string,
  channelId?: string,
) {
  const key = `${platform}:${platformUserId}:${channelId ?? 'global'}`

  const getBadges = useCallback(() => {
    const limit = 500

    // Check memory cache first
    const cached = cache.get(`${platform}:${platformUserId}:${channelId ?? 'global'}`)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.badges
    }

    const watchedMessages = watchedMessagesStore.get()
    const homeMessages = homeMessagesStore.get()

    const newestFirst: Array<{ author: { id: string; badges?: Array<{ id: string; type: string; text: string; imageUrl?: string }> }; platform: string }> = []

    // Collect from current channel's messages
    const currentChannelMessages = channelId ? (watchedMessagesStore.get().get(channelId) ?? []) : []

    for (let index = currentChannelMessages.length - 1, count = 0;
      index >= 0 && count < limit;
      index -= 1, count += 1) {
      const message = currentChannelMessages[index]
      if (message) newestFirst.push(message)
    }

    // Also include home messages for global badges (up to remaining limit)
    if (newestFirst.length < limit) {
      const home = Array.from(homeMessagesStore.get().values()).flat()
      const remaining = limit - newestFirst.length
      for (let index = home.length - 1, count = 0;
        index >= 0 && count < remaining;
        index -= 1, count += 1) {
      const message = home[index]
      if (message) newestFirst.push(message)
    }
    }

    // We need to cast because collectUserBadges expects a specific internal type
    // but our structure matches the required structure
    const badges = collectUserBadges(newestFirst as unknown as Parameters<typeof collectUserBadges>[0], platform, platformUserId)

    // Update cache
    const cachedValue = { badges, timestamp: Date.now() }
    cache.set(`${platform}:${platformUserId}:${channelId ?? 'global'}`, cachedValue)

    return badges
  }, [platform, platformUserId, channelId])

  return useMemo(() => getBadges(), [getBadges])
}