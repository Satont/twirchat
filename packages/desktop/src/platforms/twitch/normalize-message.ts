import type { Badge, NormalizedChatMessage } from '@twirchat/shared/types'
import type { ChatMessage } from '@twurple/chat'

import { codePointRangeToUtf16 } from '../../views/shared/utils/display-text'

export function twitchAuthorAppearance(
  tags: ReadonlyMap<string, string>,
  badgeCache: ReadonlyMap<string, Badge>,
): Pick<NormalizedChatMessage['author'], 'badges' | 'color'> {
  const badges: Badge[] = []
  for (const badge of (tags.get('badges') ?? '').split(',')) {
    const [type, version = '1'] = badge.split('/')
    if (!type) continue
    const id = `${type}/${version}`
    badges.push(badgeCache.get(id) ?? { id, type, text: type })
  }
  return { badges, color: tags.get('color') || undefined }
}

export function twitchMessageMetadata(
  msg: Pick<ChatMessage, 'isFirst' | 'isReturningChatter' | 'isHighlight' | 'rewardId' | 'bits'> & {
    tags: ReadonlyMap<string, string>
    userInfo: { badgeInfo: ReadonlyMap<string, string> }
  },
): NonNullable<NormalizedChatMessage['metadata']> {
  const { tags } = msg
  const months = Number(
    msg.userInfo.badgeInfo.get('subscriber') ?? msg.userInfo.badgeInfo.get('founder'),
  )
  return {
    firstMessage: msg.isFirst,
    returningChatter: msg.isReturningChatter,
    highlighted: msg.isHighlight,
    ...(msg.rewardId ? { rewardId: msg.rewardId } : {}),
    ...(msg.bits > 0 ? { bits: msg.bits } : {}),
    ...(Number.isSafeInteger(months) && months > 0 ? { subscriptionMonths: months } : {}),
    ...(tags.get('source-room-id')
      ? {
          sharedChat: {
            sourceChannelId: tags.get('source-room-id') ?? '',
            sourceMessageId: tags.get('source-id'),
          },
        }
      : {}),
  }
}

interface TwitchMessageOptions {
  avatarUrl?: string
  text?: string
  isAction?: boolean
}
export function normalizeTwitchChatMessage(
  msg: ChatMessage,
  badgeCache: ReadonlyMap<string, Badge>,
  options: TwitchMessageOptions = {},
): NormalizedChatMessage {
  const channel = msg.target
  const text = options.text ?? msg.text
  const { tags } = msg

  const userId = tags.get('user-id') ?? ''
  const displayName = tags.get('display-name') ?? msg.userInfo.userName
  const msgId = tags.get('id') ?? `${Date.now()}`
  const timestamp = msg.date
  const avatarUrl = options.avatarUrl

  const replyParentMsgId = tags.get('reply-parent-msg-id')
  const replyParentMsgBody = tags.get('reply-parent-msg-body')
  const replyParentUserLogin = tags.get('reply-parent-user-login')
  const replyParentDisplayName = tags.get('reply-parent-display-name') ?? replyParentUserLogin
  const replyParentUserId = tags.get('reply-parent-user-id')

  // Parse emotes from the parsed message
  const emotes: NormalizedChatMessage['emotes'] = []
  if (msg.emoteOffsets) {
    for (const [emoteId, offsets] of msg.emoteOffsets) {
      const positions = offsets.map((offset: string) => {
        const [start, end] = offset.split('-').map(Number)
        return codePointRangeToUtf16(text, start ?? 0, end ?? 0)
      })

      // Get emote name from first position
      const firstPos = positions[0]
      const emoteName = firstPos ? text.slice(firstPos.start, (firstPos.end ?? 0) + 1) : ''

      emotes.push({
        id: emoteId,
        imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/1.0`,
        name: emoteName,
        positions,
      })
    }
  }

  const normalized: NormalizedChatMessage = {
    author: {
      ...twitchAuthorAppearance(tags, badgeCache),
      avatarUrl,
      displayName,
      id: userId,
      username: msg.userInfo.userName,
    },
    channelId: channel.replace(/^#/, '').toLowerCase(),
    emotes,
    id: msgId,
    platform: 'twitch',
    text,
    timestamp,
    type: options.isAction ? 'action' : 'message',
    metadata: twitchMessageMetadata(msg),
    ...(replyParentMsgId && replyParentMsgBody && replyParentUserId
      ? {
          reply: {
            parentAuthor: {
              displayName: replyParentDisplayName ?? replyParentUserLogin ?? '',
              id: replyParentUserId,
              username: replyParentUserLogin ?? '',
            },
            parentMessageId: replyParentMsgId,
            parentMessageText: replyParentMsgBody,
            threadRootMessageId: msg.threadMessageId || undefined,
          },
        }
      : {}),
  }

  return normalized
}
