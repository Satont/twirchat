PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client_identity (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_history
ON chat_messages(platform, author_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS channel_connections (
  platform TEXT NOT NULL,
  channel_slug TEXT NOT NULL,
  PRIMARY KEY (platform, channel_slug)
);

CREATE TABLE IF NOT EXISTS watched_channels (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  channel_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE (platform, channel_slug)
);

CREATE TABLE IF NOT EXISTS user_aliases (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (platform, platform_user_id)
);
