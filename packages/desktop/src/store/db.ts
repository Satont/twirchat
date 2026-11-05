import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { logger } from '@twirchat/shared'

import { getDbPath } from '../runtime-config'

const log = logger('db')

let _db: Database | null = null

export function getDb(): Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function initDb(path: string = getDbPath()): Database {
  const db = openDatabase(path)
  _db = db
  return db
}

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path, { create: true })
  if (typeof db.function !== 'function') {
    db.close()
    throw new Error(
      `TwirChat requires Bun 1.4.4 or newer for Unicode chat history. Running Bun ${Bun.version}.`,
    )
  }
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.function('twir_casefold', (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : '',
  )

  try {
    runMigrations(db)
  } catch (error) {
    db.close()
    throw error
  }

  return db
}

function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS client_identity (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      scopes TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS active_accounts (
      platform TEXT PRIMARY KEY CHECK (platform IN ('twitch', 'youtube', 'kick')),
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
    )`)
    // Seed only missing selections. A saved NULL deliberately means anonymous.
    db.run(`INSERT OR IGNORE INTO active_accounts(platform, account_id)
      SELECT platform, id FROM accounts AS candidate
      WHERE platform IN ('twitch', 'youtube', 'kick') AND id = (
        SELECT id FROM accounts WHERE platform = candidate.platform
        ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT 1
      )`)
  })()

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT NOT NULL,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
       data TEXT,
       PRIMARY KEY (platform, channel_id, id)
     )
   `)

  db.transaction(() => {
    const columns = db
      .query<{ name: string; pk: number }, []>('PRAGMA table_info(chat_messages)')
      .all()
    if (!columns.some((column) => column.name === 'data'))
      db.run('ALTER TABLE chat_messages ADD COLUMN data TEXT')
    const primary = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name)
    if (primary.join(',') !== 'platform,channel_id,id') {
      db.run(`CREATE TABLE chat_messages_composite (
        id TEXT NOT NULL, platform TEXT NOT NULL, channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL,
        type TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT,
        PRIMARY KEY (platform, channel_id, id)
      )`)
      db.run(`INSERT INTO chat_messages_composite (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
        SELECT id, platform, channel_id, author_id, author_name, text, type, created_at, data FROM chat_messages`)
      db.run('DROP TABLE chat_messages')
      db.run('ALTER TABLE chat_messages_composite RENAME TO chat_messages')
    }
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_user_history ON chat_messages(platform, author_id, created_at DESC, id DESC, channel_id DESC)`,
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_history ON chat_messages(platform, channel_id, created_at DESC, id DESC)`,
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_identity ON chat_messages(platform, lower(ltrim(channel_id, '#@')), id)`,
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_chronology ON chat_messages(created_at DESC, id DESC, platform DESC, channel_id DESC)`,
    )
  })()

  db.run(`
    CREATE TABLE IF NOT EXISTS channel_connections (
      platform TEXT NOT NULL,
      channel_slug TEXT NOT NULL,
      PRIMARY KEY (platform, channel_slug)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS watched_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE (platform, channel_slug)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_watched_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_slug TEXT NOT NULL,
      transport_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE (platform, channel_slug)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS user_aliases (
      platform TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (platform, platform_user_id)
    )
  `)

  log.info('Migrations applied')
}
