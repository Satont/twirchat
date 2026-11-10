import type { Account, ChatSendReceipt, WatchedChannel } from '@twirchat/shared/types'

import { t } from '../gpuix/i18n'
import type { IPlatformAdapter } from '../platforms/base-adapter'
import { KickAdapter } from '../platforms/kick/adapter'
import type { TwitchSenderPool } from '../platforms/twitch/sender-pool'

/** Sends in a chat with a saved account other than the one the chat reads with. */
export interface ChatAccountSender {
  prepare(account: Account, channel: WatchedChannel): Promise<void>
  send(
    account: Account,
    channel: WatchedChannel,
    adapter: IPlatformAdapter,
    text: string,
    replyTo?: string,
  ): Promise<void | ChatSendReceipt>
  release(accountId: string, channel: WatchedChannel): void
}

export function createChatAccountSender(twitch: TwitchSenderPool): ChatAccountSender {
  return {
    prepare: async (account, channel) => {
      if (channel.platform === 'twitch') await twitch.prepare(account, channel.channelSlug)
    },
    send: async (account, channel, adapter, text, replyTo) => {
      if (channel.platform === 'twitch')
        return twitch.send(account, channel.channelSlug, text, replyTo)
      if (adapter instanceof KickAdapter) return adapter.sendMessageAs(account, text, replyTo)
      throw new Error(
        t('misc.accountSender.otherAccountUnavailable', { platform: channel.platform }),
      )
    },
    release: (accountId, channel) => {
      if (channel.platform === 'twitch') twitch.release(accountId, channel.channelSlug)
    },
  }
}
