import type { Account, Platform, WatchedChannel } from '@twirchat/shared/types'

import { t } from '../gpuix/i18n'
import { AccountStore } from '../store/account-store'
import { WatchedChannelStore } from '../store/watched-channels-store'

/** The account a chat sends with: its own choice while saved, else the platform default. */
export function chatAccount(
  channel: Pick<WatchedChannel, 'platform' | 'accountId'>,
): Account | null {
  if (channel.accountId) {
    const account = AccountStore.findById(channel.accountId)
    if (account?.platform === channel.platform) return account
  }
  return AccountStore.findByPlatform(channel.platform)
}

/**
 * The chat's chosen account when it differs from the default account the chat reads with;
 * such messages go out over that account's own connection. YouTube chats always use the
 * default account.
 */
export function chatSender(
  channel: Pick<WatchedChannel, 'platform' | 'accountId'>,
): Account | null {
  if (!channel.accountId || channel.platform === 'youtube') return null
  const account = AccountStore.findById(channel.accountId)
  if (account?.platform !== channel.platform) return null
  return account.id === AccountStore.findByPlatform(channel.platform)?.id ? null : account
}

/**
 * A saved account of the chat's platform that sends over its own connection: `null` when it is
 * the default account the chat reads with. Throws for a missing or foreign account.
 */
export function separateSender(
  channel: Pick<WatchedChannel, 'platform'>,
  accountId: string,
): Account | null {
  const account = AccountStore.findById(accountId)
  if (account?.platform !== channel.platform || channel.platform === 'youtube')
    throw new Error(t('runtime.api.accountPlatformMismatch'))
  return account.id === AccountStore.findByPlatform(channel.platform)?.id ? null : account
}

/** The saved account `accountId` when it belongs to `platform`; throws otherwise. */
export function platformAccount(platform: Platform, accountId: string): Account {
  const account = AccountStore.findById(accountId)
  if (account?.platform !== platform) throw new Error(t('runtime.api.accountPlatformMismatch'))
  return account
}

/** Account for channel-scoped actions (moderation, commands, chatters) in `channelSlug`. */
export function channelAccount(platform: Platform, channelSlug: string): Account | null {
  return chatAccount(
    WatchedChannelStore.findByPlatformAndSlug(platform, channelSlug) ?? { platform },
  )
}
