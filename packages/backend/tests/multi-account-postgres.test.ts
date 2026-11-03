import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { SQL } from 'bun'
import { z } from 'zod'

import { runMigrations } from '../src/db/migrations'
import { AccountSelectionError, createAccountStore } from '../src/db/store'
import { createAccountRoutes } from '../src/routes/accounts'
import { required } from './literal'

// Explicitly enabled only for a freshly isolated local PostgreSQL Unix socket.
const socket = process.env.TWIRCHAT_TEST_PG_SOCKET
const enabled =
  typeof socket === 'string' && /^\/tmp\/twirchat-backend-pg-[A-Za-z0-9]+\/socket$/.test(socket)
if (socket && !enabled)
  throw new Error('PostgreSQL account tests require an isolated /tmp test socket.')
describe.skipIf(!enabled)('isolated PostgreSQL multi-account migration and ownership', () => {
  let database: SQL
  let accounts: ReturnType<typeof createAccountStore>
  beforeAll(async () => {
    const marker = await Bun.file(join(required(socket), '..', 'isolation.json')).json()
    if (marker.purpose !== 'twirchat-backend-accounts')
      throw new Error('Missing isolated PostgreSQL test marker.')
    database = new SQL({
      adapter: 'postgres',
      path: socket,
      port: 5432,
      username: 'twirchat_test',
      password: '',
      database: 'twirchat_multi_account_test',
      tls: false,
      max: 4,
      connectionTimeout: 2,
      connection: { application_name: 'twirchat-isolated-account-tests' },
    })
    expect((await database`SELECT current_database() AS name`)[0].name).toBe(
      'twirchat_multi_account_test',
    )
    accounts = createAccountStore(database)
  })
  afterAll(async () => {
    await database?.close({ timeout: 2 })
  })
  beforeEach(async () => {
    await database`DROP SCHEMA public CASCADE`
    await database`CREATE SCHEMA public`
  })
  const clients = async () => {
    await database`INSERT INTO desktop_clients(secret) VALUES('client-a'),('client-b')`
  }
  const login = (
    clientSecret: string,
    user: string,
    platform = 'twitch',
    accessToken = `access-${clientSecret}-${user}`,
  ) =>
    accounts.upsert({
      clientSecret,
      platform,
      platformUserId: user,
      username: `user${user}`,
      displayName: `User ${user}`,
      accessToken,
      refreshToken: `refresh-${user}`,
      scopes: ['chat:read'],
    })
  async function legacy() {
    await database`CREATE TABLE desktop_clients(secret TEXT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    await database`CREATE TABLE platform_accounts(id TEXT PRIMARY KEY,client_secret TEXT NOT NULL REFERENCES desktop_clients(secret) ON DELETE CASCADE,platform TEXT NOT NULL,platform_user_id TEXT NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL,avatar_url TEXT,access_token TEXT NOT NULL,refresh_token TEXT,token_expires_at TIMESTAMPTZ,scopes TEXT[] NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(client_secret,platform))`
    await clients()
    await database`INSERT INTO platform_accounts(id,client_secret,platform,platform_user_id,username,display_name,access_token,refresh_token,scopes) VALUES('twitch:42','client-a','twitch','42','legacy','Legacy','legacy-token','legacy-refresh',ARRAY['chat:read'])`
  }
  test('migrates legacy rows atomically and idempotently without rewriting IDs or credentials', async () => {
    await legacy()
    await runMigrations(database)
    await runMigrations(database)
    const selected = await accounts.findByClientAndPlatform('client-a', 'twitch')
    expect(selected).toMatchObject({
      id: 'twitch:42',
      platformUserId: '42',
      accessToken: 'legacy-token',
      refreshToken: 'legacy-refresh',
      scopes: ['chat:read'],
    })
    const second = await login('client-a', '43')
    expect(second.id).not.toBe('twitch:43')
    expect(
      (await accounts.findAllSavedByClient('client-a')).map((row) => row.platformUserId).sort(),
    ).toEqual(['42', '43'])
    expect((await accounts.findAllByClient('client-a')).map((row) => row.id)).toEqual([second.id])
  })
  test('keeps same external identity separate for two clients and multiple identities per client', async () => {
    await runMigrations(database)
    await clients()
    const first = await login('client-a', '42')
    const otherClient = await login('client-b', '42')
    expect(first.id).not.toBe(otherClient.id)
    const second = await login('client-a', '43')
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).toMatchObject({
      id: second.id,
    })
    const refreshedLogin = await login('client-a', '42', 'twitch', 'new-a-token')
    expect(refreshedLogin.id).toBe(first.id)
    expect(
      (await accounts.findAllSavedByClient('client-a'))
        .map((row) => [row.platformUserId, row.active])
        .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['42', true],
      ['43', false],
    ])
    expect(await accounts.findByClientAndPlatform('client-b', 'twitch')).toMatchObject({
      id: otherClient.id,
      accessToken: 'access-client-b-42',
    })
  })
  test('anonymous selection survives migrations and only an actual OAuth upsert activates a login', async () => {
    await runMigrations(database)
    await clients()
    await login('client-a', '42')
    await accounts.setActive('client-a', 'twitch', null)
    await runMigrations(database)
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).toBeNull()
    expect(await accounts.findAllByClient('client-a')).toEqual([])
    expect((await accounts.findAllSavedByClient('client-a'))[0]?.active).toBe(false)
    await login('client-a', '42')
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).not.toBeNull()
  })
  test('selection rejects another client or another platform without changing either selection', async () => {
    await runMigrations(database)
    await clients()
    const own = await login('client-a', '42')
    const foreign = await login('client-b', '42')
    const kick = await login('client-a', '99', 'kick')
    await expect(accounts.setActive('client-a', 'twitch', foreign.id)).rejects.toBeInstanceOf(
      AccountSelectionError,
    )
    await expect(accounts.setActive('client-a', 'twitch', kick.id)).rejects.toBeInstanceOf(
      AccountSelectionError,
    )
    expect((await accounts.findByClientAndPlatform('client-a', 'twitch'))?.id).toBe(own.id)
    expect((await accounts.findByClientAndPlatform('client-b', 'twitch'))?.id).toBe(foreign.id)
  })
  test('inactive forget preserves active identity; active forget persists anonymous and keeps other saved accounts', async () => {
    await runMigrations(database)
    await clients()
    const first = await login('client-a', '42')
    const second = await login('client-a', '43')
    const foreign = await login('client-b', '42')
    expect(await accounts.forget('client-a', foreign.id)).toBe(false)
    expect(await accounts.forget('client-a', first.id)).toBe(true)
    expect((await accounts.findByClientAndPlatform('client-a', 'twitch'))?.id).toBe(second.id)
    const third = await login('client-a', '44')
    expect(await accounts.forget('client-a', third.id)).toBe(true)
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).toBeNull()
    expect((await accounts.findAllSavedByClient('client-a')).map((row) => row.id)).toEqual([
      second.id,
    ])
    await runMigrations(database)
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).toBeNull()
  })
  test('legacy delete-all stays scoped to its client/platform and retains explicit anonymous selection', async () => {
    await runMigrations(database)
    await clients()
    await login('client-a', '42')
    await login('client-a', '43')
    await login('client-a', '99', 'kick')
    const foreign = await login('client-b', '42')
    await accounts.delete('client-a', 'twitch')
    expect((await accounts.findAllSavedByClient('client-a')).map((row) => row.platform)).toEqual([
      'kick',
    ])
    expect((await accounts.findByClientAndPlatform('client-b', 'twitch'))?.id).toBe(foreign.id)
    const selection =
      await database`SELECT account_id FROM active_platform_accounts WHERE client_secret='client-a' AND platform='twitch'`
    expect(selection[0].account_id).toBeNull()
  })
  test('missing selection seeding deterministically orders updated, created and ID while preserving NULL', async () => {
    await runMigrations(database)
    await clients()
    for (const id of ['z', 'a', 'older'])
      await database`INSERT INTO platform_accounts(id,client_secret,platform,platform_user_id,username,display_name,access_token,created_at,updated_at) VALUES(${id},'client-a','twitch',${id},${id},${id},'token','2026-01-01',${id === 'older' ? '2026-01-01' : '2026-02-01'}::timestamptz)`
    await runMigrations(database)
    expect((await accounts.findByClientAndPlatform('client-a', 'twitch'))?.id).toBe('a')
    await accounts.setActive('client-a', 'twitch', null)
    await runMigrations(database)
    expect(await accounts.findByClientAndPlatform('client-a', 'twitch')).toBeNull()
  })
  test('concurrent OAuth saves share a client/platform queue without token or row collisions', async () => {
    await runMigrations(database)
    await clients()
    const values = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        login(index % 2 ? 'client-a' : 'client-b', String(index % 4)),
      ),
    )
    expect(await accounts.findAllSavedByClient('client-a')).toHaveLength(2)
    expect(await accounts.findAllSavedByClient('client-b')).toHaveLength(2)
    expect(new Set(values.map((row) => row.id)).size).toBe(4)
    expect(await accounts.findAllByClient('client-a')).toHaveLength(1)
    expect(await accounts.findAllByClient('client-b')).toHaveLength(1)
  })
  test('migration failure rolls back schema changes and preserves the original rows', async () => {
    await legacy()
    await database`ALTER TABLE platform_accounts DROP CONSTRAINT platform_accounts_client_secret_platform_key`
    await database`INSERT INTO platform_accounts(id,client_secret,platform,platform_user_id,username,display_name,access_token) VALUES('duplicate','client-a','twitch','42','duplicate','Duplicate','token')`
    await expect(runMigrations(database)).rejects.toThrow()
    expect(
      (await database`SELECT to_regclass('public.active_platform_accounts') AS name`)[0].name,
    ).toBeNull()
    expect(
      (await database`SELECT COUNT(*)::integer AS count FROM platform_accounts`)[0].count,
    ).toBe(2)
  })
  test('routes expose only owned non-secret account DTOs and preserve compatibility', async () => {
    await runMigrations(database)
    await clients()
    const first = await login('client-a', '42')
    const second = await login('client-a', '43')
    const foreign = await login('client-b', '42')
    const routes = createAccountRoutes(accounts, async () => ({ clientSecret: 'client-a' }))
    const active = z
      .object({ accounts: z.array(z.object({ username: z.string() })) })
      .parse(
        await (await routes['/api/accounts'].GET(new Request('http://local/api/accounts'))).json(),
      )
    expect(active.accounts.map((row: { username: string }) => row.username)).toEqual(['user43'])
    const response = await routes['/api/accounts/saved'].GET(
      new Request('http://local/api/accounts/saved'),
    )
    const saved = z
      .object({ accounts: z.array(z.object({ id: z.string() }).passthrough()) })
      .passthrough()
      .parse(await response.json())
    expect(saved.accounts.map((row: { id: string }) => row.id).sort()).toEqual(
      [first.id, second.id].sort(),
    )
    expect(JSON.stringify(saved)).not.toContain('access-')
    expect(JSON.stringify(saved)).not.toContain('refresh-')
    expect(JSON.stringify(saved)).not.toContain('client-a')
    const patch = (id: string | null) =>
      Object.assign(
        new Request('http://local/api/accounts/twitch/active', {
          method: 'PATCH',
          body: JSON.stringify({ accountId: id }),
        }),
        { params: { platform: 'twitch' } },
      )
    const forbidden = await routes['/api/accounts/:platform/active'].PATCH(patch(foreign.id))
    const missing = await routes['/api/accounts/:platform/active'].PATCH(patch('missing'))
    expect(forbidden.status).toBe(404)
    expect(await forbidden.json()).toEqual(await missing.json())
    expect((await routes['/api/accounts/:platform/active'].PATCH(patch(null))).status).toBe(200)
    expect(await accounts.findAllByClient('client-a')).toEqual([])
    const request = Object.assign(
      new Request('http://local/api/accounts/saved/id', { method: 'DELETE' }),
      { params: { accountId: first.id } },
    )
    expect((await routes['/api/accounts/saved/:accountId'].DELETE(request)).status).toBe(200)
    expect((await accounts.findAllSavedByClient('client-a')).map((row) => row.id)).toEqual([
      second.id,
    ])
  })
  test('OAuth account save rolls back if selecting that account cannot commit', async () => {
    await runMigrations(database)
    await clients()
    await database`ALTER TABLE active_platform_accounts ADD CONSTRAINT reject_active CHECK(account_id IS NULL)`
    await expect(login('client-a', '42')).rejects.toThrow()
    expect(await accounts.findAllSavedByClient('client-a')).toEqual([])
    await database`ALTER TABLE active_platform_accounts DROP CONSTRAINT reject_active`
    await login('client-a', '42')
    expect(await accounts.findAllByClient('client-a')).toHaveLength(1)
  })
  test('concurrent migration runners serialize and legacy mismatched IDs remain stable', async () => {
    await legacy()
    await database`UPDATE platform_accounts SET id='twitch:older-user' WHERE id='twitch:42'`
    await Promise.all([runMigrations(database), runMigrations(database), runMigrations(database)])
    expect((await accounts.findByClientAndPlatform('client-a', 'twitch'))?.id).toBe(
      'twitch:older-user',
    )
    const relogin = await login('client-a', '42')
    expect(relogin.id).toBe('twitch:older-user')
    expect(await accounts.findAllSavedByClient('client-a')).toHaveLength(1)
  })
  test('client deletion cascades only its saved accounts and selections', async () => {
    await runMigrations(database)
    await clients()
    await login('client-a', '42')
    const other = await login('client-b', '42')
    await database`DELETE FROM desktop_clients WHERE secret='client-a'`
    expect(await accounts.findAllSavedByClient('client-a')).toEqual([])
    expect((await accounts.findAllByClient('client-b'))[0]?.id).toBe(other.id)
    expect(
      await database`SELECT * FROM active_platform_accounts WHERE client_secret='client-a'`,
    ).toHaveLength(0)
  })
})
