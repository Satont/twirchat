import { expect, test } from 'bun:test'

import type { DesktopToBackendMessage } from '@twirchat/shared'
import type { DonationEvent, DonationShareChannel } from '@twirchat/shared/donations'

import { createDonationShareClient } from '../src/donations/share-client'

const donation: DonationEvent = {
  id: '1',
  provider: 'donatepay',
  username: 'Donor',
  amount: '10',
  currency: 'RUB',
  message: '',
  timestamp: 1,
}

interface ClientState {
  connected: boolean
  watched: DonationShareChannel[]
}

function setup() {
  const sent: DesktopToBackendMessage[] = []
  const state: ClientState = {
    connected: true,
    watched: [{ platform: 'twitch', channel: 'streamer' }],
  }
  const client = createDonationShareClient({
    send: (message) => sent.push(message),
    isConnected: () => state.connected,
    identities: () => [{ platform: 'twitch', accessToken: 'token' }],
    watched: () => state.watched,
  })
  return { client, sent, state }
}

test('sends ownership proof only while sharing is on and forwards donations', () => {
  const { client, sent } = setup()
  client.share(donation)
  expect(sent).toHaveLength(0)
  client.setEnabled(true)
  client.setEnabled(true)
  client.share(donation)
  client.setEnabled(false)
  expect(sent).toEqual([
    {
      type: 'donation_share_identities',
      identities: [{ platform: 'twitch', accessToken: 'token' }],
    },
    { type: 'donation_share', donation },
    { type: 'donation_share_identities', identities: [] },
  ])
})

test('replays identities and watched chats for each new backend session', () => {
  const { client, sent, state } = setup()
  state.connected = false
  client.setEnabled(true)
  client.syncWatched()
  client.share(donation)
  expect(sent).toHaveLength(0)
  state.connected = true
  client.connected()
  client.syncWatched()
  expect(sent.map((message) => message.type)).toEqual([
    'donation_share_identities',
    'donation_watch',
  ])
  state.watched = []
  client.syncWatched()
  expect(sent.at(-1)).toEqual({ type: 'donation_watch', channels: [] })
})

test('does not send an empty identity list to a fresh session while sharing is off', () => {
  const { client, sent } = setup()
  client.connected()
  expect(sent.map((message) => message.type)).toEqual(['donation_watch'])
})
