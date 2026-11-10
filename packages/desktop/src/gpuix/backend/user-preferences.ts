import type { Platform } from '@twirchat/shared/types'
import {
  DEFAULT_MODERATION_SETTINGS,
  validateModerationSettings,
  type ModerationSettings,
} from '@twirchat/shared/user-profile'

import { getDb } from '../../store/db'

function read(key: string): string | null {
  return (
    getDb()
      .query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?')
      .get(`gpuix_ui_${key}`)?.value ?? null
  )
}
function write(key: string, value: string): void {
  getDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [`gpuix_ui_${key}`, value],
  )
}
function noteKey(params: { platform: Platform; platformUserId: string }): string {
  if (
    !['twitch', 'youtube', 'kick', 'vkplay'].includes(params.platform) ||
    !params.platformUserId ||
    params.platformUserId.length > 256
  )
    throw new Error('A valid platform and user ID are required.')
  return `user_notes_${params.platform}_${params.platformUserId}`
}
export function getUserNotes(params: { platform: Platform; platformUserId: string }): string {
  return read(noteKey(params)) ?? ''
}
export function setUserNotes(params: {
  platform: Platform
  platformUserId: string
  text: string
}): void {
  if (typeof params.text !== 'string' || params.text.length > 50000)
    throw new Error('Notes may contain at most 50000 characters.')
  write(noteKey(params), params.text)
}
export function getModerationSettings(): ModerationSettings {
  const value = read('moderation_settings_v1')
  return value === null
    ? structuredClone(DEFAULT_MODERATION_SETTINGS)
    : validateModerationSettings(JSON.parse(value))
}
export function saveModerationSettings(settings: ModerationSettings): void {
  write('moderation_settings_v1', JSON.stringify(validateModerationSettings(settings)))
}
