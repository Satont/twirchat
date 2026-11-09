import type { Account } from '@twirchat/shared/types'

import { runInBackground } from './background-task'
import type { TwitchEventSubClient } from './twitch-eventsub'

type TwitchAccount = Pick<Account, 'id' | 'username' | 'platformUserId'>
type EventSubClient = Pick<TwitchEventSubClient, 'stop' | 'restart' | 'watch'>

interface Dependencies {
  activeAccount(): TwitchAccount | null
  channelAccount(channelSlug: string): TwitchAccount | null
  createClient(account: TwitchAccount, primary: boolean): EventSubClient
  clearAutoMod(channelSlug: string): void
}

interface SubscriptionTarget {
  account: TwitchAccount
  primary: boolean
  channels: Set<string>
}

export function createTwitchEventSubAccounts(dependencies: Dependencies) {
  const watches = new Map<string, number>()
  const clients = new Map<string, SubscriptionTarget & { client: EventSubClient }>()
  let channelOwners = new Map<string, string>()

  function refresh(restartPrimary = false): void {
    const primary = dependencies.activeAccount()
    const desired = new Map<string, SubscriptionTarget>()
    const owners = new Map<string, string>()
    const targetFor = (account: TwitchAccount) => {
      const existing = desired.get(account.id)
      if (existing) return existing
      const target = {
        account,
        primary: account.id === primary?.id,
        channels: new Set<string>(),
      }
      desired.set(account.id, target)
      return target
    }
    const assign = (channelSlug: string) => {
      const account = dependencies.channelAccount(channelSlug)
      if (!account) return
      owners.set(channelSlug, account.id)
      targetFor(account).channels.add(channelSlug)
    }

    if (primary) {
      const ownChannel = primary.username.toLowerCase()
      // Own-channel activities and whispers always use the active account.
      targetFor(primary).channels.add(ownChannel)
      if (dependencies.channelAccount(ownChannel)?.id === primary.id)
        owners.set(ownChannel, primary.id)
    }
    for (const channel of watches.keys()) {
      if (!owners.has(channel)) assign(channel)
    }
    for (const [channel, accountId] of channelOwners) {
      if (owners.get(channel) !== accountId) dependencies.clearAutoMod(channel)
    }
    channelOwners = owners

    for (const [id, entry] of clients) {
      if (desired.get(id)?.primary === entry.primary) continue
      entry.client.stop()
      clients.delete(id)
    }
    for (const [id, target] of desired) {
      const previous = clients.get(id)
      const client = previous?.client ?? dependencies.createClient(target.account, target.primary)
      clients.set(id, { ...target, client })
      if (previous) {
        for (const channel of previous.channels) {
          if (!target.channels.has(channel))
            runInBackground(client.watch(channel, false), 'Could not unwatch Twitch events')
        }
        if (restartPrimary && target.primary) client.restart()
      }
      for (const channel of target.channels) {
        if (!previous?.channels.has(channel))
          runInBackground(client.watch(channel, true), 'Could not watch Twitch events')
      }
    }
  }

  return {
    refresh,
    ownsChannel(accountId: string, channelSlug: string): boolean {
      return channelOwners.get(channelSlug) === accountId
    },
    watch(channelSlug: string, watch: boolean): void {
      const channel = channelSlug.trim().replace(/^#/, '').toLowerCase()
      if (!channel) return
      const count = watches.get(channel) ?? 0
      if (watch) {
        watches.set(channel, count + 1)
        if (count === 0) refresh()
      } else if (count > 1) watches.set(channel, count - 1)
      else if (watches.delete(channel)) refresh()
    },
    stop(): void {
      for (const { client } of clients.values()) client.stop()
      clients.clear()
      channelOwners.clear()
      watches.clear()
    },
  }
}

export type TwitchEventSubAccounts = ReturnType<typeof createTwitchEventSubAccounts>
