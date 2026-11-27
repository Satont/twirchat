import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useCallback, useMemo } from 'react'

export type UserCardPermission = 'read'

export interface UserCardPermissions {
  can: (user: UserCardTarget, permission: UserCardPermission) => boolean
}

/** Whether the acting account may moderate in this card's channel. */
export function canUseUserCardAction(
  user: UserCardTarget,
  permission: UserCardPermission,
  canModerate: boolean,
): boolean {
  if (permission !== 'read' || !canModerate) return false
  return (
    (user.platform === 'twitch' || user.platform === 'kick') && typeof user.channelSlug === 'string'
  )
}

export function useUserCardPermissions(canModerate: boolean): UserCardPermissions {
  const can = useCallback(
    (user: UserCardTarget, permission: UserCardPermission) =>
      canUseUserCardAction(user, permission, canModerate),
    [canModerate],
  )
  return useMemo(() => ({ can }), [can])
}
