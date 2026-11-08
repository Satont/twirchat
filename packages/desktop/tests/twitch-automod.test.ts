import { afterEach, expect, test } from 'bun:test'

import type { DesktopApi } from '../src/gpuix/backend/api'
import {
  applyTwitchAutoModEvent,
  decideTwitchAutoModMessage,
  twitchAutoModStore,
} from '../src/gpuix/state/twitch-automod'
import type { TwitchAutoModHold } from '../src/services/twitch-automod'

const held: TwitchAutoModHold = {
  type: 'hold',
  channelSlug: 'creator',
  messageId: 'held-message',
  displayName: 'Viewer',
  text: 'Held for review',
}
const { channelSlug, messageId } = held
const entry = () => twitchAutoModStore.get().get(channelSlug)?.held.get(messageId)

afterEach(() => applyTwitchAutoModEvent({ type: 'clear' }))

test('keeps duplicate and out-of-order holds resolved without retaining their text', () => {
  const resolved = { type: 'resolve', channelSlug, messageId } satisfies Parameters<
    typeof applyTwitchAutoModEvent
  >[0]
  applyTwitchAutoModEvent(resolved)
  applyTwitchAutoModEvent(held)
  expect(entry()).toBeUndefined()

  applyTwitchAutoModEvent({ type: 'clear', channelSlug })
  applyTwitchAutoModEvent(held)
  applyTwitchAutoModEvent({ ...held, text: 'duplicate' })
  expect(entry()?.hold.text).toBe(held.text)
  applyTwitchAutoModEvent(resolved)
  expect(entry()).toBeUndefined()
})

test('serializes decisions per held message and lets a failed decision be retried', async () => {
  applyTwitchAutoModEvent(held)
  const pending = Promise.withResolvers<Awaited<ReturnType<DesktopApi['executePlatformCommand']>>>()
  const calls: string[] = []
  const api = {
    executePlatformCommand: ({ text }: { text: string }) => {
      calls.push(text)
      return calls.length === 1 ? pending.promise : Promise.resolve({})
    },
  } satisfies Pick<DesktopApi, 'executePlatformCommand'>

  const approve = decideTwitchAutoModMessage(api, { channelSlug, messageId, decision: 'approve' })
  expect(entry()?.state).toBe('deciding')
  await decideTwitchAutoModMessage(api, { channelSlug, messageId, decision: 'deny' })
  expect(calls).toEqual(['/automodallow held-message'])
  pending.reject(new Error('Try again'))
  await approve
  expect(entry()).toMatchObject({ state: 'pending', error: 'Try again' })
  await decideTwitchAutoModMessage(api, { channelSlug, messageId, decision: 'deny' })
  expect(calls).toEqual(['/automodallow held-message', '/automoddeny held-message'])
  expect(entry()).toBeUndefined()
})

test('ignores late action completion after an identity or subscription reset', async () => {
  applyTwitchAutoModEvent(held)
  const pending = Promise.withResolvers<Awaited<ReturnType<DesktopApi['executePlatformCommand']>>>()
  const approve = decideTwitchAutoModMessage(
    { executePlatformCommand: () => pending.promise },
    { channelSlug, messageId, decision: 'approve' },
  )
  applyTwitchAutoModEvent({ type: 'clear', channelSlug })
  applyTwitchAutoModEvent(held)
  pending.resolve({})
  await approve
  expect(entry()?.state).toBe('pending')
})
