import type { Account, WatchedChannel } from '@twirchat/shared/types'

/**
 * The account a chat signs in with, as the backend resolves it: the chat's own saved choice,
 * else the platform's active account, else none (anonymous).
 */
export function resolveChatAccount(
  channel: Pick<WatchedChannel, 'platform' | 'accountId'>,
  saved: readonly Account[],
  active: readonly Account[],
): Account | undefined {
  // YouTube chats always send with the default account.
  const chosen =
    channel.accountId && channel.platform !== 'youtube'
      ? saved.find((account) => account.id === channel.accountId)
      : undefined
  if (chosen?.platform === channel.platform) return chosen
  return active.find((account) => account.platform === channel.platform)
}
