import { describe, expect, test } from 'bun:test'

import { parseTwitchEmoteCatalog } from '@twirchat/shared/twitch-emote-catalog'

import { createEmoteCatalogService } from '../src/api/emote-catalog'
import { createEmoteCatalogRoutes } from '../src/routes/emote-catalog'
import { required } from './literal'

const json = (value: unknown) => new Response(JSON.stringify(value))
const body = (name: string, extra: Record<string, unknown> = {}) => ({
  template: 'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}',
  data: [
    {
      id: name,
      name,
      format: ['static', 'animated'],
      scale: ['1.0', '2.0', '3.0'],
      theme_mode: ['light', 'dark'],
      ...extra,
    },
  ],
})

describe('native Twitch emote catalog', () => {
  test('coalesces channel identity lookups and reuses the normalized login and numeric ID', async () => {
    const calls: string[] = []
    const service = createEmoteCatalogService(async (url) => {
      calls.push(url)
      await Bun.sleep(1)
      return json({ data: [{ id: '42', login: 'creator' }] })
    })
    const values = await Promise.all(
      Array.from({ length: 20 }, () => service.resolveTwitchChannel(' #Creator ')),
    )
    expect(
      values.every((value) => value.platformUserId === '42' && value.login === 'creator'),
    ).toBe(true)
    expect(calls).toEqual(['https://api.twitch.tv/helix/users?login=creator'])
    expect(await service.resolveTwitchChannel('42')).toEqual(required(values[0]))
    expect(calls).toHaveLength(1)
    await expect(service.resolveTwitchChannel('../invalid')).rejects.toThrow(
      'Invalid Twitch channel',
    )
    expect(calls).toHaveLength(1)
  })

  test('resolves numeric channels through the Twitch ID parameter and reports missing channels', async () => {
    const calls: string[] = []
    const service = createEmoteCatalogService(async (url) => {
      calls.push(url)
      return json({ data: [] })
    })
    await expect(service.resolveTwitchChannel('42')).rejects.toThrow('not found')
    expect(calls).toEqual(['https://api.twitch.tv/helix/users?id=42'])
  })
  test('builds actual animated CDN templates and categorizes available user emotes', () => {
    expect(
      parseTwitchEmoteCatalog(
        body('Pog', { owner_id: '42', emote_type: 'subscriptions' }),
        'collectibles',
        '42',
      )[0],
    ).toMatchObject({
      alias: 'Pog',
      source: 'channel',
      animated: true,
      provider: 'twitch',
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/Pog/animated/dark/3.0',
    })
    expect(
      parseTwitchEmoteCatalog(
        body('Bits', { emote_type: 'bitstier', owner_id: '99' }),
        'collectibles',
        '42',
      )[0]?.source,
    ).toBe('collectibles')
    expect(
      parseTwitchEmoteCatalog(body('Kappa', { emote_type: 'globals' }), 'collectibles')[0]?.source,
    ).toBe('global')
  })

  test('uses app credentials for anonymous channel catalogs', async () => {
    const service = createEmoteCatalogService(async (url) =>
      json(body(url.includes('/global') ? 'Global' : 'Local')),
    )
    expect(
      (await service.getTwitchEmotes({ channelSlug: '42' })).map((emote) => emote.alias),
    ).toEqual(['Local', 'Global'])
  })

  test('requires desktop-client identification for the catalog proxy', async () => {
    const route = createEmoteCatalogRoutes()['/api/emote-catalog/twitch']
    expect(
      (
        await route.POST(
          new Request('http://localhost/api/emote-catalog/twitch', { method: 'POST', body: '{}' }),
        )
      ).status,
    ).toBe(401)
  })
})

test('explicit force refresh bypasses native catalog TTL without leaking token-scoped caches', async () => {
  let requests = 0
  const service = createEmoteCatalogService(async () => {
    requests++
    return json(body(`Emote${requests}`))
  })
  const first = await service.getTwitchEmotes({ channelSlug: '' })
  const cached = await service.getTwitchEmotes({ channelSlug: '' })
  expect(cached).toEqual(first)
  expect(requests).toBe(1)
  const refreshed = await service.getTwitchEmotes({ channelSlug: '', force: true })
  expect(requests).toBe(2)
  expect(refreshed[0]?.alias).toBe('Emote2')
  expect((await service.getTwitchEmotes({ channelSlug: '' }))[0]?.alias).toBe('Emote2')
})

test('force waits for an older in-flight read and coalesces concurrent forced reads', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  let requests = 0
  const service = createEmoteCatalogService(async () => {
    const sequence = ++requests
    if (sequence === 1) await gate
    return json(body(`Emote${sequence}`))
  })
  const original = service.getTwitchEmotes({ channelSlug: '' })
  const forced = service.getTwitchEmotes({ channelSlug: '', force: true })
  const duplicate = service.getTwitchEmotes({ channelSlug: '', force: true })
  release()
  expect((await original)[0]?.alias).toBe('Emote1')
  expect((await forced)[0]?.alias).toBe('Emote2')
  expect((await duplicate)[0]?.alias).toBe('Emote2')
  expect(requests).toBe(2)
})

test('catalog route forwards boolean force and rejects malformed flags before querying Twitch', async () => {
  const { ClientStore } = await import('../src/db/store')
  const original = ClientStore.upsert
  ClientStore.upsert = async () => ({
    secret: 'mock',
    createdAt: new Date(),
    lastSeenAt: new Date(),
  })
  const received: unknown[] = []
  const routes = createEmoteCatalogRoutes({
    getTwitchEmotes: async (input) => {
      received.push(input)
      return []
    },
    resolveTwitchChannel: async () => ({ platformUserId: '1', login: 'fixture' }),
  })
  const request = (force: unknown) =>
    new Request('http://localhost/api/emote-catalog/twitch', {
      method: 'POST',
      headers: { 'X-Client-Secret': 'mock' },
      body: JSON.stringify({ channelSlug: 'fixture', force, userAccessToken: 'legacy-token' }),
    })
  try {
    expect((await routes['/api/emote-catalog/twitch'].POST(request('yes'))).status).toBe(400)
    expect(received).toHaveLength(0)
    expect((await routes['/api/emote-catalog/twitch'].POST(request(true))).status).toBe(200)
    expect(received).toEqual([{ channelSlug: 'fixture', force: true }])
  } finally {
    ClientStore.upsert = original
  }
})
