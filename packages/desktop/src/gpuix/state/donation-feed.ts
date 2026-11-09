import type { DonationEvent } from '@twirchat/shared/donations'

import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

const MAX_ROWS = 200
const RECENT_KEY_LIMIT = 1000

export interface DonationRow {
  key: string
  donation: DonationEvent
}

interface DonationFeed {
  rows: readonly DonationRow[]
  total: number
}

export const EMPTY_DONATION_FEED: DonationFeed = { rows: [], total: 0 }

export function createDonationFeed() {
  const store = createStore(EMPTY_DONATION_FEED)
  const seen = new Set<string>()
  const recentKeys: string[] = []
  let cursor = 0

  function receive(event: DonationEvent): void {
    const key = `donation:${event.provider}:${event.id}`
    if (seen.has(key)) return
    seen.add(key)
    const expired = recentKeys[cursor]
    if (expired !== undefined) seen.delete(expired)
    recentKeys[cursor] = key
    cursor = (cursor + 1) % RECENT_KEY_LIMIT

    const donation = {
      ...event,
      username: sanitizeDisplayText(event.username).trim() || 'Anonymous',
      message: sanitizeDisplayText(event.message).trim(),
    }
    const current = store.get()
    const index = current.rows.findLastIndex((row) => row.donation.timestamp <= event.timestamp) + 1
    const rows = current.rows.toSpliced(index, 0, { key, donation }).slice(-MAX_ROWS)
    store.set({ rows, total: current.total + 1 })
  }

  return { store, receive }
}

export const donationFeed = persistentResource('donationFeed', createDonationFeed)

declare module './persistent-resources' {
  interface PersistentResources {
    donationFeed: ReturnType<typeof createDonationFeed>
  }
}
