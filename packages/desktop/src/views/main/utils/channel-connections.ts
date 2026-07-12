import type { Platform } from '@twirchat/shared/types'

const platforms: Platform[] = ['twitch', 'youtube', 'kick']

export function applySavedChannels(
  target: Record<string, string[]>,
  saved: Partial<Record<Platform, string[]>>,
): void {
  for (const platform of platforms) {
    target[platform] = [...(saved[platform] ?? [])]
  }
}
