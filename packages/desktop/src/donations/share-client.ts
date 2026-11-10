import type { DesktopToBackendMessage } from '@twirchat/shared'
import type {
  DonationEvent,
  DonationShareChannel,
  DonationShareIdentity,
} from '@twirchat/shared/donations'

interface DonationShareClientOptions {
  send: (message: DesktopToBackendMessage) => void
  isConnected: () => boolean
  /** Tokens of the active Twitch and Kick accounts, which prove the streamer owns their chats. */
  identities: () => DonationShareIdentity[]
  /** Chats open in watched panes. */
  watched: () => DonationShareChannel[]
}

/**
 * Keeps the backend informed about which chats this client owns (while sharing is on) and
 * which chats it watches, and forwards donations the streamer chose to share.
 */
export function createDonationShareClient({
  send,
  isConnected,
  identities,
  watched,
}: DonationShareClientOptions) {
  let enabled = false
  let sentIdentities: string | null = null
  let sentWatched: string | null = null

  function syncIdentities() {
    if (!isConnected()) return
    const next = enabled ? identities() : []
    const serialized = JSON.stringify(next)
    if (serialized === sentIdentities) return
    sentIdentities = serialized
    send({ type: 'donation_share_identities', identities: next })
  }

  function syncWatched() {
    if (!isConnected()) return
    const channels = watched()
    const serialized = JSON.stringify(channels)
    if (serialized === sentWatched) return
    sentWatched = serialized
    send({ type: 'donation_watch', channels })
  }

  return {
    setEnabled(next: boolean) {
      enabled = next
      syncIdentities()
    },
    syncIdentities,
    syncWatched,
    /** A new backend session starts without any state from the previous one. */
    connected() {
      // A fresh session has no identities, so there is nothing to clear while sharing is off.
      sentIdentities = enabled ? null : JSON.stringify([])
      sentWatched = null
      syncIdentities()
      syncWatched()
    },
    share(donation: DonationEvent) {
      if (enabled && isConnected()) send({ type: 'donation_share', donation })
    },
  }
}

export type DonationShareClient = ReturnType<typeof createDonationShareClient>
