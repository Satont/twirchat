import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Platform } from '@twirchat/shared/types'
import { createYouTubeGrpcSession } from '@twirchat/shared/youtube'
import { z } from 'zod'

import { refreshKickToken } from '../src/auth/kick'
import { refreshTwitchToken } from '../src/auth/twitch'
import {
  requestTwitchActivitiesSnapshot,
  subscribeTwitchActivities,
} from '../src/gpuix/backend/api'
import { KickAdapter, type KickSocket } from '../src/platforms/kick/adapter'
import { kickRetryClock } from '../src/platforms/kick/retry'
import { TwitchAdapter } from '../src/platforms/twitch/adapter'
import { YouTubeAdapter } from '../src/platforms/youtube/adapter'
import { createAccountSessions } from '../src/services/account-sessions'
import { AccountStore } from '../src/store/account-store'
import { getDb, initDb } from '../src/store/db'
import {
  createAccountTwitchWebSessionStore,
  createTwitchWebSessionStore,
  TwitchWebSessionStore,
} from '../src/store/twitch-web-session-store'
import { WatchedChannelStore } from '../src/store/watched-channels-store'
import { literal, required } from './fixture-values'

let directory = ''
let path = ''
const originalFetch = globalThis.fetch
const oauthEnvironment = {
  TWIRCHAT_TWITCH_CLIENT_ID: 'public-client',
  TWIRCHAT_YOUTUBE_CLIENT_ID: 'installed-client',
  TWIRCHAT_YOUTUBE_CLIENT_SECRET: 'installed-secret',
}
const savedOAuthEnvironment = Object.entries(oauthEnvironment).map(([key]) => [
  key,
  process.env[key],
])
beforeEach(() => {
  Object.assign(process.env, oauthEnvironment)
  directory = mkdtempSync(join(tmpdir(), 'twirchat-multi-account-'))
  path = join(directory, 'db.sqlite')
  initDb(path)
})
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of savedOAuthEnvironment) {
    if (key === undefined) continue
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})
function save(platform: Platform, id: string, activate = true, expiresAt = 4_000_000_000) {
  AccountStore.upsert({
    id: `${platform}:${id}`,
    platform,
    platformUserId: id,
    username: `user${id}`,
    displayName: `User ${id}`,
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAt,
    activate,
  })
  return required(AccountStore.findById(`${platform}:${id}`))
}
function gate<T>() {
  const { promise, resolve } = Promise.withResolvers<T>()
  return { promise, resolve }
}

describe('saved and active accounts', () => {
  test('successive OAuth selections preserve both identities and encrypted tokens across restart', () => {
    const first = save('twitch', '1')
    const second = save('twitch', '2')
    expect(
      AccountStore.findAllSaved()
        .map((account) => account.id)
        .sort(),
    ).toEqual([first.id, second.id])
    expect(AccountStore.findAllActive().map((account) => account.id)).toEqual([second.id])
    const raw = required(
      getDb()
        .query<{ access_token: string }, [string]>('SELECT access_token FROM accounts WHERE id = ?')
        .get(first.id),
    ).access_token
    expect(raw).not.toBe('token-1')
    getDb().close()
    initDb(path)
    expect(AccountStore.findByPlatform('twitch')?.id).toBe(second.id)
    expect(AccountStore.getTokens(first.id)?.accessToken).toBe('token-1')
    expect(
      required(
        getDb()
          .query<{ access_token: string }, [string]>(
            'SELECT access_token FROM accounts WHERE id = ?',
          )
          .get(first.id),
      ).access_token,
    ).toBe(raw)
  })

  test('anonymous remains anonymous after restart, token refresh and saving another inactive identity', () => {
    const first = save('twitch', '1')
    AccountStore.setActive('twitch', null)
    AccountStore.updateTokens(first.id, 'refreshed-old-user')
    save('twitch', '2', false)
    getDb().close()
    initDb(path)
    expect(AccountStore.findByPlatform('twitch')).toBeNull()
    expect(AccountStore.findAllSaved()).toHaveLength(2)
    expect(AccountStore.getTokens(first.id)?.accessToken).toBe('refreshed-old-user')
  })

  test('migrates legacy rows once, deterministically, without touching credential bytes', () => {
    save('twitch', '1')
    save('twitch', '2')
    getDb().run('DROP TABLE active_accounts')
    getDb().run("UPDATE accounts SET updated_at = CASE WHEN id='twitch:1' THEN 20 ELSE 10 END")
    getDb().close()
    initDb(path)
    expect(AccountStore.findByPlatform('twitch')?.id).toBe('twitch:1')
    AccountStore.setActive('twitch', null)
    getDb().close()
    initDb(path)
    expect(AccountStore.findByPlatform('twitch')).toBeNull()
  })

  test('rejects cross-platform selections and deleting an active account leaves an explicit anonymous selection', () => {
    const twitch = save('twitch', '1')
    const kick = save('kick', '2')
    expect(() => AccountStore.setActive('twitch', kick.id)).toThrow('platform')
    expect(AccountStore.findByPlatform('twitch')?.id).toBe(twitch.id)
    AccountStore.delete(twitch.id)
    expect(AccountStore.findByPlatform('twitch')).toBeNull()
    getDb().close()
    initDb(path)
    expect(AccountStore.findByPlatform('twitch')).toBeNull()
    expect(AccountStore.findByPlatform('kick')?.id).toBe(kick.id)
  })
})

describe('account session transitions', () => {
  function fixture(disconnect: (platform: Platform) => Promise<void> = async () => {}) {
    const calls: string[] = []
    const watched = [{ id: 'watched', messages: ['retained'], layout: { id: 'pane' } }]
    const controller = createAccountSessions({
      find: (id) => AccountStore.findById(id),
      active: (platform) => AccountStore.findByPlatform(platform),
      select: (platform, id) => {
        calls.push(`select:${id}`)
        return AccountStore.setActive(platform, id)
      },
      remove: (id) => {
        calls.push(`remove:${id}`)
        AccountStore.delete(id)
      },
      disconnect: async (platform) => {
        calls.push(`disconnect:${platform}`)
        await disconnect(platform)
      },
      refreshIdentity: (platform) => {
        calls.push(`identity:${platform}`)
      },
      connectOwn: async (_platform, account) => {
        calls.push(`own:${account?.username ?? 'anonymous'}`)
      },
      reconnectWatched: async (platform) => {
        calls.push(`watched:${platform}`)
      },
      changed: (platform, identityChanged) => {
        calls.push(`changed:${platform}:${identityChanged}`)
      },
    })
    return { controller, calls, watched }
  }
  test('switches serialize per platform and preserve watched objects and buffers', async () => {
    const first = save('twitch', '1'),
      second = save('twitch', '2')
    AccountStore.setActive('twitch', first.id)
    const delayed = gate<void>()
    let transitions = 0
    const { controller, calls, watched } = fixture(async () => {
      if (++transitions === 1) await delayed.promise
    })
    const retained = watched[0]
    const a = controller.select('twitch', second.id)
    const b = controller.select('twitch', first.id)
    await Bun.sleep(1)
    expect(calls).toEqual(['disconnect:twitch'])
    delayed.resolve()
    await Promise.all([a, b])
    expect(AccountStore.findByPlatform('twitch')?.id).toBe(first.id)
    expect(calls.filter((call) => call.startsWith('own:'))).toEqual(['own:user2', 'own:user1'])
    expect(watched[0]).toBe(retained)
    expect(watched[0]?.messages).toEqual(['retained'])
  })
  test('forgetting an inactive identity does not disconnect or reconnect the active account', async () => {
    const first = save('twitch', '1'),
      second = save('twitch', '2')
    const { controller, calls } = fixture()
    await controller.forget(first.id)
    expect(calls).toEqual([`remove:${first.id}`, 'changed:twitch:false'])
    expect(AccountStore.findByPlatform('twitch')?.id).toBe(second.id)
  })
  test('an OAuth selection queued during another switch wins with its exact saved identity', async () => {
    const first = save('twitch', '1'),
      second = save('twitch', '2', false),
      third = save('twitch', '3', false)
    const delayed = gate<void>()
    let transitions = 0
    const { controller } = fixture(async () => {
      if (++transitions === 1) await delayed.promise
    })
    const pending = controller.select('twitch', second.id)
    await Bun.sleep(1)
    AccountStore.setActive('twitch', third.id)
    const oauth = controller.select('twitch', third.id, true)
    delayed.resolve()
    await Promise.all([pending, oauth])
    expect(AccountStore.findByPlatform('twitch')?.id).toBe(third.id)
    expect(
      AccountStore.findAllSaved()
        .map((account) => account.id)
        .sort(),
    ).toEqual([first.id, second.id, third.id])
  })
  test('forgetting the active identity becomes anonymous and preserves other saved accounts', async () => {
    const first = save('twitch', '1'),
      second = save('twitch', '2')
    const { controller, calls } = fixture()
    await controller.forget(second.id)
    expect(AccountStore.findByPlatform('twitch')).toBeNull()
    expect(AccountStore.findAllSaved().map((account) => account.id)).toEqual([first.id])
    expect(calls).toContain('own:anonymous')
    expect(calls).toContain('watched:twitch')
  })

  test('queued session invalidation preserves credentials replaced by a fresh sign-in', async () => {
    const active = save('twitch', '1')
    const expired = save('twitch', '2', false)
    const delayed = gate<void>()
    const { controller } = fixture(() => delayed.promise)
    const previousToken = AccountStore.getTokens(expired.id)?.accessToken
    const switchAccount = controller.select('twitch', null)
    const invalidation = controller.forget(
      expired.id,
      () => AccountStore.getTokens(expired.id)?.accessToken === previousToken,
    )
    AccountStore.updateTokens(expired.id, 'replacement-token', 'replacement-refresh')
    delayed.resolve()
    await Promise.all([switchAccount, invalidation])
    expect(AccountStore.findById(active.id)).not.toBeNull()
    expect(AccountStore.getTokens(expired.id)?.accessToken).toBe('replacement-token')
  })
})

describe('account-scoped Twitch web sessions', () => {
  test('migrates legacy ciphertext to its real identity and cannot cross account switches', async () => {
    let active: string | null = '1'
    const values = new Map<string, string>()
    const legacy = createTwitchWebSessionStore({
      read: () => values.get('secret:twitch-web-session') ?? null,
      write: (value) => {
        values.set('secret:twitch-web-session', value)
      },
      remove: () => values.delete('secret:twitch-web-session'),
    })
    const first = { token: 'secret-1', userId: '1', username: 'one', clientId: 'client' }
    await legacy.set(first)
    const ciphertext = required(values.get('secret:twitch-web-session'))
    const store = createAccountTwitchWebSessionStore({
      activeUserId: () => active,
      read: (key) => values.get(key) ?? null,
      write: (key, value) => {
        values.set(key, value)
      },
      remove: (key) => {
        values.delete(key)
      },
    })
    expect(await store.get()).toEqual(first)
    expect(values.get('secret:twitch-web-session:1')).toBe(ciphertext)
    expect(values.has('secret:twitch-web-session')).toBe(false)
    active = '2'
    expect(await store.get()).toBeNull()
    await expect(store.set(first)).rejects.toThrow('matching')
    await store.set({ ...first, token: 'secret-2', userId: '2', username: 'two' })
    expect(await store.status()).toEqual({ configured: true, userId: '2', username: 'two' })
    active = null
    expect(await store.get()).toBeNull()
    active = '1'
    expect(await store.get()).toEqual(first)
    await store.clear()
    active = '2'
    expect((await store.get())?.token).toBe('secret-2')
  })
  test('an asynchronous web-session read cannot return the former identity after a switch', async () => {
    let active = '1'
    const values = new Map<string, string>()
    const store = createAccountTwitchWebSessionStore({
      activeUserId: () => active,
      read: (key) => values.get(key) ?? null,
      write: (key, value) => {
        values.set(key, value)
      },
      remove: (key) => {
        values.delete(key)
      },
    })
    await store.set({ token: 'secret-1', userId: '1', username: 'one', clientId: 'client' })
    const old = store.get()
    active = '2'
    expect(await old).toBeNull()
    expect(await store.status()).toEqual({ configured: false })
  })
  test('an old account activity response is rejected after the active identity changes', async () => {
    save('twitch', '1')
    const second = save('twitch', '2', false)
    const lookupStarted = gate<void>()
    const delayed = gate<Response>()
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.pathname === '/oauth2/validate')
          return Response.json({
            client_id: 'public-client',
            user_id: '1',
            login: 'user1',
            expires_in: 3600,
            scopes: [],
          })
        expect(url.origin + url.pathname).toBe('https://api.twitch.tv/helix/users')
        lookupStarted.resolve()
        return delayed.promise
      },
      { preconnect: fetch.preconnect },
    )
    const pending = requestTwitchActivitiesSnapshot({ channelSlug: 'channel', sections: [] })
    await lookupStarted.promise
    AccountStore.setActive('twitch', second.id)
    delayed.resolve(Response.json({ data: [{ id: '100' }] }))
    await expect(pending).rejects.toThrow('account changed')
  })

  test('EventSub uses the chosen account without sending the default web session', async () => {
    save('twitch', '1')
    const chosen = save('twitch', '2', false, 1)
    await TwitchWebSessionStore.set({
      token: 'secret',
      userId: '1',
      username: 'user1',
      clientId: 'client',
    })
    const delayedRefresh = gate<Response>()
    let refreshCount = 0
    const requests: unknown[] = []
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        const headers = new Headers(init?.headers)
        if (url.origin === 'https://id.twitch.tv') {
          if (url.pathname === '/oauth2/token') {
            refreshCount++
            expect(init?.body?.toString()).toBe(
              'client_id=public-client&grant_type=refresh_token&refresh_token=refresh-2',
            )
            return delayedRefresh.promise
          }
          expect(url.pathname).toBe('/oauth2/validate')
          expect(headers.get('Authorization')).toBe('OAuth fresh-activity')
          return Response.json({
            client_id: 'public-client',
            user_id: '2',
            login: 'user2',
            expires_in: 3600,
            scopes: [],
          })
        }
        expect(url.origin).toBe('https://api.twitch.tv')
        expect(headers.get('Authorization')).toBe('Bearer fresh-activity')
        expect(headers.get('Client-Id')).toBe('public-client')
        if (url.pathname === '/helix/users') return Response.json({ data: [{ id: '100' }] })
        expect(url.pathname).toBe('/helix/eventsub/subscriptions')
        requests.push(JSON.parse(z.string().parse(init?.body)))
        return Response.json({ data: [{ id: String(requests.length) }] })
      },
      { preconnect: fetch.preconnect },
    )

    const pending = Promise.all([
      subscribeTwitchActivities(chosen.id, 'session', 'channel'),
      refreshTwitchToken(chosen.id),
    ])
    expect(refreshCount).toBe(1)
    delayedRefresh.resolve(
      Response.json({ access_token: 'fresh-activity', refresh_token: 'rotated', expires_in: 3600 }),
    )
    const [subscriptionResult, accessToken] = await pending
    expect(accessToken).toBe('fresh-activity')
    expect(subscriptionResult.errors).toEqual([])
    expect(requests).toEqual(
      ['stream.online', 'stream.offline'].map((type) => ({
        type,
        version: '1',
        condition: { broadcaster_user_id: '100' },
        transport: { method: 'websocket', session_id: 'session' },
      })),
    )
    expect(AccountStore.getTokens(chosen.id)?.refreshToken).toBe('rotated')
    expect(AccountStore.getTokens('twitch:1')?.accessToken).toBe('token-1')
  })
})

function kickIdentityAdapter(): KickAdapter {
  return new KickAdapter({
    account: () => AccountStore.findByPlatform('kick'),
    tokens: (id) => AccountStore.getTokens(id),
    refreshToken: refreshKickToken,
    chatroom: async () => ({ chatroomId: 1, broadcasterUserId: 1 }),
    discover: async () => 'wss://realtime.fixture.invalid/connection/websocket',
    token: async () => 'guest-token',
    socket() {
      const events = new EventEmitter()
      const socket: KickSocket = {
        addEventListener(event, listener) {
          events.on(event, listener)
        },
        send(data) {
          const command: unknown = JSON.parse(data)
          const parsed = z
            .object({
              id: z.number(),
              connect: z.unknown().optional(),
              subscribe: z.unknown().optional(),
            })
            .parse(command)
          if (parsed.id === 1)
            events.emit('message', { data: JSON.stringify({ id: 1, connect: {} }) })
          if (parsed.id === 2)
            events.emit('message', { data: JSON.stringify({ id: 2, subscribe: {} }) })
        },
        close() {
          events.removeAllListeners()
        },
      }
      queueMicrotask(() => events.emit('open', {}))
      return socket
    },
    send: async () => {
      throw new Error('This identity fixture must not send chat messages.')
    },
    clock: kickRetryClock,
  })
}

describe('adapter identity changes', () => {
  for (const platform of literal(['twitch', 'kick', 'youtube'])) {
    test(`${platform} ignores an old token refresh after switching accounts`, async () => {
      const old = save(platform, '1', true, 1)
      const selected = save(platform, '2', false)
      const delayed = gate<Response>()
      globalThis.fetch = Object.assign(() => delayed.promise, { preconnect: fetch.preconnect })
      const adapter =
        platform === 'twitch'
          ? new TwitchAdapter()
          : platform === 'kick'
            ? kickIdentityAdapter()
            : new YouTubeAdapter({
                resolveLiveChat: async () => ({
                  channelId: 'UCfixture',
                  videoId: 'video',
                  liveChatId: 'chat',
                }),
                createSession: () => ({
                  start: async () => {},
                  stop: () => {},
                  getResumeToken: () => undefined,
                }),
              })
      // Replace transport setup only; real account and refresh code still runs.
      if (platform === 'twitch')
        Object.assign(adapter, { fetchBadges: async () => {}, connectChatClient: async () => {} })
      if (platform === 'youtube')
        Object.assign(adapter, {
          resolveChannelId: async () => 'UCfixture',
          tryConnect: async () => {},
        })
      const internals = () =>
        z
          .object({ accountId: z.string().nullable(), accessToken: z.string().nullable() })
          .parse(adapter)
      const pending = adapter.connect('first')
      const kickRefresh =
        platform === 'kick'
          ? refreshKickToken(old.id).then(
              () => undefined,
              (error: unknown) => error,
            )
          : undefined
      await Bun.sleep(1)
      await adapter.disconnect()
      AccountStore.setActive(platform, selected.id)
      await adapter.connect('second')
      delayed.resolve(
        Response.json(
          platform === 'kick'
            ? { accessToken: 'late-old-token', refreshToken: 'late-refresh', expiresIn: 3600 }
            : { access_token: 'late-old-token', refresh_token: 'late-refresh', expires_in: 3600 },
        ),
      )
      await pending
      if (kickRefresh) expect(await kickRefresh).toBeInstanceOf(Error)
      expect(internals().accountId).toBe(selected.id)
      expect(internals().accessToken).toBe('token-2')
      expect(AccountStore.findByPlatform(platform)?.id).toBe(selected.id)
      expect(AccountStore.getTokens(old.id)?.accessToken).toBe(
        platform === 'kick' ? 'token-1' : 'late-old-token',
      )
      await adapter.disconnect()
    })
  }
  test('Kick and YouTube drop old credentials when reconnecting anonymously', async () => {
    for (const platform of literal(['kick', 'youtube'])) {
      save(platform, '1')
      const adapter =
        platform === 'kick'
          ? kickIdentityAdapter()
          : new YouTubeAdapter({
              resolveLiveChat: async () => ({
                channelId: 'UCfixture',
                videoId: 'video',
                liveChatId: 'chat',
              }),
              createSession: () => ({
                start: async () => {},
                stop: () => {},
                getResumeToken: () => undefined,
              }),
            })
      if (platform === 'youtube')
        Object.assign(adapter, {
          resolveChannelId: async () => 'UCfixture',
          tryConnect: async () => {},
        })
      await adapter.connect('watched')
      AccountStore.setActive(platform, null)
      await adapter.disconnect()
      await adapter.connect('watched')
      const internals = () =>
        z
          .object({ accountId: z.string().nullable(), accessToken: z.string().nullable() })
          .parse(adapter)
      expect(internals().accountId).toBeNull()
      expect(internals().accessToken).toBeNull()
      await adapter.disconnect()
    }
  })
})

test('YouTube OAuth streams after discovery and rejects stale callbacks on switch', async () => {
  save('youtube', 'first')
  const streams: Parameters<typeof createYouTubeGrpcSession>[0][] = []
  let stopped = 0
  const adapter = new YouTubeAdapter({
    resolveLiveChat: async () => ({ channelId: 'UCfixture', videoId: 'video', liveChatId: 'chat' }),
    createSession: (options) => {
      streams.push(options)
      return {
        start: async () => {},
        stop: () => {
          stopped++
        },
        getResumeToken: () => undefined,
      }
    },
  })
  const received: string[] = []
  const statuses: string[] = []
  adapter.on('message', (message) => received.push(message.text))
  adapter.on('status', (statusInfo) => statuses.push(statusInfo.status))
  await adapter.connect('first')
  expect(statuses).not.toContain('connected')
  const raw = {
    items: [{ id: 'message', snippet: { type: 1, textMessageDetails: { messageText: 'first' } } }],
    nextPageToken: 'resume',
  }
  required(streams[0]).onBatch(raw)
  save('youtube', 'second')
  required(streams[0]).onBatch({
    items: [{ id: 'old', snippet: { type: 1, textMessageDetails: { messageText: 'stale' } } }],
  })
  await adapter.connect('second')
  expect(stopped).toBe(1)
  required(streams[0]).onStatus('connected')
  required(streams[1]).onStatus('connected')
  expect(received).toEqual(['first'])
  expect(statuses.filter((value) => value === 'connected')).toHaveLength(1)
  await adapter.disconnect()
})

test('watched YouTube channel ids preserve exact case through persistence and removal', () => {
  const id = 'UCAbCdEfGhIjKlMnOpQrStUv'
  const channel = WatchedChannelStore.upsert('youtube', id, 'Fixture')
  const other = WatchedChannelStore.upsert(
    'youtube',
    'UCabCdEfGhIjKlMnOpQrStUv',
    'Different channel',
  )
  expect(other.id).not.toBe(channel.id)
  expect(WatchedChannelStore.findAll()).toHaveLength(2)
  expect(channel.channelSlug).toBe(id)
  expect(WatchedChannelStore.findById(channel.id)?.channelSlug).toBe(id)
  WatchedChannelStore.removeByPlatformAndSlug('youtube', id)
  expect(WatchedChannelStore.findById(channel.id)).toBeNull()
})
