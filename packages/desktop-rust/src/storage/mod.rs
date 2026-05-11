//! SQLite storage compatible with the current Vue desktop schema.

pub mod accounts;
pub mod channel_connections;
pub mod client_identity;
pub mod crypto;
pub mod db;
pub mod messages;
pub mod settings;
pub mod user_aliases;
pub mod watched_channels;
pub mod watched_layout;

use db::{Connection, DbError};
use std::error::Error;
use std::fmt;
use std::fs;
use std::path::Path;

pub use crate::protocol::rpc::UserAlias;
pub use accounts::{AccountRecord, AccountWithTokenState, TokenPair, TokenState};
pub use channel_connections::ChannelConnectionsStore;
pub use client_identity::ClientIdentityStore;
pub use messages::MessageStore;
pub use settings::SettingsStore;
pub use user_aliases::UserAliasStore;
pub use watched_channels::WatchedChannelsStore;
pub use watched_layout::WatchedLayoutStore;

#[derive(Debug)]
pub enum StorageError {
    Db(DbError),
    Json(serde_json::Error),
    Io(std::io::Error),
    TokenDecode { account_id: String },
    InvalidLayout(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Db(source) => write!(f, "storage database error: {source}"),
            Self::Json(source) => write!(f, "storage JSON error: {source}"),
            Self::Io(source) => write!(f, "storage IO error: {source}"),
            Self::TokenDecode { account_id } => {
                write!(f, "stored token for account {account_id} cannot be decoded")
            }
            Self::InvalidLayout(message) => write!(f, "invalid watched-channel layout: {message}"),
        }
    }
}

impl Error for StorageError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Db(source) => Some(source),
            Self::Json(source) => Some(source),
            Self::Io(source) => Some(source),
            Self::TokenDecode { .. } | Self::InvalidLayout(_) => None,
        }
    }
}

impl From<DbError> for StorageError {
    fn from(value: DbError) -> Self {
        Self::Db(value)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open(path: &Path) -> StorageResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn open_or_recover(path: &Path) -> StorageResult<Self> {
        match Self::open(path) {
            Ok(storage) => Ok(storage),
            Err(_) => {
                if path.exists() {
                    let corrupt_path = path.with_extension("corrupt");
                    fs::rename(path, corrupt_path)?;
                }
                Self::open(path)
            }
        }
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn accounts(&self) -> accounts::AccountsStore<'_> {
        accounts::AccountsStore::new(&self.conn)
    }

    pub fn client_identity(&self) -> ClientIdentityStore<'_> {
        ClientIdentityStore::new(&self.conn)
    }

    pub fn settings(&self) -> SettingsStore<'_> {
        SettingsStore::new(&self.conn)
    }

    pub fn channels(&self) -> ChannelConnectionsStore<'_> {
        ChannelConnectionsStore::new(&self.conn)
    }

    pub fn watched_channels(&self) -> WatchedChannelsStore<'_> {
        WatchedChannelsStore::new(&self.conn)
    }

    pub fn watched_layout(&self) -> WatchedLayoutStore<'_> {
        WatchedLayoutStore::new(&self.conn)
    }

    pub fn messages(&self) -> MessageStore<'_> {
        MessageStore::new(&self.conn)
    }

    pub fn user_aliases(&self) -> UserAliasStore<'_> {
        UserAliasStore::new(&self.conn)
    }
}

pub fn migrate(conn: &Connection) -> StorageResult<()> {
    conn.execute_batch(
        r#"
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
        "#,
    )?;

    if let Err(DbError::Sqlite(message)) =
        conn.execute_batch("ALTER TABLE chat_messages ADD COLUMN data TEXT;")
        && !message.to_lowercase().contains("duplicate column")
    {
        return Err(StorageError::Db(DbError::Sqlite(message)));
    }

    Ok(())
}

pub(crate) fn now_unix() -> i64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_secs())
            .ok()
            .map_or(i64::MAX, |value| value),
        Err(_) => 0,
    }
}

pub(crate) fn now_millis() -> u64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => u64::try_from(duration.as_millis())
            .ok()
            .map_or(u64::MAX, |value| value),
        Err(_) => 0,
    }
}

pub(crate) fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).ok().map_or(0, |value| value)
}

pub(crate) fn merge_json(target: &mut serde_json::Value, source: &serde_json::Value) {
    match (target, source) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(source_map)) => {
            for (key, value) in source_map {
                if value.is_null() {
                    continue;
                }
                match target_map.get_mut(key) {
                    Some(target_value) => merge_json(target_value, value),
                    None => {
                        target_map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target_value, source_value) => {
            *target_value = source_value.clone();
        }
    }
}
