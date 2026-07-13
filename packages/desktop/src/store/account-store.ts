import { getDb } from './db'
import { decrypt, encrypt } from './crypto'
import type { Account, Platform } from '@twirchat/shared/types'

interface DbAccount {
  id: string
  platform: string
  platform_user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  scopes: string | null
  created_at: number
  updated_at: number
}

export const AccountStore = {
  delete(id: string): void {
    const db = getDb()
    db.run('DELETE FROM accounts WHERE id = ?', [id])
  },

  deleteByPlatform(platform: Platform): void {
    const db = getDb()
    db.run('DELETE FROM accounts WHERE platform = ?', [platform])
  },

  findAll(): Account[] {
    const db = getDb()
    const rows = db.query<DbAccount, []>('SELECT * FROM accounts').all()
    return rows.map(mapRow)
  },

  findByPlatform(platform: Platform): Account | null {
    const db = getDb()
    const row = db
      .query<DbAccount, [string]>('SELECT * FROM accounts WHERE platform = ? LIMIT 1')
      .get(platform)
    if (!row) return null
    return mapRow(row)
  },

  getTokens(id: string): { accessToken: string; refreshToken?: string; expiresAt?: number } | null {
    const db = getDb()
    const row = db
      .query<Pick<DbAccount, 'access_token' | 'refresh_token' | 'expires_at'>, [string]>(
        'SELECT access_token, refresh_token, expires_at FROM accounts WHERE id = ?',
      )
      .get(id)
    if (!row) return null
    return {
      accessToken: decrypt(row.access_token),
      refreshToken: row.refresh_token ? decrypt(row.refresh_token) : undefined,
      expiresAt: row.expires_at ?? undefined,
    }
  },

  updateTokens(id: string, accessToken: string, refreshToken?: string, expiresAt?: number): void {
    const db = getDb()
    db.run(
      `UPDATE accounts SET
         access_token = ?,
         refresh_token = ?,
         expires_at = ?,
         updated_at = unixepoch()
       WHERE id = ?`,
      [encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiresAt ?? null, id],
    )
  },

  upsert(params: {
    id: string
    platform: Platform
    platformUserId: string
    username: string
    displayName: string
    avatarUrl?: string
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
  }): void {
    const db = getDb()
    const encryptedAccess = encrypt(params.accessToken)
    const encryptedRefresh = params.refreshToken ? encrypt(params.refreshToken) : null

    db.run(
      `INSERT INTO accounts
        (id, platform, platform_user_id, username, display_name, avatar_url,
         access_token, refresh_token, expires_at, scopes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         platform_user_id = excluded.platform_user_id,
         username = excluded.username,
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scopes = excluded.scopes,
         updated_at = unixepoch()`,
      [
        params.id,
        params.platform,
        params.platformUserId,
        params.username,
        params.displayName,
        params.avatarUrl ?? null,
        encryptedAccess,
        encryptedRefresh,
        params.expiresAt ?? null,
        params.scopes ? JSON.stringify(params.scopes) : null,
      ],
    )
  },
}

function mapRow(row: DbAccount): Account {
  return {
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    platform: row.platform as Platform,
    platformUserId: row.platform_user_id,
    scopes: row.scopes ? (JSON.parse(row.scopes) as string[]) : [],
    updatedAt: row.updated_at,
    username: row.username,
  }
}
