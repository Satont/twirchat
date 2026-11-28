import type { Platform } from '@twirchat/shared'

export type SevenTVChannelKey = `${Platform}:${string}`

export function sevenTVChannelKey(platform: Platform, channelId: string): SevenTVChannelKey {
  return `${platform}:${channelId}`
}
