import type { ModerationPlatform } from '../../../gpuix/backend/api'
import { t } from '../../../gpuix/i18n'

const activationDistance = 32
const deleteDistance = 80
const timeoutStepDistance = 42
const timeoutPresets = [60, 300, 600, 1800, 3600, 86_400, 604_800]
const unbanDistance = 16
const minimumUnbanDistance = 3

export type ModerationDragAction =
  | { action: 'delete_message'; label: string }
  | { action: 'timeout'; durationSeconds: number; label: string }
  | { action: 'ban'; label: string }
  | { action: 'unban'; label: string }

export interface ModerationDragTarget {
  /** A deleted message cannot be deleted again; its delete zone stays inert. */
  messageDeleted?: boolean
  /** Leftward travel that arms unban; see `unbanDistanceFrom`. */
  unbanDistance?: number
}

/**
 * The rail sits on the pane's left edge, so in a maximized window the screen
 * can end a few pixels left of the press. The unban threshold shrinks to the
 * room left of the press (window coordinates) so the gesture stays reachable.
 */
export function unbanDistanceFrom(startX: number): number {
  return Math.min(unbanDistance, Math.max(minimumUnbanDistance, Math.floor(startX) - 2))
}

/** Positive distance drags right (delete → timeouts → ban); negative drags left (unban). */
export function moderationActionForDrag(
  platform: ModerationPlatform,
  distance: number,
  target: ModerationDragTarget = {},
): ModerationDragAction | null {
  if (distance < 0) {
    // The ban state is unknown, so unban is always offered; Twitch and Kick
    // lift a timeout the same way.
    return -distance >= (target.unbanDistance ?? unbanDistance)
      ? { action: 'unban', label: t('commands.moderation.unban') }
      : null
  }
  if (distance < activationDistance) return null
  if (distance < deleteDistance) {
    return target.messageDeleted
      ? null
      : { action: 'delete_message', label: t('commands.moderation.delete') }
  }

  // Kick caps timeouts at seven days; Twitch accepts a larger maximum. All
  // current presets are valid for both, but retaining the cap keeps future
  // additions from producing an invalid Kick request.
  const maximumTimeout = platform === 'kick' ? 604_800 : 1_209_600
  const timeoutIndex = Math.floor((distance - deleteDistance) / timeoutStepDistance)
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

export function moderationActionColor(action: ModerationDragAction['action'] | null): string {
  switch (action) {
    case 'delete_message':
      return '#f59e0b'
    case 'timeout':
      return '#ef4444'
    case 'ban':
      return '#dc2626'
    case 'unban':
      return '#22c55e'
    default:
      return '#64748b'
  }
}

function formatTimeout(seconds: number): string {
  if (seconds >= 86_400) return t('commands.moderation.days', { count: seconds / 86_400 })
  if (seconds >= 3600) return t('commands.moderation.hours', { count: seconds / 3600 })
  return t('commands.moderation.minutes', { count: seconds / 60 })
}
