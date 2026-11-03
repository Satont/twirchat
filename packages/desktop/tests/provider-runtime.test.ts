import { afterEach, expect, test } from 'bun:test'

import type { EmoteCatalogEntry } from '@twirchat/shared/protocol'
import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'

import { createEmoteProviderService } from '../src/services/emote-providers'
import {
  DEFAULT_EMOTE_PREFERENCES,
  authorEmoteCatalog,
  enrichProviderEmotes,
  type EmotePreferences,
} from '../src/services/provider-emotes'
import { ProviderRuntime, type ProviderRuntimeDependencies } from '../src/services/provider-runtime'
import { literal } from './fixture-values'

const runtimes: ProviderRuntime[] = []
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop()
})
const emote = (
  alias: string,
  provider: EmoteCatalogEntry['provider'] = 'bttv',
): EmoteCatalogEntry => ({
  id: alias,
  alias,
  name: alias,
  provider,
  source: provider === 'twitch' ? 'channel' : (provider ?? 'channel'),
  imageUrl: `https://example.test/${alias}.webp`,
  aspectRatio: 1,
  animated: true,
  zeroWidth: false,
})
const account: Account = {
  id: 'account',
  platform: 'twitch',
  platformUserId: '7',
  username: 'owner',
  displayName: 'Owner',
  scopes: [],
  createdAt: 0,
  updatedAt: 0,
}
const message = (channelId = 'viewer'): NormalizedChatMessage => ({
  id: 'message',
  platform: 'twitch',
  channelId,
  text: '😀 Wave',
  author: {
    id: '2',
    displayName: 'Chatter',
    badges: [{ id: 'moderator', type: 'moderator', text: 'Mod' }],
  },
  emotes: [],
  timestamp: new Date(0),
  type: 'message',
})
function fixture(overrides: Partial<ProviderRuntimeDependencies> = {}) {
  let preferences: EmotePreferences = structuredClone(DEFAULT_EMOTE_PREFERENCES)
  let accounts = [account]
  let clock = 1000
  const published: Array<{ channel: string; catalog: EmoteCatalogEntry[] }> = []
  const presence: Array<{ user: string; channel: string }> = []
  const runtime = new ProviderRuntime({
    readPreferences: () => JSON.stringify(preferences),
    accounts: () => accounts,
    resolve: async (_platform, channel) => ({
      platformUserId: '42',
      login: channel === '42' ? 'viewer' : channel,
    }),
    native: async () => [],
    sevenTv: () => undefined,
    catalog: async () => [emote('Wave')],
    badges: async () => ({
      users: {},
      moderator: {
        id: 'ffz:mod',
        type: 'moderator',
        text: 'FFZ mod',
        imageUrl: 'https://example.test/mod.png',
      },
    }),
    sevenTvUser: async () => 'seven-tv-owner',
    presence: async (user, _platform, channel) => {
      presence.push({ user, channel })
    },
    publish: (_platform, channel, catalog) => {
      published.push({ channel, catalog })
    },
    now: () => clock,
    ...overrides,
  })
  runtimes.push(runtime)
  return {
    runtime,
    published,
    presence,
    preferences: (value: Partial<EmotePreferences>) => {
      preferences = { ...preferences, ...value }
      runtime.refreshPreferences()
    },
    logout: () => {
      accounts = []
      runtime.refreshAccounts()
    },
    time: (value: number) => {
      clock = value
    },
  }
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Provider runtime did not settle.')
    // Async callbacks intentionally complete outside the current store dispatch.
    // eslint-disable-next-line no-await-in-loop
    await Bun.sleep(1)
  }
}

test('catalog warmup coalesces, resolves numeric aliases and enriches memory without per-message requests', async () => {
  let requests = 0
  const { runtime, published } = fixture({
    catalog: async (_platform, _channel, options) => {
      requests++
      expect(options.twitchUserId).toBe('42')
      return [emote('Wave')]
    },
  })
  await Promise.all(Array.from({ length: 25 }, () => runtime.warm('twitch', '#Viewer')))
  expect(requests).toBe(1)
  expect(new Set(published.map((value) => value.channel))).toEqual(new Set(['viewer', '42']))
  for (let index = 0; index < 100; index++) {
    const enriched = runtime.enrich(message(index % 2 ? '42' : 'viewer'))
    expect(enriched.emotes[0]).toMatchObject({
      provider: 'bttv',
      positions: [{ start: 3, end: 6 }],
    })
    expect(enriched.author.badges[0]?.id).toBe('ffz:mod')
  }
  expect(requests).toBe(1)
})

test('a slow catalog cannot overwrite live 7TV additions, renames, or an empty set', async () => {
  let live: EmoteCatalogEntry[] | undefined = [emote('Old', 'seventv')]

  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const { runtime } = fixture({
    sevenTv: () => live,
    catalog: async () => {
      await gate
      return [emote('Old', 'seventv'), emote('Wave')]
    },
  })
  const loading = runtime.warm('twitch', 'viewer')
  await Bun.sleep(1)
  live = [emote('New', 'seventv')]
  runtime.refreshChannel('twitch', 'viewer')
  release()
  expect((await loading).map((entry) => entry.alias)).toEqual(['New', 'Wave'])
  live = []
  runtime.refreshChannel('twitch', '42')
  expect((await runtime.warm('twitch', 'viewer')).map((entry) => entry.alias)).toEqual(['Wave'])
})

test('saved provider preferences immediately affect enrichment and published catalogs', async () => {
  const state = fixture()
  await state.runtime.warm('twitch', 'viewer')
  state.preferences({
    enabled: { ...DEFAULT_EMOTE_PREFERENCES.enabled, bttv: false },
    badges: false,
  })
  expect(state.runtime.enrich(message()).emotes).toEqual([])
  expect(state.runtime.enrich(message()).author.badges[0]?.id).toBe('moderator')
  expect(state.published.at(-1)?.catalog).toEqual([])
  state.preferences({ enabled: { ...DEFAULT_EMOTE_PREFERENCES.enabled } })
  expect(state.runtime.enrich(message()).emotes[0]?.name).toBe('Wave')
})

test('warmup concurrency remains bounded and stopping settles queued requests', async () => {
  let active = 0
  let peak = 0
  let requests = 0
  const { runtime } = fixture({
    resolve: async (_platform, channel) => {
      active++
      requests++
      peak = Math.max(peak, active)
      await Bun.sleep(5)
      active--
      return { platformUserId: channel.slice(1), login: channel }
    },
  })
  await Promise.all(Array.from({ length: 15 }, (_, index) => runtime.warm('twitch', `c${index}`)))
  expect(peak).toBe(3)
  expect(requests).toBe(15)
  const pending = Array.from({ length: 20 }, (_, index) => runtime.warm('twitch', `d${index}`))
  await Bun.sleep(1)
  runtime.stop()
  await Promise.all(pending)
  const stoppedAt = requests
  runtime.start()
  await runtime.warm('twitch', 'fresh')
  expect(requests).toBe(stoppedAt + 1)
  expect(peak).toBe(3)
})

test('7TV presence is opt-in, uses resolved identity, and respects the heartbeat interval', async () => {
  const state = fixture()
  state.runtime.setActiveChannel({ platform: 'twitch', channelId: 'viewer' })
  await state.runtime.warm('twitch', 'viewer')
  await state.runtime.pulsePresence()
  expect(state.presence).toEqual([])
  state.preferences({ sendPresence: true })
  await state.runtime.pulsePresence()
  expect(state.presence).toEqual([{ user: 'seven-tv-owner', channel: '42' }])
  state.time(60000)
  await state.runtime.pulsePresence()
  expect(state.presence).toHaveLength(1)
  state.time(61000)
  await state.runtime.pulsePresence()
  expect(state.presence).toHaveLength(2)
  state.runtime.setActiveChannel(null)
  state.time(200000)
  await state.runtime.pulsePresence()
  expect(state.presence).toHaveLength(2)
})

test('opting out while the user identity loads prevents a pending presence write', async () => {
  let lookupStarted = false
  const { promise: user, resolve: resolveUser } = Promise.withResolvers<string>()
  const state = fixture({
    sevenTvUser: () => {
      lookupStarted = true
      return user
    },
  })
  state.preferences({ sendPresence: true })
  state.runtime.setActiveChannel({ platform: 'twitch', channelId: 'viewer' })
  await until(() => lookupStarted)
  state.preferences({ sendPresence: false })
  resolveUser('seven-tv-owner')
  await Bun.sleep(5)
  expect(state.presence).toEqual([])
})

test('logout invalidates pending presence and removes account-specific catalog entries', async () => {
  let lookupStarted = false
  const { promise: user, resolve: resolveUser } = Promise.withResolvers<string>()
  const state = fixture({
    sevenTvUser: () => {
      lookupStarted = true
      return user
    },
    catalog: async (_platform, _channel, options) =>
      options.personalUserId
        ? [emote('Personal', 'seventv')].map((entry) => ({ ...entry, source: 'personal' }))
        : [],
  })
  state.preferences({ sendPresence: true })
  state.runtime.setActiveChannel({ platform: 'twitch', channelId: 'viewer' })
  await until(() => lookupStarted)
  state.logout()
  resolveUser('seven-tv-owner')
  await Bun.sleep(5)
  expect(state.presence).toEqual([])
  expect((await state.runtime.warm('twitch', 'viewer')).map((entry) => entry.alias)).toEqual([])
})

test('own account identity needs no channel resolver and provider failures preserve a usable cache', async () => {
  let resolves = 0
  let fail = false
  const state = fixture({
    resolve: async () => {
      resolves++
      throw new Error('unexpected')
    },
    catalog: async () => {
      if (fail) throw new Error('offline')
      return [emote('Wave')]
    },
  })
  await state.runtime.warm('twitch', 'owner')
  expect(resolves).toBe(0)
  fail = true
  state.time(400000)
  expect((await state.runtime.warm('twitch', '7')).map((entry) => entry.alias)).toEqual(['Wave'])
})

test('personal emotes load only on visible author requests and cannot leak the connected account aliases to other authors', async () => {
  let requests = 0
  const authorUpdates: Array<{ authorId: string; emotes: EmoteCatalogEntry[] }> = []
  const state = fixture({
    catalog: async () => [{ ...emote('OwnerOnly', 'seventv'), source: 'personal' }],
    personalSet: async () => {
      requests++
      return [emote('ViewerOnly', 'seventv')]
    },
    publishAuthor: (_platform, authorId, emotes) => {
      authorUpdates.push({ authorId, emotes })
    },
  })
  await state.runtime.warm('twitch', 'viewer')
  const other = { ...message(), text: 'OwnerOnly ViewerOnly' }
  expect(state.runtime.enrich(other).emotes).toEqual([])
  const own = { ...other, author: { ...other.author, id: account.platformUserId } }
  expect(state.runtime.enrich(own).emotes.map((entry) => entry.name)).toEqual(['OwnerOnly'])
  expect(requests).toBe(0)
  await Promise.all(
    Array.from({ length: 20 }, () =>
      state.runtime.warmAuthorPersonal('twitch', '2', 'personal-set'),
    ),
  )
  expect(requests).toBe(1)
  expect(state.runtime.enrich(other).emotes.map((entry) => entry.name)).toEqual(['ViewerOnly'])
  expect(
    state.runtime.enrich({ ...other, author: { ...other.author, id: 'unrelated' } }).emotes,
  ).toEqual([])
  expect(authorUpdates.at(-1)).toMatchObject({
    authorId: '2',
    emotes: [{ alias: 'ViewerOnly', source: 'personal' }],
  })
  state.preferences({ personal: false })
  expect(state.runtime.enrich(other).emotes).toEqual([])
  expect(authorUpdates.at(-1)?.emotes).toEqual([])
  state.preferences({ personal: true })
  expect(state.runtime.enrich(other).emotes.map((entry) => entry.name)).toEqual(['ViewerOnly'])
  await state.runtime.warmAuthorPersonal('twitch', '2', undefined)
  expect(state.runtime.enrich(other).emotes).toEqual([])
})

test('an old personal set response cannot replace a newer author set or publish after stop', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const updates: string[][] = []
  const state = fixture({
    personalSet: async (setId) => {
      if (setId === 'old') await gate
      return [emote(setId, 'seventv')]
    },
    publishAuthor: (_platform, _author, catalog) => {
      updates.push(catalog.map((entry) => entry.alias))
    },
  })
  await state.runtime.warm('twitch', 'viewer')
  const old = state.runtime.warmAuthorPersonal('twitch', '2', 'old')
  await state.runtime.warmAuthorPersonal('twitch', '2', 'new')
  release()
  await old
  expect(updates.at(-1)).toEqual(['new'])
  const outgoing = { ...message(), text: 'old new' }
  expect(state.runtime.enrich(outgoing).emotes.map((entry) => entry.name)).toEqual(['new'])
  state.runtime.stop()
  const count = updates.length
  await state.runtime.warmAuthorPersonal('twitch', '3', 'ignored')
  expect(updates).toHaveLength(count)
})

test('UI author catalogs share a channel index and isolate personal aliases across authors and preference changes', () => {
  const channel = [emote('Wave'), { ...emote('OwnerOnly', 'seventv'), source: literal('personal') }]
  const personal = [{ ...emote('ViewerOnly', 'seventv'), source: literal('personal') }]
  const publicCatalog = authorEmoteCatalog(channel, [], false)
  expect(authorEmoteCatalog(channel, [], false)).toBe(publicCatalog)
  expect(authorEmoteCatalog(channel, [], true)).toBe(channel)
  const combined = authorEmoteCatalog(channel, personal, false)
  expect(authorEmoteCatalog(channel, personal, false)).toBe(combined)
  const incoming = { ...message(), text: 'OwnerOnly ViewerOnly Wave' }
  expect(enrichProviderEmotes(incoming, publicCatalog).emotes.map((entry) => entry.name)).toEqual([
    'Wave',
  ])
  expect(enrichProviderEmotes(incoming, combined).emotes.map((entry) => entry.name)).toEqual([
    'ViewerOnly',
    'Wave',
  ])
  expect(
    enrichProviderEmotes(incoming, combined, {
      ...DEFAULT_EMOTE_PREFERENCES,
      personal: false,
    }).emotes.map((entry) => entry.name),
  ).toEqual(['Wave'])
})

test('an explicitly empty live 7TV set does not resurrect removed emotes from a REST fallback', async () => {
  const urls: string[] = []
  const service = createEmoteProviderService(async (url) => {
    urls.push(url)
    return new Response(
      JSON.stringify(
        url.includes('/users/')
          ? {
              emote_set: {
                emotes: [
                  {
                    id: 'cold',
                    name: 'Cold',
                    data: {
                      host: {
                        url: '//cdn.7tv.app/emote/cold',
                        files: [{ name: '2x.webp', width: 56, height: 56 }],
                      },
                    },
                  },
                ],
              },
            }
          : { emotes: [] },
      ),
    )
  })
  const preferences = {
    ...DEFAULT_EMOTE_PREFERENCES,
    enabled: { twitch: false, seventv: true, bttv: false, ffz: false },
  }
  expect(
    await service.getProviderEmotes('twitch', 'viewer', {
      twitchUserId: '42',
      sevenTV: [],
      preferences,
    }),
  ).toEqual([])
  expect(urls).toEqual(['https://7tv.io/v3/emote-sets/global'])
  expect(
    (await service.getProviderEmotes('twitch', 'viewer', { twitchUserId: '42', preferences })).map(
      (entry) => entry.alias,
    ),
  ).toEqual(['Cold'])
  expect(urls.at(-1)).toBe('https://7tv.io/v3/users/twitch/42')
})

test('stopping invalidates in-flight catalog and author publications even if the runtime restarts', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  const authorUpdates: string[][] = []
  const state = fixture({
    catalog: async () => {
      await gate
      return [emote('Late')]
    },
    personalSet: async () => {
      await gate
      return [emote('LatePersonal', 'seventv')]
    },
    publishAuthor: (_platform, _author, catalog) => {
      authorUpdates.push(catalog.map((entry) => entry.alias))
    },
  })
  const channel = state.runtime.warm('twitch', 'viewer')
  const author = state.runtime.warmAuthorPersonal('twitch', '2', 'set')
  await Bun.sleep(1)
  state.runtime.stop()
  state.runtime.start()
  release()
  await Promise.all([channel, author])
  expect(state.published).toEqual([])
  expect(authorUpdates).toEqual([[]])
})

test('logout discards an old account catalog response before it can be published', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  let requests = 0
  const state = fixture({
    catalog: async (_platform, _channel, options) => {
      requests++
      if (options.personalUserId) {
        await gate
        return [{ ...emote('PrivateAlias', 'seventv'), source: 'personal' }]
      }
      return [emote('PublicAlias')]
    },
  })
  const loading = state.runtime.warm('twitch', 'viewer')
  await until(() => requests === 1)
  state.logout()
  release()
  await loading
  await state.runtime.warm('twitch', 'viewer')
  expect(
    state.published.every(
      (update) => !update.catalog.some((entry) => entry.alias === 'PrivateAlias'),
    ),
  ).toBe(true)
  expect(state.published.at(-1)?.catalog[0]?.alias).toBe('PublicAlias')
})

test('manual reload bypasses provider TTL and native cache and publishes all aliases', async () => {
  let requests = 0
  const service = createEmoteProviderService(async () => {
    requests++
    return Response.json([{ id: String(requests), code: `New${requests}`, imageType: 'webp' }])
  })
  const nativeForces: Array<boolean | undefined> = []
  const f = fixture({
    catalog: service.getProviderEmotes,
    invalidate: service.invalidate,
    native: async (_platform, _channel, force) => {
      nativeForces.push(force)
      return []
    },
    readPreferences: () =>
      JSON.stringify({
        ...DEFAULT_EMOTE_PREFERENCES,
        enabled: { twitch: true, seventv: false, ffz: false, bttv: true },
      }),
  })
  await f.runtime.warm('twitch', 'viewer')
  await f.runtime.warm('twitch', '42')
  const before = requests
  await f.runtime.reload('twitch', 'viewer')
  expect(requests).toBeGreaterThan(before)
  expect(nativeForces.at(-1)).toBe(true)
  const latest = f.published.slice(-2)
  expect(latest.map((entry) => entry.channel).sort()).toEqual(['42', 'viewer'])
  expect(latest.every((entry) => entry.catalog.some((item) => item.alias.startsWith('New')))).toBe(
    true,
  )
})

test('forced reload rejects native failures and cannot publish stale account personal emotes', async () => {
  let delayed = false
  const { promise: gate, resolve } = Promise.withResolvers<EmoteCatalogEntry[]>()
  const f = fixture({
    catalog: async (_platform, _channel, options) =>
      delayed && options.personalUserId ? gate : [],
  })
  await f.runtime.warm('twitch', 'viewer')
  delayed = true
  const reloading = f.runtime.reload('twitch', 'viewer')
  await Bun.sleep(1)
  f.logout()
  resolve([{ ...emote('OldPersonal'), source: 'personal' }])
  await reloading
  expect(f.published.at(-1)?.catalog.some((entry) => entry.alias === 'OldPersonal')).toBe(false)
  const broken = fixture({
    native: async () => {
      throw new Error('native permissions expired')
    },
  })
  await expect(broken.runtime.reload('twitch', 'viewer')).rejects.toThrow('permissions expired')
})
