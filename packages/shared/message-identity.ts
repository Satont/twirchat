import type { NormalizedChatMessage, Platform } from './types'

export function normalizeMessageChannel(platform: Platform, channelId: string): string {
  if (platform === 'youtube') return channelId
  const channel = channelId.trim()
  return (channel[0] === '#' || channel[0] === '@' ? channel.slice(1) : channel).toLowerCase()
}

export function chatMessageIdentity(
  message: Pick<NormalizedChatMessage, 'platform' | 'channelId' | 'id'>,
): string {
  const channel = normalizeMessageChannel(message.platform, message.channelId)
  return `${message.platform}:${channel.length}:${channel}:${message.id}`
}
