import type { Platform } from '@twirchat/shared/types'

export interface ChatLoggingSettings {
  twitchHistoryEnabled: boolean
  enabled: boolean
  directory: string
  channels: { platform: Platform; channelId: string }[]
  timestamps: boolean
  rotation: 'daily' | 'session'
  maxFileBytes: number
  maxMessages: number
  maxAgeDays: number
}
