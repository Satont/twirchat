import type { Platform } from './types'

export interface RoomState {
  platform: Platform
  channelId: string
  slowSeconds?: number
  /** null disables followers-only mode; zero permits all followers. */
  followersOnlyMinutes?: number | null
  subscribersOnly?: boolean
  emoteOnly?: boolean
  uniqueChat?: boolean
}

export interface ChatClear {
  platform: Platform
  channelId: string
}

function defineCommandNames<const Names extends readonly string[]>(names: Names): Names {
  return names
}

export const PLATFORM_COMMAND_NAMES = defineCommandNames([
  'ban',
  'timeout',
  'unban',
  'untimeout',
  'delete',
  'clear',
  'slow',
  'slowoff',
  'followers',
  'followersoff',
  'subscribers',
  'subscribersoff',
  'emoteonly',
  'emoteonlyoff',
  'uniquechat',
  'uniquechatoff',
  'announce',
  'announceblue',
  'announcegreen',
  'announceorange',
  'announcepurple',
  'color',
  'commercial',
  'raid',
  'unraid',
  'shoutout',
  'mod',
  'unmod',
  'vip',
  'unvip',
  'mods',
  'vips',
  'block',
  'unblock',
  'w',
  'whisper',
  'warn',
  'shield',
  'shieldoff',
  'blockedterms',
  'blockterm',
  'unblockterm',
  'automodallow',
  'automoddeny',
  'restrict',
  'monitor',
  'unrestrict',
  'unmonitor',
  'clip',
  'marker',
  'title',
  'category',
  'uptime',
  'usercolor',
])

export type PlatformCommandName = (typeof PLATFORM_COMMAND_NAMES)[number]

export interface PlatformCommandResult {
  message?: string
}
