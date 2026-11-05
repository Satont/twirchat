import type { Account, NormalizedChatMessage, Platform } from '@twirchat/shared/types'

export interface ChatSendTarget {
  platform: Extract<Platform, 'twitch' | 'kick'>
  channelLogin: string
}

export interface ChatMessageTarget extends ChatSendTarget {
  text: string
  replyToMessageId?: string
}

// The home composer always sends as the connected account to that account's
// own channel. Watched channels are read targets and must never replace this.
export function ownChatSendTargets(accounts: readonly Account[]): ChatSendTarget[] {
  return accounts.flatMap((account) => {
    if (
      (account.platform !== 'twitch' && account.platform !== 'kick') ||
      !account.username.trim()
    ) {
      return []
    }
    return [{ platform: account.platform, channelLogin: account.username }]
  })
}

export function chatChannelKey(platform: Platform, channelLogin: string): string {
  return `${platform}:${channelLogin.trim().toLowerCase()}`
}

// My channels belongs only to the channel of each connected account. The
// transport also receives watched-channel messages, so filter its shared event
// stream before it reaches the home chat buffer.
export function filterHomeChatMessages(
  messages: readonly NormalizedChatMessage[],
  accounts: readonly Account[],
): NormalizedChatMessage[] {
  const ownChannels = new Set(
    ownChatSendTargets(accounts).map((target) =>
      chatChannelKey(target.platform, target.channelLogin),
    ),
  )
  for (const account of accounts) {
    if (account.platform === 'kick' && account.platformUserId.trim())
      ownChannels.add(chatChannelKey('kick', account.platformUserId))
  }

  return messages.filter((message) =>
    ownChannels.has(chatChannelKey(message.platform, message.channelId)),
  )
}

export function createChatMessageTargets(
  targets: readonly ChatSendTarget[],
  text: string,
  isEnabled: (platform: ChatSendTarget['platform']) => boolean,
  replyTarget?: Pick<NormalizedChatMessage, 'id' | 'platform'> | null,
): ChatMessageTarget[] {
  return targets.flatMap((target) => {
    if (!isEnabled(target.platform) || (replyTarget && target.platform !== replyTarget.platform)) {
      return []
    }

    return [
      {
        channelLogin: target.channelLogin,
        platform: target.platform,
        text,
        ...(replyTarget ? { replyToMessageId: replyTarget.id } : {}),
      },
    ]
  })
}

/** Per-platform chat message limits, in characters (Unicode code points). */
const MESSAGE_LENGTH_LIMITS: Record<Platform, number> = {
  twitch: 500,
  kick: 500,
  youtube: 200,
}

/** The tightest limit across every platform a message is about to go to. */
export function messageLengthLimit(platforms: readonly Platform[]): number | null {
  const limits = platforms.map((platform) => MESSAGE_LENGTH_LIMITS[platform])
  return limits.length ? Math.min(...limits) : null
}

/** Length as chat platforms count it — code points, so an emoji is one. */
export function messageLength(text: string): number {
  const characters = text[Symbol.iterator]()
  let count = 0
  while (!characters.next().done) count += 1
  return count
}
