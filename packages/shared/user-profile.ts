import type { Platform } from './types'

export interface UserProfileRequest {
  platform: Platform
  platformUserId: string
  username?: string
  channelSlug?: string
}

export interface UserProfileSnapshot {
  id: string
  login?: string
  displayName?: string
  avatarUrl?: string
  description?: string
  color?: string
  broadcasterType?: string
  live?: { title: string; category: string; viewers: number; startedAt: string }
  lastLive?: string
  followers?: number
  pronouns?: string
  nameHistory?: { login: string; firstSeen?: string; lastSeen?: string }[]
  roles?: { broadcaster?: boolean; moderator?: boolean; vip?: boolean; editor?: boolean }
  errors: { section: string; message: string }[]
}

export interface ModerationSettings {
  timeouts: { label: string; seconds: number }[]
  reasons: string[]
  defaultReason: string
}

export const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
  timeouts: [
    { label: '1s', seconds: 1 },
    { label: '30s', seconds: 30 },
    { label: '1m', seconds: 60 },
    { label: '5m', seconds: 300 },
    { label: '10m', seconds: 600 },
    { label: '1h', seconds: 3600 },
    { label: '1d', seconds: 86400 },
    { label: '1w', seconds: 604800 },
  ],
  reasons: ['Spam', 'Harassment', 'Spoilers'],
  defaultReason: '',
}

function parseTimeout(value: unknown): ModerationSettings['timeouts'][number] {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('label' in value) ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label.length > 24 ||
    !('seconds' in value) ||
    typeof value.seconds !== 'number' ||
    !Number.isSafeInteger(value.seconds) ||
    value.seconds < 1 ||
    value.seconds > 1209600
  )
    throw new Error('Configure eight timeout buttons, each from 1 to 1209600 seconds.')
  return { label: value.label.trim(), seconds: value.seconds }
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    throw new Error('Invalid moderation reasons.')
  return value.trim()
}

export function validateModerationSettings(value: unknown): ModerationSettings {
  if (value === null || typeof value !== 'object') throw new Error('Invalid moderation settings.')
  if (!('timeouts' in value) || !Array.isArray(value.timeouts) || value.timeouts.length !== 8)
    throw new Error('Configure eight timeout buttons, each from 1 to 1209600 seconds.')
  const timeouts: readonly unknown[] = value.timeouts
  if (!('reasons' in value) || !Array.isArray(value.reasons) || value.reasons.length > 30)
    throw new Error('Invalid moderation reasons.')
  const reasons: readonly unknown[] = value.reasons
  if (
    !('defaultReason' in value) ||
    typeof value.defaultReason !== 'string' ||
    value.defaultReason.length > 500
  )
    throw new Error('The default reason must contain at most 500 characters.')
  return {
    timeouts: timeouts.map(parseTimeout),
    reasons: reasons.map(parseReason),
    defaultReason: value.defaultReason,
  }
}
