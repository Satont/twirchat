import type { Platform } from '@twirchat/shared/types'

const PLATFORM_COLORS: Record<Platform, string> = {
  twitch: '#9146ff',
  youtube: '#ff0000',
  kick: '#53fc18',
}

export function platformColor(platform: string): string {
  return PLATFORM_COLORS[platform as Platform] ?? '#888'
}
