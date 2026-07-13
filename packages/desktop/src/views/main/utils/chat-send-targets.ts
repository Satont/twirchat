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
export function ownChatSendTargets(accounts: Account[]): ChatSendTarget[] {
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
