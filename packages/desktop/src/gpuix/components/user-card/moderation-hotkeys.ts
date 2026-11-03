import type { ModerationSettings } from '@twirchat/shared/user-profile'

export function resolveModeratorHotkey(
  argument: string,
  settings: ModerationSettings,
): { action: 'ban' | 'unban' | 'timeout'; duration?: number; message: string } {
  if (argument === 'ban') return { action: 'ban', message: 'User banned.' }
  if (argument === 'unban') return { action: 'unban', message: 'Ban or timeout removed.' }
  const index = /^[1-9]\d*$/u.test(argument) ? Number(argument) - 1 : -1
  const timeout = settings.timeouts[index]
  if (!timeout) throw new Error('Choose a configured timeout button starting at 1.')
  return {
    action: 'timeout',
    duration: timeout.seconds,
    message: `Timed out for ${timeout.label}.`,
  }
}
