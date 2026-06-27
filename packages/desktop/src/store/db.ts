import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getDbPath } from '../runtime-config'
import { logger } from '@twirchat/shared'

const log = logger('db')

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function initDb(path: string = getDbPath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  runMigrations(db)

  _db = db
  return db
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_identity (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.exec(`
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
       data TEXT
     )
   `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user_history
    ON chat_messages(platform, author_id, created_at DESC, id DESC)
  `)

  // Migration: add data column to existing installations
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN data TEXT`)
  } catch {
    // Column already exists — ignore
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_connections (
      platform TEXT NOT NULL,
      channel_slug TEXT NOT NULL,
      PRIMARY KEY (platform, channel_slug)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE (platform, channel_slug)
    )
  `)

  db.exec(`
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
