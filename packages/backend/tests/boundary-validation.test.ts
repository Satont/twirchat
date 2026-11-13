import { afterEach, expect, test } from 'bun:test'

import { exchangeKickCode } from '../src/auth/kick'
import { authRoutes } from '../src/routes/auth'
import { getEmoteSetById, getUserByConnection } from '../src/seventv/client'
import { isSevenTvEventEmoteValue } from '../src/seventv/emote'
import { sevenTVEventSchema } from '../src/seventv/event-schemas'
import { desktopMessageSchema } from '../src/ws/message-schema'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('the backend exposes only Kick and Twitch account authorization', () => {
  expect(Object.keys(authRoutes).sort()).toEqual([
    '/api/auth/kick/exchange',
    '/api/auth/kick/legacy-start',
    '/api/auth/kick/refresh',
    '/api/auth/kick/start',
    '/api/auth/twitch/exchange',
    '/api/auth/twitch/refresh',
    '/api/auth/twitch/start',
    '/auth/kick/callback',
  ])
  expect(
    desktopMessageSchema.safeParse({
      type: 'auth_start_twitch',
      codeChallenge: 'challenge',
      state: 'state',
    }).success,
  ).toBe(false)
})

test('OAuth request boundaries reject malformed JSON and wrong field types before exchange', async () => {
  let calls = 0
  globalThis.fetch = Object.assign(
    async () => {
      calls++
      throw new Error('Invalid requests must not reach the token endpoint.')
    },
    { preconnect: originalFetch.preconnect },
  )
  for (const route of [
    authRoutes['/api/auth/kick/exchange'],
    authRoutes['/api/auth/twitch/exchange'],
  ]) {
    for (const body of ['{', 'null', '{"code":42,"codeVerifier":"v","redirectUri":"r"}']) {
      const response = await route.POST(
        new Request('http://local/exchange', { method: 'POST', body }),
      )
      expect(response.status).toBe(400)
    }
  }
  expect(calls).toBe(0)
})

test('OAuth token responses require actual string credentials rather than a claimed type', async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ access_token: 42 }), {
    preconnect: originalFetch.preconnect,
  })
  await expect(exchangeKickCode('code', 'verifier', 'http://local/callback')).rejects.toThrow()
})

test('7TV events verify nested image files and retain typed event variants', () => {
  const value = {
    id: 'emote',
    name: 'Alias',
    data: {
      animated: false,
      host: { url: '//cdn.7tv.app', files: [{ name: '1x.webp', width: 32 }] },
    },
  }
  expect(isSevenTvEventEmoteValue(value)).toBe(true)
  expect(
    isSevenTvEventEmoteValue({
      ...value,
      data: { ...value.data, host: { ...value.data.host, files: [{ name: 42 }] } },
    }),
  ).toBe(false)
  expect(
    sevenTVEventSchema.safeParse({
      type: 'emote_set.update',
      body: { id: 'set', pushed: [{ key: 'emotes', type: 'emote', index: 0, value }] },
    }).success,
  ).toBe(true)
  expect(
    sevenTVEventSchema.safeParse({
      type: 'emote_set.update',
      body: { id: 'set', pushed: [{ key: 'emotes', type: 'emote', index: 0, value: null }] },
    }).success,
  ).toBe(false)
})

test('GraphQL nullable lookups represent a missing user or emote set without inventing data', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({ data: { users: { userByConnection: null }, emoteSets: { emoteSet: null } } }),
    { preconnect: originalFetch.preconnect },
  )
  expect((await getUserByConnection('TWITCH', '42')).users.userByConnection).toBeNull()
  expect((await getEmoteSetById('set')).emoteSets.emoteSet).toBeNull()
})

test('desktop protocol validates branch-specific fields and permits unknown future fields', () => {
  expect(
    desktopMessageSchema.safeParse({
      type: 'seventv_resubscribe',
      subscriptions: [{ platform: 'twitch', channelId: 42 }],
    }).success,
  ).toBe(false)
  expect(
    desktopMessageSchema.safeParse({
      type: 'youtube_chat_subscribe',
      subscriptionId: 'one',
      channelId: 'channel',
      videoId: 42,
    }).success,
  ).toBe(false)
  expect(desktopMessageSchema.parse({ type: 'ping', futureField: true })).toEqual({ type: 'ping' })
})
