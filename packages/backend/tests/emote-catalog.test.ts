import { describe, expect, test } from 'bun:test'

import { createEmoteCatalogService, parseTwitchEmoteCatalog } from '../src/api/emote-catalog'
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
    const service = createEmoteCatalogService({
      fetch: async () => {
        throw new Error('Identity lookup must use app credentials')
      },
      appFetch: async (url) => {
        calls.push(url)
        await Bun.sleep(1)
        return json({ data: [{ id: '42', login: 'creator' }] })
      },
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
    const service = createEmoteCatalogService({
      fetch: async () => json({}),
      appFetch: async (url) => {
        calls.push(url)
        return json({ data: [] })
      },
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

  test('validates token identity and follows user pagination without leaking client IDs between accounts', async () => {
    const calls: Array<{ url: URL; headers: Headers }> = []
    const service = createEmoteCatalogService({
      appFetch: async () => {
        throw new Error('Unexpected app token request')
      },
      fetch: async (url, init) => {
        const parsed = new URL(url),
          headers = new Headers(init?.headers)
        calls.push({ url: parsed, headers })
        if (parsed.pathname === '/oauth2/validate')
          return json({
            client_id: 'actual-token-client',
            user_id: '7',
            scopes: ['user:read:emotes'],
          })
        expect(headers.get('Client-Id')).toBe('actual-token-client')
        expect(headers.get('Authorization')).toBe('Bearer token')
        if (parsed.pathname.endsWith('/users')) return json({ data: [{ id: '42' }] })
        if (parsed.pathname.endsWith('/emotes/global')) return json(body('Global'))
        if (parsed.pathname.endsWith('/emotes/user')) {
          expect(parsed.searchParams.get('user_id')).toBe('7')
          expect(parsed.searchParams.get('broadcaster_id')).toBe('42')
          return json(
            parsed.searchParams.has('after')
              ? body('Bits', { emote_type: 'bitstier' })
              : {
                  ...body('Subscribed', { emote_type: 'subscriptions' }),
                  pagination: { cursor: 'next' },
                },
          )
        }
        return json(body('Channel'))
      },
    })
    const [first, second] = await Promise.all([
      service.getTwitchEmotes({ channelSlug: 'satont', userAccessToken: 'token' }),
      service.getTwitchEmotes({ channelSlug: 'satont', userAccessToken: 'token' }),
    ])
    expect(first.map((emote) => emote.alias)).toEqual(['Subscribed', 'Bits', 'Channel', 'Global'])
    expect(second).toEqual(first)
    expect(calls.filter((call) => call.url.pathname === '/oauth2/validate')).toHaveLength(1)
    expect(calls.some((call) => call.url.searchParams.get('after') === 'next')).toBe(true)
  })

  test('keeps global and channel emotes available for older tokens without the new scope', async () => {
    const paths: string[] = []
    const service = createEmoteCatalogService({
      appFetch: async () => json({ data: [] }),
      fetch: async (url) => {
        paths.push(url)
        return url.includes('/validate')
          ? json({ client_id: 'client', user_id: '7', scopes: [] })
          : json(body(url.includes('/global') ? 'Global' : 'Local'))
      },
    })
    expect(
      (await service.getTwitchEmotes({ channelSlug: '42', userAccessToken: 'old-token' })).map(
        (emote) => emote.alias,
      ),
    ).toEqual(['Local', 'Global'])
    expect(paths.some((path) => path.includes('/emotes/user'))).toBe(false)
  })

  test('uses app credentials for anonymous channel catalogs', async () => {
    const service = createEmoteCatalogService({
      fetch: async () => {
        throw new Error('Unexpected user request')
      },
      appFetch: async (url) => json(body(url.includes('/global') ? 'Global' : 'Local')),
    })
    expect(
      (await service.getTwitchEmotes({ channelSlug: '42' })).map((emote) => emote.alias),
    ).toEqual(['Local', 'Global'])
  })

  test('fails clearly on repeated cursors instead of silently truncating the user catalog', async () => {
    const service = createEmoteCatalogService({
      appFetch: async () => json({ data: [] }),
      fetch: async (url) =>
        url.includes('/validate')
          ? json({ client_id: 'client', user_id: '7', scopes: ['user:read:emotes'] })
          : json({
              ...body('Loop'),
              pagination: url.includes('/emotes/user') ? { cursor: 'same' } : {},
            }),
    })
    await expect(
      service.getTwitchEmotes({ channelSlug: '42', userAccessToken: 'token' }),
    ).rejects.toThrow('repeated')
  })

  test('rejects invalid identities and malformed inputs before upstream requests', async () => {
    let calls = 0
    const service = createEmoteCatalogService({
      appFetch: async () => json({ data: [] }),
      fetch: async () => {
        calls++
        return json({ client_id: 'client' })
      },
    })
    await expect(service.getTwitchEmotes({ channelSlug: '../invalid' })).rejects.toThrow(
      'valid Twitch',
    )
    expect(calls).toBe(0)
    await expect(
      service.getTwitchEmotes({ channelSlug: '42', userAccessToken: 'bad-token' }),
    ).rejects.toThrow('valid Twitch user token')
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
  const service = createEmoteCatalogService({
    fetch: async () => json({}),
    appFetch: async () => {
      requests++
      return json(body(`Emote${requests}`))
    },
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
  const service = createEmoteCatalogService({
    fetch: async () => json({}),
    appFetch: async () => {
      const sequence = ++requests
      if (sequence === 1) await gate
      return json(body(`Emote${sequence}`))
    },
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
      body: JSON.stringify({ channelSlug: 'fixture', force }),
    })
  try {
    expect((await routes['/api/emote-catalog/twitch'].POST(request('yes'))).status).toBe(400)
    expect(received).toHaveLength(0)
    expect((await routes['/api/emote-catalog/twitch'].POST(request(true))).status).toBe(200)
    expect(received).toEqual([{ channelSlug: 'fixture', force: true, userAccessToken: undefined }])
  } finally {
    ClientStore.upsert = original
  }
})
