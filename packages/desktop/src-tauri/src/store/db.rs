use crate::AppError;
use rusqlite::Connection;
use std::path::Path;

/// Opens a `SQLite` database at `path` with WAL mode and foreign key enforcement.
///
/// # Errors
///
/// Returns [`AppError::Database`] if the connection or pragma execution fails.
pub fn open_db(path: &Path) -> Result<Connection, AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Runs all `CREATE TABLE IF NOT EXISTS` migrations against `conn`.
///
/// # Errors
///
/// Returns [`AppError::Database`] if any DDL statement fails.
pub fn init_db(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS client_identity (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id               TEXT PRIMARY KEY,
            platform         TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            username         TEXT NOT NULL,
            display_name     TEXT NOT NULL,
            avatar_url       TEXT,
            access_token     TEXT NOT NULL,
            refresh_token    TEXT,
            expires_at       INTEGER,
            scopes           TEXT,
            created_at       INTEGER DEFAULT (unixepoch()),
            updated_at       INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id         TEXT PRIMARY KEY,
            platform   TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            author_id  TEXT NOT NULL,
            author_name TEXT NOT NULL,
            text       TEXT NOT NULL,
            type       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            data       TEXT
        );

        CREATE TABLE IF NOT EXISTS channel_connections (
            platform     TEXT NOT NULL,
            channel_slug TEXT NOT NULL,
            PRIMARY KEY (platform, channel_slug)
        );

        CREATE TABLE IF NOT EXISTS watched_channels (
            id           TEXT PRIMARY KEY,
            platform     TEXT NOT NULL,
            channel_slug TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at   INTEGER DEFAULT (unixepoch()),
            UNIQUE (platform, channel_slug)
        );

        CREATE TABLE IF NOT EXISTS user_aliases (
            platform         TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            alias            TEXT NOT NULL,
            created_at       INTEGER DEFAULT (unixepoch()),
            updated_at       INTEGER DEFAULT (unixepoch()),
            PRIMARY KEY (platform, platform_user_id)
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        conn
    }

    #[test]
    fn init_db_creates_tables() {
        let conn = in_memory();
        init_db(&conn).expect("init_db should succeed");

        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                .expect("prepare");
            stmt.query_map([], |row| row.get(0))
                .expect("query")
                .map(|r| r.expect("row"))
                .collect()
        };

        for expected in &[
            "client_identity",
            "accounts",
            "settings",
            "chat_messages",
            "channel_connections",
            "watched_channels",
            "user_aliases",
        ] {
            assert!(
                tables.iter().any(|t| t == expected),
                "table {expected} missing; found: {tables:?}"
            );
        }
    }

    #[test]
    fn init_db_is_idempotent() {
        let conn = in_memory();
        init_db(&conn).expect("first call");
        init_db(&conn).expect("second call should not error");
    }
}
