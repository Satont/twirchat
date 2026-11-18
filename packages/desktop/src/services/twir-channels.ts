import type { Account, WatchedChannel } from '@twirchat/shared/types'

export type TwirChannelSlug = { platform: 'twitch' | 'youtube'; channelSlug: string }
export type TwirChannelTarget =
  | { platform: WatchedChannel['platform']; platformChannelId: string }
  | TwirChannelSlug

interface TwirTargetSelection {
  watchedChannel?: Pick<WatchedChannel, 'platform' | 'channelSlug'> | null
  watchedChannelId?: string
  accounts: readonly Account[]
}

export function resolveTwirTargets({
  watchedChannel,
  watchedChannelId,
  accounts,
}: TwirTargetSelection): TwirChannelTarget[] {
  if (watchedChannel) {
    const { platform, channelSlug } = watchedChannel
    if (platform === 'kick')
      return watchedChannelId ? [{ platform, platformChannelId: watchedChannelId }] : []
    if (platform === 'vkplay') return []
    return [{ platform, channelSlug }]
  }

  const candidates = new Map<WatchedChannel['platform'], TwirChannelTarget>()
  for (const { platform, platformUserId } of accounts) {
    if (platformUserId && !candidates.has(platform))
      candidates.set(platform, { platform, platformChannelId: platformUserId })
  }
  const twitch = candidates.get('twitch')
  candidates.delete('twitch')
  return twitch ? [twitch, ...candidates.values()] : [...candidates.values()]
}
