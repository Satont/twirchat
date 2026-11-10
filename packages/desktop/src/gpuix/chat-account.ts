import type { Account, WatchedChannel } from '@twirchat/shared/types'

/**
 * The account a chat sends with, as the backend resolves it: the pane's own saved choice, else
 * the chat's, else the platform's active account, else none (anonymous).
 */
export function resolveChatAccount(
  channel: Pick<WatchedChannel, 'platform' | 'accountId'>,
  saved: readonly Account[],
  active: readonly Account[],
  paneAccountId?: string,
): Account | undefined {
  // YouTube chats always send with the default account.
  if (channel.platform !== 'youtube')
    for (const id of [paneAccountId, channel.accountId]) {
      const chosen = id ? saved.find((account) => account.id === id) : undefined
      if (chosen?.platform === channel.platform) return chosen
    }
  return active.find((account) => account.platform === channel.platform)
}
