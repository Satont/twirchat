import { expect, test } from 'bun:test'

import type { DonationEvent } from '@twirchat/shared/donations'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { normalizeDonation } from '../src/donations/providers'
import {
  donationSearchMessage,
  mergeDonationTimeline,
  timelineRowKey,
} from '../src/gpuix/chat-timeline'
import { compileChatSearch } from '../src/gpuix/chat-tools'
import { createDonationFeed, createSharedDonationFeeds } from '../src/gpuix/state/donation-feed'

function event(
  id: string,
  timestamp: number,
  provider: DonationEvent['provider'] = 'donationalerts',
): DonationEvent {
  return {
    id,
    provider,
    username: 'Viewer',
    amount: '123.45',
    currency: 'RUB',
    message: 'Good stream!',
    timestamp,
  }
}

function message(id: string, timestamp: number): NormalizedChatMessage {
  return {
    id,
    platform: 'twitch',
    channelId: 'channel',
    author: { id: 'viewer', username: 'viewer', displayName: 'Viewer', badges: [] },
    type: 'message',
    text: 'Hello',
    emotes: [],
    timestamp: new Date(timestamp),
  }
}

test('keeps the chat snapshot by identity without donations and merges late donations in order', () => {
  const chat = [message('before', 100), message('tied', 200), message('after', 300)]
  const feed = createDonationFeed()
  expect(mergeDonationTimeline(chat, feed.store.get().rows)).toBe(chat)

  feed.receive(event('tied', 200))
  feed.receive(event('late', 150))
  feed.receive(event('last', 350, 'memealerts'))
  const { rows } = feed.store.get()
  expect(mergeDonationTimeline([], rows)).toBe(rows)
  expect(mergeDonationTimeline(chat, rows).map(timelineRowKey)).toEqual([
    'twitch:channel:before',
    'donation:donationalerts:late',
    'twitch:channel:tied',
    'donation:donationalerts:tied',
    'twitch:channel:after',
    'donation:memealerts:last',
  ])
})

test('lets later chat messages push a future-dated provider donation up', () => {
  const feed = createDonationFeed()
  const donation = normalizeDonation(
    'donationalerts',
    {
      id: 1,
      username: 'Viewer',
      amount: '123',
      currency: 'RUB',
      message: 'qwe',
      created_at: '2099-01-01 12:00:00',
    },
    200,
  )
  if (!donation) throw new Error('Expected a donation')
  feed.receive(donation)
  const chat = [message('before', 100), message('after', 300)]
  expect(mergeDonationTimeline(chat, feed.store.get().rows).map(timelineRowKey)).toEqual([
    'twitch:channel:before',
    'donation:donationalerts:1',
    'twitch:channel:after',
  ])
})

test('deduplicates provider events, bounds retention and keeps a paused snapshot immutable', () => {
  const feed = createDonationFeed()
  feed.receive(event('shared', 0))
  const original = feed.store.get()
  feed.receive(event('shared', 1))
  expect(feed.store.get()).toBe(original)
  feed.receive(event('shared', 1, 'donatepay'))
  expect(feed.store.get().total).toBe(2)

  for (let index = 2; index < 250; index++) feed.receive(event(`event-${index}`, index))
  expect(feed.store.get().rows).toHaveLength(200)
  expect(feed.store.get().rows[0]?.donation.id).toBe('event-50')
  feed.receive(event('shared', 251))
  expect(feed.store.get().total).toBe(250)
  expect(original.rows).toHaveLength(1)
  expect(original.rows[0]?.donation.timestamp).toBe(0)
})

test('treats donations as searchable events with provider, donor and amount', () => {
  const feed = createDonationFeed()
  feed.receive(event('1', 100, 'donatepay'))
  const [row] = feed.store.get().rows
  if (!row) throw new Error('Expected a donation row')
  const searchable = donationSearchMessage(row)
  expect(
    compileChatSearch('is:donation platform:donatepay from:viewer 123.45 RUB').matches(
      searchable,
      {},
    ),
  ).toBe(true)
  expect(compileChatSearch('platform:twitch').matches(searchable, {})).toBe(false)
})

test('keeps shared donations per watched chat, deduplicated and bounded by chat count', () => {
  const feeds = createSharedDonationFeeds()
  feeds.receive({ channelKey: 'twitch:a', donation: event('1', 10) })
  feeds.receive({ channelKey: 'twitch:a', donation: event('1', 10) })
  feeds.receive({ channelKey: 'kick:b', donation: event('1', 10) })
  const first = feeds.store.get()
  expect(first.get('twitch:a')?.rows.map((row) => row.key)).toEqual(['donation:donationalerts:1'])
  expect(first.get('kick:b')?.total).toBe(1)

  for (let index = 0; index < 200; index++)
    feeds.receive({ channelKey: `twitch:c${index}`, donation: event('x', index) })
  const feedsAfter = feeds.store.get()
  expect(feedsAfter.size).toBe(200)
  expect(feedsAfter.has('twitch:a')).toBe(false)
  expect(feedsAfter.has('kick:b')).toBe(false)
  expect(first.get('twitch:a')?.total).toBe(1)
})
