import type { ModerationAction, ModerationPlatform } from '../../../gpuix/backend/api'
import { t } from '../../../gpuix/i18n'

const activationDistance = 32
const deleteDistance = 80
const timeoutStepDistance = 42
const timeoutPresets = [60, 300, 600, 1800, 3600, 86_400, 604_800]

export type ModerationDragAction =
  | { action: 'delete_message'; label: string }
  | { action: 'timeout'; durationSeconds: number; label: string }
  | { action: 'ban'; label: string }

export interface ModerationDragTarget {
  /** A deleted message cannot be deleted again; its delete zone stays inert. */
  messageDeleted?: boolean
}

export function moderationActionForDrag(
  platform: ModerationPlatform,
  distance: number,
  target: ModerationDragTarget = {},
): ModerationDragAction | null {
  const clampedDistance = Math.max(0, distance)
  if (clampedDistance < activationDistance) return null
  if (clampedDistance < deleteDistance) {
    return target.messageDeleted
      ? null
      : { action: 'delete_message', label: t('commands.moderation.delete') }
  }

  // Kick caps timeouts at seven days; Twitch accepts a larger maximum. All
  // current presets are valid for both, but retaining the cap keeps future
  // additions from producing an invalid Kick request.
  const maximumTimeout = platform === 'kick' ? 604_800 : 1_209_600
  const timeoutIndex = Math.floor((clampedDistance - deleteDistance) / timeoutStepDistance)
  if (timeoutIndex < timeoutPresets.length) {
    const durationSeconds = timeoutPresets[timeoutIndex]
    if (durationSeconds !== undefined && durationSeconds <= maximumTimeout) {
      return {
        action: 'timeout',
        durationSeconds,
        label: t('commands.moderation.timeout', { duration: formatTimeout(durationSeconds) }),
      }
    }
  }

  return { action: 'ban', label: t('commands.moderation.ban') }
}

export function moderationActionColor(action: ModerationAction | null): string {
  switch (action) {
    case 'delete_message':
      return '#f59e0b'
    case 'timeout':
      return '#ef4444'
    case 'ban':
      return '#dc2626'
    default:
      return '#64748b'
  }
}

function formatTimeout(seconds: number): string {
  if (seconds >= 86_400) return t('commands.moderation.days', { count: seconds / 86_400 })
  if (seconds >= 3600) return t('commands.moderation.hours', { count: seconds / 3600 })
  return t('commands.moderation.minutes', { count: seconds / 60 })
}
