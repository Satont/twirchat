import type { ModerationAction, ModerationPlatform } from '../services/desktop-api'

const activationDistance = 32
const deleteDistance = 80
const timeoutStepDistance = 42
const timeoutPresets = [60, 300, 600, 1800, 3600, 86_400, 604_800] as const

export type ModerationDragAction =
  | { action: 'delete_message'; label: string }
  | { action: 'timeout'; durationSeconds: number; label: string }
  | { action: 'ban'; label: string }

export function moderationActionForDrag(
  platform: ModerationPlatform,
  distance: number,
): ModerationDragAction | null {
  const clampedDistance = Math.max(0, distance)
  if (clampedDistance < activationDistance) return null
  if (clampedDistance < deleteDistance) {
    return { action: 'delete_message', label: 'Delete message' }
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
        label: `Timeout ${formatTimeout(durationSeconds)}`,
      }
    }
  }

  return { action: 'ban', label: 'Ban permanently' }
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
  if (seconds >= 86_400) return `${seconds / 86_400}d`
  if (seconds >= 3600) return `${seconds / 3600}h`
  return `${seconds / 60}m`
}
