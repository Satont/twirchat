import type { BackendToDesktopMessage } from '@twirchat/shared'
import {
  DONATION_SHARE_LIMITS,
  donationChannelKey,
  isShareableDonationProvider,
  type DonationEvent,
  type DonationShareChannel,
  type DonationShareIdentity,
} from '@twirchat/shared/donations'

const SHARE_WINDOW_MS = 60_000
const SHARES_PER_WINDOW = 30

interface DonationShareRelayOptions {
  verify: (identity: DonationShareIdentity) => Promise<DonationShareChannel | null>
  send: (client: string, message: BackendToDesktopMessage) => void
  now?: () => number
}

interface ShareBudget {
  windowStart: number
  count: number
}

/**
 * Relays a streamer's donations to every other client watching a chat the streamer proved
 * they own. Ownership comes from platform tokens checked once per identity update; the
 * tokens themselves are never kept.
 */
export function createDonationShareRelay({
  verify,
  send,
  now = Date.now,
}: DonationShareRelayOptions) {
  const owners = new Map<string, Promise<readonly DonationShareChannel[]>>()
  const watchers = new Map<string, Set<string>>()
  const watching = new Map<string, ReadonlySet<string>>()
  const budgets = new Map<string, ShareBudget>()

  function unwatch(client: string) {
    for (const key of watching.get(client) ?? []) {
      const clients = watchers.get(key)
      clients?.delete(client)
      if (clients?.size === 0) watchers.delete(key)
    }
    watching.delete(client)
  }

  function spend(client: string): boolean {
    const time = now()
    const budget = budgets.get(client)
    if (!budget || time - budget.windowStart >= SHARE_WINDOW_MS) {
      budgets.set(client, { windowStart: time, count: 1 })
      return true
    }
    if (budget.count >= SHARES_PER_WINDOW) return false
    budget.count++
    return true
  }

  return {
    setIdentities(client: string, identities: readonly DonationShareIdentity[]): void {
      if (identities.length === 0) {
        owners.delete(client)
        return
      }
      const byPlatform = new Map(identities.map((identity) => [identity.platform, identity]))
      owners.set(
        client,
        Promise.all(
          [...byPlatform.values()].map((identity) => verify(identity).catch(() => null)),
        ).then((channels) => channels.flatMap((channel) => (channel ? [channel] : []))),
      )
    },

    /** Resolves with the number of clients the donation reached. */
    async share(client: string, donation: DonationEvent): Promise<number> {
      if (!isShareableDonationProvider(donation.provider)) return 0
      const pending = owners.get(client)
      if (!pending || !spend(client)) return 0
      const channels = await pending
      // Stopped sharing while ownership was still being checked.
      if (!owners.has(client)) return 0
      let delivered = 0
      for (const channel of channels) {
        const message: BackendToDesktopMessage = { type: 'shared_donation', channel, donation }
        for (const watcher of watchers.get(donationChannelKey(channel)) ?? []) {
          if (watcher === client) continue
          send(watcher, message)
          delivered++
        }
      }
      return delivered
    },

    watch(client: string, channels: readonly DonationShareChannel[]): void {
      unwatch(client)
      const keys = new Set(
        channels.slice(0, DONATION_SHARE_LIMITS.watchedChannels).map(donationChannelKey),
      )
      if (keys.size === 0) return
      for (const key of keys) {
        const clients = watchers.get(key) ?? new Set<string>()
        clients.add(client)
        watchers.set(key, clients)
      }
      watching.set(client, keys)
    },

    removeClient(client: string): void {
      owners.delete(client)
      budgets.delete(client)
      unwatch(client)
    },
  }
}

export type DonationShareRelay = ReturnType<typeof createDonationShareRelay>
