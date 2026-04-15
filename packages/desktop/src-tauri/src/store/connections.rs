use rusqlite::{Connection, params};

use crate::error::AppError;
use crate::types::Platform;

#[derive(Debug, Clone)]
pub struct ChannelConnection {
    pub platform: Platform,
    pub channel_slug: String,
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn get_all(conn: &Connection) -> Result<Vec<ChannelConnection>, AppError> {
    let mut stmt = conn.prepare("SELECT platform, channel_slug FROM channel_connections")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut result = Vec::new();
    for row in rows {
        let (platform_str, channel_slug) = row?;
        let platform: Platform = serde_json::from_str(&format!("\"{platform_str}\""))?;
        result.push(ChannelConnection {
            platform,
            channel_slug,
        });
    }
    Ok(result)
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn upsert(conn: &Connection, platform: Platform, channel_slug: &str) -> Result<(), AppError> {
    let platform_str = platform_to_str(platform)?;
    conn.execute(
        "INSERT OR REPLACE INTO channel_connections (platform, channel_slug) VALUES (?1, ?2)",
        params![platform_str, channel_slug],
    )?;
    Ok(())
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn delete(conn: &Connection, platform: Platform, channel_slug: &str) -> Result<(), AppError> {
    let platform_str = platform_to_str(platform)?;
    conn.execute(
        "DELETE FROM channel_connections WHERE platform = ?1 AND channel_slug = ?2",
        params![platform_str, channel_slug],
    )?;
    Ok(())
}

fn platform_to_str(platform: Platform) -> Result<String, AppError> {
    let s = serde_json::to_string(&platform)?;
    Ok(s.trim_matches('"').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE channel_connections (
                platform TEXT NOT NULL,
                channel_slug TEXT NOT NULL,
                PRIMARY KEY (platform, channel_slug)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_upsert_and_get_all() {
        let conn = make_conn();
        upsert(&conn, Platform::Twitch, "streamer1").unwrap();
        upsert(&conn, Platform::Kick, "streamer2").unwrap();
        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_upsert_idempotent() {
        let conn = make_conn();
        upsert(&conn, Platform::Twitch, "streamer1").unwrap();
        upsert(&conn, Platform::Twitch, "streamer1").unwrap();
        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_delete() {
        let conn = make_conn();
        upsert(&conn, Platform::Twitch, "streamer1").unwrap();
        delete(&conn, Platform::Twitch, "streamer1").unwrap();
        let all = get_all(&conn).unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn test_delete_nonexistent() {
        let conn = make_conn();
        delete(&conn, Platform::Twitch, "nobody").unwrap();
    }
}
