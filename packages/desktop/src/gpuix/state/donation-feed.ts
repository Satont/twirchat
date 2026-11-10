import type { DonationEvent } from '@twirchat/shared/donations'

import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

const MAX_ROWS = 200
const RECENT_KEY_LIMIT = 1000
const MAX_SHARED_CHANNELS = 200

export interface DonationRow {
  key: string
  donation: DonationEvent
}

interface DonationFeed {
  rows: readonly DonationRow[]
  total: number
}

export const EMPTY_DONATION_FEED: DonationFeed = { rows: [], total: 0 }

/** Remembers the last RECENT_KEY_LIMIT keys so redelivered events are dropped. */
function createRecentKeys() {
  const seen = new Set<string>()
  const recentKeys: string[] = []
  let cursor = 0
  return (key: string): boolean => {
    if (seen.has(key)) return false
    seen.add(key)
    const expired = recentKeys[cursor]
    if (expired !== undefined) seen.delete(expired)
    recentKeys[cursor] = key
    cursor = (cursor + 1) % RECENT_KEY_LIMIT
    return true
  }
}

function donationKey(event: DonationEvent): string {
  return `donation:${event.provider}:${event.id}`
}

function insertDonation(current: DonationFeed, key: string, event: DonationEvent): DonationFeed {
  const donation = {
    ...event,
    username: sanitizeDisplayText(event.username).trim() || 'Anonymous',
    message: sanitizeDisplayText(event.message).trim(),
  }
  const index = current.rows.findLastIndex((row) => row.donation.timestamp <= event.timestamp) + 1
  const rows = current.rows.toSpliced(index, 0, { key, donation }).slice(-MAX_ROWS)
  return { rows, total: current.total + 1 }
}

export function createDonationFeed() {
  const store = createStore(EMPTY_DONATION_FEED)
  const remember = createRecentKeys()

  function receive(event: DonationEvent): void {
    const key = donationKey(event)
    if (!remember(key)) return
    store.set(insertDonation(store.get(), key, event))
  }

  return { store, receive }
}

/** Donations streamers shared to watched chats, keyed by `donationChannelKey`. */
export function createSharedDonationFeeds() {
  const store = createStore<ReadonlyMap<string, DonationFeed>>(new Map())
  const remember = createRecentKeys()

  function receive({ channelKey, donation }: { channelKey: string; donation: DonationEvent }) {
    const key = donationKey(donation)
    if (!remember(`${channelKey}\n${key}`)) return
    const current = store.get()
    const next = new Map(current)
    // Re-inserting moves the channel to the end, so eviction drops the longest-silent chat.
    next.delete(channelKey)
    next.set(
      channelKey,
      insertDonation(current.get(channelKey) ?? EMPTY_DONATION_FEED, key, donation),
    )
    if (next.size > MAX_SHARED_CHANNELS) {
      const oldest = next.keys().next()
      if (!oldest.done) next.delete(oldest.value)
    }
    store.set(next)
  }

  return { store, receive }
}

export const donationFeed = persistentResource('donationFeed', createDonationFeed)
export const sharedDonationFeeds = persistentResource(
  'sharedDonationFeeds',
  createSharedDonationFeeds,
)

declare module './persistent-resources' {
  interface PersistentResources {
    donationFeed: ReturnType<typeof createDonationFeed>
    sharedDonationFeeds: ReturnType<typeof createSharedDonationFeeds>
  }
}
