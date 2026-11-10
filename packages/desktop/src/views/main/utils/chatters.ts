import type { Platform, WatchedChannel } from '@twirchat/shared/types'

import type {
  ChattersTarget,
  ChatterGroup,
  ChatterRole,
  ChatterUser,
} from '../../../gpuix/backend/api'
import { t } from '../../../gpuix/i18n'
import type { ChatSendTarget } from './chat-send-targets'

export function supportsChatters(platform: Platform | undefined): platform is 'twitch' | 'kick' {
  return platform === 'twitch' || platform === 'kick'
}

export function buildChattersTargets(
  watchedChannel: Pick<WatchedChannel, 'platform' | 'channelSlug'> | null | undefined,
  ownTargets: readonly ChatSendTarget[],
): ChattersTarget[] {
  if (watchedChannel) {
    if (!supportsChatters(watchedChannel.platform)) return []
    return [{ platform: watchedChannel.platform, channelSlug: watchedChannel.channelSlug }]
  }

  return ownTargets.flatMap((target) =>
    supportsChatters(target.platform)
      ? [{ platform: target.platform, channelSlug: target.channelLogin }]
      : [],
  )
}

export function chatterRoleLabel(role: ChatterRole): string {
  switch (role) {
    case 'broadcaster': {
      return t('chat.chatters.role.broadcaster')
    }
    case 'moderators': {
      return t('chat.chatters.role.moderators')
    }
    case 'vips': {
      return t('chat.chatters.role.vips')
    }
    case 'ogs': {
      return t('chat.chatters.role.ogs')
    }
    case 'bots': {
      return t('chat.chatters.role.bots')
    }
    case 'chatters': {
      return t('chat.chatters.role.chatters')
    }
  }
}

export function filterChatterGroups(groups: ChatterGroup[], query: string): ChatterGroup[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return groups.filter((group) => group.users.length > 0)
  }

  return groups
    .map((group) => ({
      ...group,
      users: group.users.filter((user) => matchesChatterQuery(user, normalized)),
    }))
    .filter((group) => group.users.length > 0)
}

function matchesChatterQuery(user: ChatterUser, normalizedQuery: string): boolean {
  return (
    user.username.toLowerCase().includes(normalizedQuery) ||
    user.displayName.toLowerCase().includes(normalizedQuery)
  )
}
