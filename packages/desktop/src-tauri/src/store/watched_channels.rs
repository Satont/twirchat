use rusqlite::{Connection, params};
use uuid::Uuid;

use crate::error::AppError;
use crate::types::{Platform, WatchedChannel};

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn get_all(conn: &Connection) -> Result<Vec<WatchedChannel>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, channel_slug, display_name, created_at FROM watched_channels",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(RawRow {
            id: row.get(0)?,
            platform: row.get(1)?,
            channel_slug: row.get(2)?,
            display_name: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        let raw = row?;
        let platform_str = raw.platform;
        let platform: Platform = serde_json::from_str(&format!("\"{platform_str}\""))?;
        result.push(WatchedChannel {
            id: raw.id,
            platform,
            channel_slug: raw.channel_slug,
            display_name: raw.display_name,
            created_at: raw.created_at,
        });
    }
    Ok(result)
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn add(
    conn: &Connection,
    platform: Platform,
    channel_slug: &str,
    display_name: &str,
) -> Result<WatchedChannel, AppError> {
    let id = Uuid::new_v4().to_string();
    let platform_str = platform_to_str(platform)?;
    conn.execute(
        "INSERT INTO watched_channels (id, platform, channel_slug, display_name) \
         VALUES (?1, ?2, ?3, ?4)",
        params![id, platform_str, channel_slug, display_name],
    )?;
    let created_at: i64 = conn.query_row("SELECT unixepoch()", [], |row| row.get(0))?;
    Ok(WatchedChannel {
        id,
        platform,
        channel_slug: channel_slug.to_owned(),
        display_name: display_name.to_owned(),
        created_at,
    })
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure.
pub fn remove(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM watched_channels WHERE id = ?1", params![id])?;
    Ok(())
}

fn platform_to_str(platform: Platform) -> Result<String, AppError> {
    let s = serde_json::to_string(&platform)?;
    Ok(s.trim_matches('"').to_owned())
}

struct RawRow {
    id: String,
    platform: String,
    channel_slug: String,
    display_name: String,
    created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE watched_channels (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                channel_slug TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at INTEGER DEFAULT (unixepoch()),
                UNIQUE (platform, channel_slug)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_add_and_get_all() {
        let conn = make_conn();
        let ch = add(&conn, Platform::Twitch, "streamer1", "Streamer One").unwrap();
        assert!(!ch.id.is_empty());
        assert_eq!(ch.channel_slug, "streamer1");
        assert_eq!(ch.display_name, "Streamer One");

        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, ch.id);
    }

    #[test]
    fn test_remove() {
        let conn = make_conn();
        let ch = add(&conn, Platform::Twitch, "streamer1", "Streamer One").unwrap();
        remove(&conn, &ch.id).unwrap();
        let all = get_all(&conn).unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn test_remove_nonexistent() {
        let conn = make_conn();
        remove(&conn, "nonexistent-id").unwrap();
    }

    #[test]
    fn test_unique_constraint() {
        let conn = make_conn();
        add(&conn, Platform::Twitch, "streamer1", "Streamer One").unwrap();
        let result = add(&conn, Platform::Twitch, "streamer1", "Streamer One");
        assert!(result.is_err());
    }
}
