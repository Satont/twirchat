import { afterEach, expect, test } from 'bun:test'

import type { TwitchActivitiesSnapshot } from '@twirchat/shared/twitch-activities'

import { createDesktopEvents } from '../src/gpuix/backend/events'
import {
  lastWhisperRecipientStore,
  loadTwitchActivities,
  twitchActivitiesStore,
  twitchActivityCapabilitiesStore,
  whispersStore,
  wireTwitchActivities,
} from '../src/gpuix/state/twitch-activities'

const previous = {
  activities: twitchActivitiesStore.get(),
  capabilities: twitchActivityCapabilitiesStore.get(),
  whispers: whispersStore.get(),
  recipient: lastWhisperRecipientStore.get(),
}
const stops: Array<() => void> = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  twitchActivitiesStore.set(previous.activities)
  twitchActivityCapabilitiesStore.set(previous.capabilities)
  whispersStore.set(previous.whispers)
  lastWhisperRecipientStore.set(previous.recipient)
})
function snapshot(pointsBalance: number): TwitchActivitiesSnapshot {
  return {
    channelId: '1',
    channelSlug: 'channel',
    polls: [],
    predictions: [],
    rewards: [],
    pinnedMessage: null,
    pointsBalance,
    errors: {},
  }
}
function fixture(request: () => Promise<TwitchActivitiesSnapshot>) {
  const events = createDesktopEvents()
  const backend: Parameters<typeof wireTwitchActivities>[0] = {
    events,
    api: { getTwitchActivities: request },
  }
  stops.push(wireTwitchActivities(backend))
  return backend
}
test('switching identity clears private activity state but forgetting an inactive account does not', () => {
  const backend = fixture(async () => snapshot(0))
  twitchActivitiesStore.set(
    new Map([['channel', { snapshot: snapshot(7), loading: false, error: null }]]),
  )
  twitchActivityCapabilitiesStore.set(
    new Map([
      [
        'channel',
        { channelSlug: 'channel', mode: 'snapshot', snapshotSections: ['pointsBalance'] },
      ],
    ]),
  )
  whispersStore.set([
    {
      id: 'whisper',
      fromUserId: '1',
      fromLogin: 'sender',
      fromDisplayName: 'Sender',
      toUserId: '2',
      text: 'private',
      at: new Date().toISOString(),
    },
  ])
  lastWhisperRecipientStore.set('sender')
  backend.events.emit('accounts_changed', { platform: 'twitch', identityChanged: false })
  expect(whispersStore.get()).toHaveLength(1)
  expect(twitchActivitiesStore.get().size).toBe(1)
  backend.events.emit('accounts_changed', { platform: 'twitch', identityChanged: true })
  expect(whispersStore.get()).toEqual([])
  expect(lastWhisperRecipientStore.get()).toBeNull()
  expect(twitchActivitiesStore.get().size).toBe(0)
  expect(twitchActivityCapabilitiesStore.get().size).toBe(0)
})
test('an old account snapshot cannot repopulate state or delete the new account pending request', async () => {
  const { promise: old, resolve: oldDone } = Promise.withResolvers<TwitchActivitiesSnapshot>()
  const { promise: current, resolve: newDone } = Promise.withResolvers<TwitchActivitiesSnapshot>()
  let requests = 0
  const backend = fixture(() => (++requests === 1 ? old : current))
  const first = loadTwitchActivities(backend, 'channel')
  backend.events.emit('accounts_changed', { platform: 'twitch', identityChanged: true })
  const second = loadTwitchActivities(backend, 'channel')
  oldDone(snapshot(1))
  await first
  expect(twitchActivitiesStore.get().get('channel')?.snapshot).toBeNull()
  expect(loadTwitchActivities(backend, 'channel')).toBe(second)
  expect(requests).toBe(2)
  newDone(snapshot(2))
  await second
  expect(twitchActivitiesStore.get().get('channel')?.snapshot?.pointsBalance).toBe(2)
})
