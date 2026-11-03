import { expect, test } from 'bun:test'

import { AccountSelectionError, type SavedPlatformAccount } from '../src/db/store'
import { createAccountRoutes } from '../src/routes/accounts'
const saved: SavedPlatformAccount = {
  id: 'saved-1',
  clientSecret: 'client-a',
  platform: 'twitch',
  platformUserId: '42',
  username: 'viewer',
  displayName: 'Viewer',
  accessToken: 'private-access-token',
  refreshToken: 'private-refresh-token',
  scopes: ['chat:read'],
  active: true,
  createdAt: new Date(1000),
  updatedAt: new Date(2000),
}
function fixture() {
  const calls: unknown[] = []
  const store = {
    findAllByClient: async (client: string) => {
      calls.push(['active', client])
      return [saved]
    },
    findAllSavedByClient: async (client: string) => {
      calls.push(['saved', client])
      return [saved]
    },
    delete: async (client: string, platform: string) => {
      calls.push(['delete-all', client, platform])
    },
    setActive: async (client: string, platform: string, accountId: string | null) => {
      calls.push(['select', client, platform, accountId])
    },
    forget: async (client: string, accountId: string) => {
      calls.push(['forget', client, accountId])
      return accountId === 'saved-1'
    },
  }
  return {
    store,
    calls,
    routes: createAccountRoutes(store, async () => ({ clientSecret: 'client-a' })),
  }
}
const patch = (body: string, platform = 'twitch') =>
  Object.assign(new Request('http://local/api/accounts/twitch/active', { method: 'PATCH', body }), {
    params: { platform },
  })
test('saved and legacy active responses expose only allowed identity fields', async () => {
  const { routes } = fixture()
  const legacy = await (
    await routes['/api/accounts'].GET(new Request('http://local/api/accounts'))
  ).json()
  expect(legacy).toEqual({
    accounts: [
      { platform: 'twitch', username: 'viewer', displayName: 'Viewer', connectedAt: 1000 },
    ],
  })
  const response = await routes['/api/accounts/saved'].GET(
    new Request('http://local/api/accounts/saved'),
  )
  const serialized = await response.text()
  expect(serialized).not.toContain('private-')
  expect(serialized).not.toContain('client-a')
  expect(JSON.parse(serialized)).toEqual({
    accounts: [
      {
        id: 'saved-1',
        platform: 'twitch',
        platformUserId: '42',
        username: 'viewer',
        displayName: 'Viewer',
        scopes: ['chat:read'],
        connectedAt: 1000,
        active: true,
      },
    ],
  })
})
test('active selection rejects malformed input before any store mutation', async () => {
  const { routes, calls } = fixture()
  for (const body of [
    'bad-json',
    '{}',
    '[]',
    '{"accountId":42}',
    '{"accountId":""}',
    '{"accountId":{}}',
  ])
    expect((await routes['/api/accounts/:platform/active'].PATCH(patch(body))).status).toBe(400)
  expect(
    (await routes['/api/accounts/:platform/active'].PATCH(patch('{"accountId":null}', 'unknown')))
      .status,
  ).toBe(400)
  expect(
    (
      await routes['/api/accounts/:platform/active'].PATCH(
        patch(JSON.stringify({ accountId: 'a'.repeat(5000) })),
      )
    ).status,
  ).toBe(413)
  expect(calls).toEqual([])
  expect(
    (await routes['/api/accounts/:platform/active'].PATCH(patch('{"accountId":null}'))).status,
  ).toBe(200)
  expect(calls).toEqual([['select', 'client-a', 'twitch', null]])
})
test('selection errors neither disclose ownership nor expose internal database errors', async () => {
  const f = fixture()
  f.store.setActive = async () => {
    throw new AccountSelectionError()
  }
  const forbidden = await f.routes['/api/accounts/:platform/active'].PATCH(
    patch('{"accountId":"foreign"}'),
  )
  expect(forbidden.status).toBe(404)
  expect(await forbidden.json()).toEqual({
    error: 'This saved account is not available for the requested platform.',
  })
  f.store.setActive = async () => {
    throw new Error('private database credentials')
  }
  const broken = await f.routes['/api/accounts/:platform/active'].PATCH(patch('{"accountId":null}'))
  expect(broken.status).toBe(500)
  expect(await broken.text()).not.toContain('private')
})
test('exact forget and legacy platform delete-all stay separate operations', async () => {
  const { routes, calls } = fixture()
  const forget = (accountId: string) =>
    Object.assign(new Request('http://local/api/accounts/saved/id', { method: 'DELETE' }), {
      params: { accountId },
    })
  expect((await routes['/api/accounts/saved/:accountId'].DELETE(forget('foreign'))).status).toBe(
    404,
  )
  expect((await routes['/api/accounts/saved/:accountId'].DELETE(forget('saved-1'))).status).toBe(
    200,
  )
  const legacy = Object.assign(
    new Request('http://local/api/accounts/twitch', { method: 'DELETE' }),
    { params: { platform: 'twitch' } },
  )
  expect((await routes['/api/accounts/:platform'].DELETE(legacy)).status).toBe(200)
  expect(calls).toEqual([
    ['forget', 'client-a', 'foreign'],
    ['forget', 'client-a', 'saved-1'],
    ['delete-all', 'client-a', 'twitch'],
  ])
})
test('every account endpoint authenticates before touching accounts', async () => {
  const f = fixture()
  const routes = createAccountRoutes(f.store, async () => new Response('denied', { status: 401 }))
  expect((await routes['/api/accounts'].GET(new Request('http://local'))).status).toBe(401)
  expect((await routes['/api/accounts/saved'].GET(new Request('http://local'))).status).toBe(401)
  expect(
    (await routes['/api/accounts/:platform/active'].PATCH(patch('{"accountId":null}'))).status,
  ).toBe(401)
  expect(
    (
      await routes['/api/accounts/:platform'].DELETE(
        Object.assign(new Request('http://local'), {
          params: { platform: 'twitch' },
        }),
      )
    ).status,
  ).toBe(401)
  expect(
    (
      await routes['/api/accounts/saved/:accountId'].DELETE(
        Object.assign(new Request('http://local'), {
          params: { accountId: 'saved-1' },
        }),
      )
    ).status,
  ).toBe(401)
  expect(f.calls).toEqual([])
})
