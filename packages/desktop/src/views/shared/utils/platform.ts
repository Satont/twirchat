import type { Platform } from '@twirchat/shared/types'

const PLATFORM_COLORS: Record<Platform, string> = {
  twitch: '#9146ff',
  youtube: '#ff0000',
  kick: '#53fc18',
  vkplay: '#0077ff',
}

export function platformColor(platform: string): string {
  return (
    (platform === 'twitch' || platform === 'youtube' || platform === 'kick' || platform === 'vkplay'
      ? PLATFORM_COLORS[platform]
      : undefined) ?? '#888'
  )
}
