import { logger } from '@twirchat/shared'
import { sql, type SQL } from 'bun'

const log = logger('migrations')

export async function runMigrations(database: SQL = sql): Promise<void> {
  try {
    await database.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(741133, 1)`
      await transaction`
      CREATE TABLE IF NOT EXISTS desktop_clients (
        secret        TEXT PRIMARY KEY,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

      await transaction`
      CREATE TABLE IF NOT EXISTS platform_accounts (
        id              TEXT PRIMARY KEY,
        client_secret   TEXT NOT NULL REFERENCES desktop_clients(secret) ON DELETE CASCADE,
        platform        TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        username        TEXT NOT NULL,
        display_name    TEXT NOT NULL,
        avatar_url      TEXT,
        access_token    TEXT NOT NULL,
        refresh_token   TEXT,
        token_expires_at TIMESTAMPTZ,
        scopes          TEXT[] NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

      await transaction`ALTER TABLE platform_accounts DROP CONSTRAINT IF EXISTS platform_accounts_client_secret_platform_key`
      await transaction`CREATE UNIQUE INDEX IF NOT EXISTS platform_accounts_client_identity_key ON platform_accounts(client_secret, platform, platform_user_id)`
      await transaction`
      CREATE TABLE IF NOT EXISTS active_platform_accounts (
        client_secret TEXT NOT NULL REFERENCES desktop_clients(secret) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        account_id TEXT REFERENCES platform_accounts(id) ON DELETE SET NULL,
        PRIMARY KEY (client_secret, platform)
      )
    `
      await transaction`CREATE INDEX IF NOT EXISTS active_platform_accounts_account_idx ON active_platform_accounts(account_id) WHERE account_id IS NOT NULL`
      await transaction`
      INSERT INTO active_platform_accounts(client_secret, platform, account_id)
      SELECT DISTINCT ON (client_secret, platform) client_secret, platform, id
      FROM platform_accounts
      ORDER BY client_secret, platform, updated_at DESC, created_at DESC, id ASC
      ON CONFLICT (client_secret, platform) DO NOTHING
    `

      await transaction`
      CREATE TABLE IF NOT EXISTS kick_oauth_sessions (
        state           TEXT PRIMARY KEY,
        client_secret   TEXT NOT NULL,
        code_verifier   TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

      await transaction`
      CREATE TABLE IF NOT EXISTS youtube_channel_cache (
        handle          TEXT PRIMARY KEY,
        channel_id      TEXT NOT NULL,
        available_until TIMESTAMPTZ NOT NULL
      )
    `
    })
    log.info('Migrations applied')
  } catch (e) {
    log.error('Failed to apply migrations', { err: String(e) })
    if (database === sql) process.exit(1)
    throw e
  }
}
