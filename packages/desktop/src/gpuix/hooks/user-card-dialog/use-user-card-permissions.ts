import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useMemo } from 'react'

export type UserCardPermission = 'read'

export interface UserCardPermissions {
  can: (user: UserCardTarget, permission: UserCardPermission) => boolean
}

/** Whether the card may expose the moderation block for this user. */
export function canUseUserCardAction(
  user: UserCardTarget,
  permission: UserCardPermission,
): boolean {
  if (permission !== 'read') return false
  const channel = user.channelSlug
  const moderator = user.badges?.some((badge) => badge.type === 'moderator') ?? false
  const broadcaster = user.badges?.some((badge) => badge.type === 'broadcaster') ?? false
  const owner =
    (user.channelId !== undefined && user.platformUserId === user.channelId) ||
    (user.username !== undefined &&
      channel !== undefined &&
      user.username.toLowerCase() === channel.toLowerCase())
  return moderator || broadcaster || owner
}

export function useUserCardPermissions(): UserCardPermissions {
  return useMemo(() => ({ can: canUseUserCardAction }), [])
}
