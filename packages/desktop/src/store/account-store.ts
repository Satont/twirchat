import type { Account, Platform } from '@twirchat/shared/types'
import { z } from 'zod'

import { platformSchema } from '../services/persisted-schemas'
import { decrypt, encrypt } from './crypto'
import { getDb } from './db'

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

  findAllSaved(): Account[] {
    return this.findAll()
  },

  findAllActive(): Account[] {
    return getDb()
      .query<DbAccount, []>(`SELECT accounts.* FROM accounts
      JOIN active_accounts ON active_accounts.account_id = accounts.id
        AND active_accounts.platform = accounts.platform ORDER BY accounts.platform`)
      .all()
      .map(mapRow)
  },

  findById(id: string): Account | null {
    const row = getDb().query<DbAccount, [string]>('SELECT * FROM accounts WHERE id = ?').get(id)
    return row ? mapRow(row) : null
  },

  setActive(platform: Platform, accountId: string | null): Account | null {
    if (!['twitch', 'kick', 'youtube', 'vkplay'].includes(platform))
      throw new Error('Unknown account platform.')
    const account = accountId === null ? null : this.findById(accountId)
    if (accountId !== null && (!account || account.platform !== platform))
      throw new Error('Choose a saved account belonging to this platform.')
    getDb().run(
      `INSERT INTO active_accounts(platform, account_id) VALUES (?, ?)
      ON CONFLICT(platform) DO UPDATE SET account_id = excluded.account_id`,
      [platform, accountId],
    )
    return account
  },

  findByPlatform(platform: Platform): Account | null {
    const db = getDb()
    const row = db
      .query<DbAccount, [string]>(`SELECT accounts.* FROM accounts
        JOIN active_accounts ON active_accounts.account_id = accounts.id
          AND active_accounts.platform = accounts.platform WHERE active_accounts.platform = ?`)
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
    activate?: boolean
  }): void {
    const db = getDb()
    const encryptedAccess = encrypt(params.accessToken)
    const encryptedRefresh = params.refreshToken ? encrypt(params.refreshToken) : null

    db.transaction(() => {
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
      db.run('INSERT OR IGNORE INTO active_accounts(platform, account_id) VALUES (?, ?)', [
        params.platform,
        params.id,
      ])
      if (params.activate) this.setActive(params.platform, params.id)
    })()
  },
}

function mapRow(row: DbAccount): Account {
  return {
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    platform: platformSchema.parse(row.platform),
    platformUserId: row.platform_user_id,
    scopes: row.scopes ? z.array(z.string()).parse(JSON.parse(row.scopes)) : [],
    updatedAt: row.updated_at,
    username: row.username,
  }
}
