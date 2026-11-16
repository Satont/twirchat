import { collectUserBadges } from '@gpuix/components/user-card-dialog/utils'
import { watchedMessagesStore, homeMessagesStore } from '@gpuix/state/app'
import type { Platform, NormalizedChatMessage, Badge } from '@twirchat/shared/types'
import { useMemo, useCallback } from 'react'

const cache = new Map<string, { badges: Badge[]; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useRetainedBadges(platform: Platform, platformUserId: string, channelId?: string) {
  const getBadges = useCallback(() => {
    const limit = 500
    const cacheKey = `${platform}:${platformUserId}:${channelId ?? 'global'}`

    // Check memory cache first
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.badges
    }

    // Collect from current channel's messages
    const currentChannelMessages = channelId
      ? (watchedMessagesStore.get().get(channelId) ?? [])
      : []

    const newestFirst: NormalizedChatMessage[] = []

    for (
      let index = currentChannelMessages.length - 1, count = 0;
      index >= 0 && count < limit;
      index -= 1, count += 1
    ) {
      const message = currentChannelMessages[index]
      if (message) newestFirst.push(message)
    }

    // Also include home messages for global badges (up to remaining limit)
    if (newestFirst.length < limit) {
      const home = Array.from(homeMessagesStore.get().values()).flat()
      const remaining = limit - newestFirst.length
      for (
        let index = home.length - 1, count = 0;
        index >= 0 && count < remaining;
        index -= 1, count += 1
      ) {
        const message = home[index]
        if (message) newestFirst.push(message)
      }
    }

    const badges = collectUserBadges(newestFirst, platform, platformUserId)

    // Update cache
    const cachedValue = { badges, timestamp: Date.now() }
    cache.set(`${platform}:${platformUserId}:${channelId ?? 'global'}`, cachedValue)

    return badges
  }, [platform, platformUserId, channelId])

  return useMemo(() => getBadges(), [getBadges])
}
