import { randomUUID } from 'node:crypto'

import type { Platform } from '@twirchat/shared'
import { sql, type SQL } from 'bun'
import { z } from 'zod'

const platformSchema = z.enum(['twitch', 'kick', 'youtube', 'vkplay'])

export interface DesktopClient {
  secret: string
  createdAt: Date
  lastSeenAt: Date
}

export interface PlatformAccount {
  id: string
  clientSecret: string
  platform: Platform
  platformUserId: string
  username: string
  displayName: string
  avatarUrl?: string
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: Date
  scopes: string[]
  createdAt: Date
  updatedAt: Date
}

// Row types as returned from Postgres (snake_case)
interface ClientRow {
  secret: string
  created_at: Date
  last_seen_at: Date
}

interface AccountRow {
  id: string
  client_secret: string
  platform: string
  platform_user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  access_token: string
  refresh_token: string | null
  token_expires_at: Date | null
  scopes: string[]
  created_at: Date
  updated_at: Date
}

function mapClient(row: ClientRow): DesktopClient {
  return {
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    secret: row.secret,
  }
}

function mapAccount(row: AccountRow): PlatformAccount {
  return {
    accessToken: row.access_token,
    avatarUrl: row.avatar_url ?? undefined,
    clientSecret: row.client_secret,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    platform: platformSchema.parse(row.platform),
    platformUserId: row.platform_user_id,
    refreshToken: row.refresh_token ?? undefined,
    scopes: row.scopes,
    tokenExpiresAt: row.token_expires_at ?? undefined,
    updatedAt: row.updated_at,
    username: row.username,
  }
}

export const ClientStore = {
  async findBySecret(secret: string): Promise<DesktopClient | null> {
    const rows = await sql<ClientRow[]>`
      SELECT * FROM desktop_clients WHERE secret = ${secret}
    `
    return rows[0] ? mapClient(rows[0]) : null
  },

  async touch(secret: string): Promise<void> {
    await sql`
      UPDATE desktop_clients SET last_seen_at = NOW() WHERE secret = ${secret}
    `
  },

  async upsert(secret: string): Promise<DesktopClient> {
    const rows = await sql<ClientRow[]>`
      INSERT INTO desktop_clients (secret)
      VALUES (${secret})
      ON CONFLICT (secret) DO UPDATE
        SET last_seen_at = NOW()
      RETURNING *
    `
    const row = rows[0]
    if (!row) throw new Error('Failed to upsert desktop client')
    return mapClient(row)
  },
}

export interface SavedPlatformAccount extends PlatformAccount {
  active: boolean
}
export class AccountSelectionError extends Error {
  constructor() {
    super('This saved account is not available for the requested platform.')
  }
}
export interface AccountUpsert {
  clientSecret: string
  platform: string
  platformUserId: string
  username: string
  displayName: string
  avatarUrl?: string
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: Date
  scopes?: string[]
}
/** Every identity mutation serializes only that client's platform, including the first selection. */
export function createAccountStore(database: SQL = sql) {
  return {
    async delete(clientSecret: string, platform: string): Promise<void> {
      await database.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${clientSecret}), hashtext(${platform}))`
        await transaction`DELETE FROM platform_accounts WHERE client_secret=${clientSecret} AND platform=${platform}`
        await transaction`INSERT INTO active_platform_accounts(client_secret,platform,account_id) VALUES(${clientSecret},${platform},NULL) ON CONFLICT(client_secret,platform) DO UPDATE SET account_id=NULL`
      })
    },
    async findAllByClient(clientSecret: string): Promise<PlatformAccount[]> {
      const rows = await database<AccountRow[]>`
        SELECT account.* FROM platform_accounts account
        JOIN active_platform_accounts selection ON selection.account_id=account.id
          AND selection.client_secret=account.client_secret AND selection.platform=account.platform
        WHERE account.client_secret=${clientSecret} ORDER BY account.created_at, account.id
      `
      return rows.map(mapAccount)
    },
    async findAllSavedByClient(clientSecret: string): Promise<SavedPlatformAccount[]> {
      const rows = await database<(AccountRow & { active: boolean | null })[]>`
        SELECT account.*, selection.account_id=account.id AS active FROM platform_accounts account
        LEFT JOIN active_platform_accounts selection ON selection.client_secret=account.client_secret AND selection.platform=account.platform
        WHERE account.client_secret=${clientSecret} ORDER BY account.created_at, account.id
      `
      return rows.map((row) => ({ ...mapAccount(row), active: row.active === true }))
    },
    async findByClientAndPlatform(
      clientSecret: string,
      platform: string,
    ): Promise<PlatformAccount | null> {
      const rows = await database<AccountRow[]>`
        SELECT account.* FROM platform_accounts account
        JOIN active_platform_accounts selection ON selection.account_id=account.id
          AND selection.client_secret=account.client_secret AND selection.platform=account.platform
        WHERE account.client_secret=${clientSecret} AND account.platform=${platform}
      `
      return rows[0] ? mapAccount(rows[0]) : null
    },
    async upsert(params: AccountUpsert): Promise<PlatformAccount> {
      return database.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${params.clientSecret}), hashtext(${params.platform}))`
        const rows = await transaction<AccountRow[]>`
          INSERT INTO platform_accounts(id,client_secret,platform,platform_user_id,username,display_name,avatar_url,access_token,refresh_token,token_expires_at,scopes,updated_at)
          VALUES(${randomUUID()},${params.clientSecret},${params.platform},${params.platformUserId},${params.username},${params.displayName},${params.avatarUrl ?? null},${params.accessToken},${params.refreshToken ?? null},${params.tokenExpiresAt ?? null},${params.scopes ?? []},NOW())
          ON CONFLICT(client_secret,platform,platform_user_id) DO UPDATE SET
            username=EXCLUDED.username, display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url,
            access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
            token_expires_at=EXCLUDED.token_expires_at, scopes=EXCLUDED.scopes, updated_at=NOW()
          RETURNING *
        `
        const account = rows[0]
        if (!account) throw new Error('The account could not be saved.')
        await transaction`INSERT INTO active_platform_accounts(client_secret,platform,account_id) VALUES(${params.clientSecret},${params.platform},${account.id}) ON CONFLICT(client_secret,platform) DO UPDATE SET account_id=EXCLUDED.account_id`
        return mapAccount(account)
      })
    },
    async setActive(
      clientSecret: string,
      platform: string,
      accountId: string | null,
    ): Promise<void> {
      await database.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${clientSecret}), hashtext(${platform}))`
        if (accountId !== null) {
          const rows = await transaction<
            { id: string }[]
          >`SELECT id FROM platform_accounts WHERE id=${accountId} AND client_secret=${clientSecret} AND platform=${platform} FOR KEY SHARE`
          if (!rows.length) throw new AccountSelectionError()
        }
        await transaction`INSERT INTO active_platform_accounts(client_secret,platform,account_id) VALUES(${clientSecret},${platform},${accountId}) ON CONFLICT(client_secret,platform) DO UPDATE SET account_id=EXCLUDED.account_id`
      })
    },
    async forget(clientSecret: string, accountId: string): Promise<boolean> {
      const rows = await database<
        { platform: string }[]
      >`SELECT platform FROM platform_accounts WHERE id=${accountId} AND client_secret=${clientSecret}`
      const account = rows[0]
      if (!account) return false
      return database.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${clientSecret}), hashtext(${account.platform}))`
        const removed = await transaction<
          { id: string }[]
        >`DELETE FROM platform_accounts WHERE id=${accountId} AND client_secret=${clientSecret} RETURNING id`
        return removed.length > 0
      })
    },
  }
}
export const AccountStore = createAccountStore()

export const KickOAuthSessionStore = {
  async consume(state: string): Promise<{ clientSecret: string; codeVerifier: string } | null> {
    const rows = await sql<{ client_secret: string; code_verifier: string }[]>`
      DELETE FROM kick_oauth_sessions
      WHERE state = ${state}
        AND created_at > NOW() - INTERVAL '10 minutes'
      RETURNING client_secret, code_verifier
    `
    const row = rows[0]
    if (!row) return null
    return { clientSecret: row.client_secret, codeVerifier: row.code_verifier }
  },

  async create(params: {
    state: string
    clientSecret: string
    codeVerifier: string
  }): Promise<void> {
    await sql`
      INSERT INTO kick_oauth_sessions (state, client_secret, code_verifier)
      VALUES (${params.state}, ${params.clientSecret}, ${params.codeVerifier})
    `
  },
}

// ---------------------------------------------------------------------------
// YouTube channel handle → channel ID cache (30-day TTL)
// ---------------------------------------------------------------------------

export const YoutubeChannelCacheStore = {
  /** Returns a cached channelId if the entry exists and has not expired. */
  async get(handle: string): Promise<string | null> {
    const rows = await sql<{ channel_id: string }[]>`
      SELECT channel_id FROM youtube_channel_cache
      WHERE handle = ${handle} AND available_until > NOW()
    `
    return rows[0]?.channel_id ?? null
  },

  /** Inserts or refreshes a handle → channelId mapping with a 30-day TTL.
   *  If the entry exists but is expired it gets overwritten via ON CONFLICT. */
  async upsert(handle: string, channelId: string): Promise<void> {
    await sql`
      INSERT INTO youtube_channel_cache (handle, channel_id, available_until)
      VALUES (${handle}, ${channelId}, NOW() + INTERVAL '30 days')
      ON CONFLICT (handle) DO UPDATE SET
        channel_id      = EXCLUDED.channel_id,
        available_until = EXCLUDED.available_until
    `
  },
}
