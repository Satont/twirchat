import { sql } from "bun";

export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS desktop_clients (
      secret        TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
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
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_secret, platform)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS kick_oauth_sessions (
      state           TEXT PRIMARY KEY,
      client_secret   TEXT NOT NULL,
      code_verifier   TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("[DB] Migrations applied");
}
