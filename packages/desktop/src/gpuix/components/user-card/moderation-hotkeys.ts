import type { ModerationSettings } from '@twirchat/shared/user-profile'

import { t } from '../../i18n'

export function resolveModeratorHotkey(
  argument: string,
  settings: ModerationSettings,
): { action: 'ban' | 'unban' | 'timeout'; duration?: number; message: string } {
  if (argument === 'ban') return { action: 'ban', message: t('misc.moderation.banned') }
  if (argument === 'unban') return { action: 'unban', message: t('misc.moderation.unbanned') }
  const index = /^[1-9]\d*$/u.test(argument) ? Number(argument) - 1 : -1
  const timeout = settings.timeouts[index]
  if (!timeout) throw new Error(t('misc.moderation.chooseTimeout'))
  return {
    action: 'timeout',
    duration: timeout.seconds,
    message: t('misc.moderation.timedOut', { label: timeout.label }),
  }
}
