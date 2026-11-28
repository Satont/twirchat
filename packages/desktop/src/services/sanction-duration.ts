import { tPlural } from '../i18n'

/** Human-readable chat sanction duration, e.g. `10m`, `2h` or `2 часа`. */
export function formatSanctionDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return tPlural('notices.moderation.durationDays', seconds / 86_400)
  if (seconds % 3_600 === 0) return tPlural('notices.moderation.durationHours', seconds / 3_600)
  if (seconds % 60 === 0) return tPlural('notices.moderation.durationMinutes', seconds / 60)
  return tPlural('notices.moderation.durationSeconds', seconds)
}
