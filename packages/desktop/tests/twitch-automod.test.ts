import { afterEach, expect, test } from 'bun:test'

import type { NormalizedChatMessage } from '@twirchat/shared/types'

import type { DesktopApi } from '../src/gpuix/backend/api'
import { mergeAutoModTimeline, timelineRowKey } from '../src/gpuix/chat-timeline'
import { chatMessageKey } from '../src/gpuix/chat-tools'
import {
  applyTwitchAutoModEvent,
  decideTwitchAutoModMessage,
  twitchAutoModStore,
} from '../src/gpuix/state/twitch-automod'
import { parseTwitchAutoModEvent, type TwitchAutoModHold } from '../src/services/twitch-automod'

const held: TwitchAutoModHold = {
  type: 'hold',
  channelSlug: 'creator',
  messageId: 'held-message',
  displayName: 'Viewer',
  text: 'Held for review',
  timestamp: 2000,
}
const { channelSlug, messageId } = held
const queue = () => twitchAutoModStore.get().get(channelSlug)
const entry = (id = messageId) => queue()?.rows.find((row) => row.hold.messageId === id)

afterEach(() => applyTwitchAutoModEvent({ type: 'clear' }))

test('ignores holds that were already resolved or delivered', () => {
  applyTwitchAutoModEvent({ type: 'resolve', channelSlug, messageId, status: 'denied' })
  applyTwitchAutoModEvent(held)
  expect(entry()).toBeUndefined()

  applyTwitchAutoModEvent({ type: 'clear', channelSlug })
  applyTwitchAutoModEvent(held)
  applyTwitchAutoModEvent({ ...held, text: 'duplicate' })
  expect(queue()?.rows).toHaveLength(1)
  expect(entry()?.hold.text).toBe(held.text)
})

test('keeps resolved holds in place with the deciding moderator', () => {
  applyTwitchAutoModEvent({ ...held, messageId: 'later', timestamp: 3000 })
  applyTwitchAutoModEvent(held)
  applyTwitchAutoModEvent({ ...held, messageId: 'earlier', timestamp: 1000 })
  expect(queue()?.rows.map((row) => row.hold.messageId)).toEqual([
    'earlier',
    'held-message',
    'later',
  ])
  applyTwitchAutoModEvent({
    type: 'resolve',
    channelSlug,
    messageId,
    status: 'approved',
    moderatorName: 'Mod',
  })
  expect(entry()).toMatchObject({ state: 'resolved', resolution: 'approved', moderatorName: 'Mod' })
  expect(queue()?.rows).toHaveLength(3)
  expect(queue()?.total).toBe(3)
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
  expect(entry()).toMatchObject({ state: 'resolved', resolution: 'denied' })
  await decideTwitchAutoModMessage(api, { channelSlug, messageId, decision: 'approve' })
  expect(calls).toHaveLength(2)
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

test('parses hold time, category and the resolving moderator', () => {
  const base = { broadcaster_user_login: 'Creator', message_id: 'm1' }
  expect(
    parseTwitchAutoModEvent('automod.message.hold', {
      ...base,
      user_name: 'Viewer',
      message: { text: 'hi' },
      reason: 'automod',
      held_at: '2026-11-10T03:56:00.000Z',
      automod: { category: 'Swearing', level: 4 },
    }),
  ).toEqual({
    type: 'hold',
    channelSlug: 'creator',
    messageId: 'm1',
    displayName: 'Viewer',
    text: 'hi',
    timestamp: Date.parse('2026-11-10T03:56:00.000Z'),
    category: 'swearing',
  })
  const fallback = parseTwitchAutoModEvent(
    'automod.message.hold',
    { ...base, user_name: 'Viewer', message: { text: 'hi' }, held_at: 'bad', category: '<b>' },
    42,
  )
  expect(fallback).toMatchObject({ timestamp: 42 })
  expect(fallback).not.toHaveProperty('category')
  expect(
    parseTwitchAutoModEvent('automod.message.update', {
      ...base,
      status: 'Denied',
      moderator_user_name: 'Mod',
    }),
  ).toEqual({
    type: 'resolve',
    channelSlug: 'creator',
    messageId: 'm1',
    status: 'denied',
    moderatorName: 'Mod',
  })
})

test('places held messages between chat rows by hold time', () => {
  applyTwitchAutoModEvent(held)
  const rows = queue()?.rows ?? []
  const chat = [1000, 3000].map((time): NormalizedChatMessage => ({
    id: `c${time}`,
    platform: 'twitch',
    channelId: channelSlug,
    author: { id: 'a', username: 'a', displayName: 'a', badges: [] },
    text: 'chat',
    emotes: [],
    type: 'message',
    timestamp: new Date(time),
  }))
  expect(mergeAutoModTimeline(chat, rows).map(timelineRowKey)).toEqual(
    chat.map(chatMessageKey).toSpliced(1, 0, 'automod:creator:held-message'),
  )
  expect(mergeAutoModTimeline(chat, [])).toBe(chat)
})
