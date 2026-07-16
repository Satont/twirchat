import type { Platform } from '@twirchat/shared/types'

const TWITCH_OR_KICK_LOGIN = /^[A-Za-z0-9_]{1,25}$/
const YOUTUBE_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/

export function publicChannelURL(platform: Platform, username: string): string | undefined {
  if (platform === 'youtube') {
    return YOUTUBE_HANDLE.test(username) ? `https://www.youtube.com/${username}` : undefined
  }

  if (!TWITCH_OR_KICK_LOGIN.test(username)) return undefined

  return platform === 'twitch'
    ? `https://www.twitch.tv/${username}`
    : `https://kick.com/${username}`
}
