import type { NormalizedChatMessage, TwitchChatNotice } from '@twirchat/shared/types'

interface TwitchSystemMessageInput {
  channelId: string
  id?: string
  timestamp?: Date
  text: string
  notice: TwitchChatNotice
  author?: Omit<NormalizedChatMessage['author'], 'badges'>
  sharedChat?: NonNullable<NormalizedChatMessage['metadata']>['sharedChat']
}

export function buildTwitchSystemMessage(input: TwitchSystemMessageInput): NormalizedChatMessage {
  const kind = input.notice.kind
  return {
    id: `twitch:notice:${input.id || crypto.randomUUID()}`,
    channelId: input.channelId.replace(/^#/, '').toLowerCase(),
    platform: 'twitch',
    type: 'system',
    text: input.text,
    timestamp:
      input.timestamp && Number.isFinite(input.timestamp.getTime()) ? input.timestamp : new Date(),
    author: input.author
      ? { ...input.author, badges: [] }
      : { id: '', displayName: 'Twitch', badges: [] },
    emotes: [],
    metadata: {
      twitchNotice: input.notice,
      flags:
        kind === 'moderation'
          ? { moderation_action: true }
          : kind === 'watch_streak'
            ? { watch_streak: true }
            : undefined,
      ...(input.sharedChat ? { sharedChat: input.sharedChat } : {}),
    },
  }
}
