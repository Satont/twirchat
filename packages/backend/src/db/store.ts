import postgres from 'postgres'

const sql = postgres(Deno.env.get('DATABASE_URL')!)

export interface DesktopClient {
  secret: string
  createdAt: Date
  lastSeenAt: Date
}

export interface PlatformAccount {
  id: string
  clientSecret: string
  platform: string
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
    platform: row.platform,
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

export const AccountStore = {
  async delete(clientSecret: string, platform: string): Promise<void> {
    await sql`
      DELETE FROM platform_accounts
      WHERE client_secret = ${clientSecret} AND platform = ${platform}
    `
  },

  async findAllByClient(clientSecret: string): Promise<PlatformAccount[]> {
    const rows = await sql<AccountRow[]>`
      SELECT * FROM platform_accounts
      WHERE client_secret = ${clientSecret}
      ORDER BY created_at
    `
    return rows.map(mapAccount)
  },

  async findByClientAndPlatform(
    clientSecret: string,
    platform: string,
  ): Promise<PlatformAccount | null> {
    const rows = await sql<AccountRow[]>`
      SELECT * FROM platform_accounts
      WHERE client_secret = ${clientSecret} AND platform = ${platform}
    `
    return rows[0] ? mapAccount(rows[0]) : null
  },

  async upsert(params: {
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
  }): Promise<void> {
    const id = `${params.platform}:${params.platformUserId}`
    await sql`
      INSERT INTO platform_accounts
        (id, client_secret, platform, platform_user_id, username, display_name,
         avatar_url, access_token, refresh_token, token_expires_at, scopes, updated_at)
      VALUES
        (${id}, ${params.clientSecret}, ${params.platform}, ${params.platformUserId},
         ${params.username}, ${params.displayName}, ${params.avatarUrl ?? null},
         ${params.accessToken}, ${params.refreshToken ?? null},
         ${params.tokenExpiresAt ?? null}, ${params.scopes ?? []}, NOW())
      ON CONFLICT (client_secret, platform) DO UPDATE SET
        platform_user_id = EXCLUDED.platform_user_id,
        username         = EXCLUDED.username,
        display_name     = EXCLUDED.display_name,
        avatar_url       = EXCLUDED.avatar_url,
        access_token     = EXCLUDED.access_token,
        refresh_token    = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        scopes           = EXCLUDED.scopes,
        updated_at       = NOW()
    `
  },
}

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
