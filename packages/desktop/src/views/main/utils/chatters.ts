import type { Platform, WatchedChannel } from '@twirchat/shared/types'
import type {
  ChattersTarget,
  ChatterGroup,
  ChatterRole,
  ChatterUser,
} from '../services/desktop-api'
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

  return ownTargets
    .filter((target) => supportsChatters(target.platform))
    .map((target) => ({ platform: target.platform, channelSlug: target.channelLogin }))
}

export function chatterRoleLabel(role: ChatterRole): string {
  switch (role) {
    case 'broadcaster': {
      return 'Broadcaster'
    }
    case 'moderators': {
      return 'Moderators'
    }
    case 'vips': {
      return 'VIPs'
    }
    case 'ogs': {
      return 'OGs'
    }
    case 'bots': {
      return 'Bots'
    }
    case 'chatters': {
      return 'Chatters'
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
