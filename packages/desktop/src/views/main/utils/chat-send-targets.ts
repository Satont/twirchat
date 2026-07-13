import type { Account, Platform } from '@twirchat/shared/types'

export interface ChatSendTarget {
  platform: Extract<Platform, 'twitch' | 'kick'>
  channelLogin: string
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
