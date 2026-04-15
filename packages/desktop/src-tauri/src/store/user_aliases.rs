use std::collections::HashMap;

use rusqlite::{Connection, params};

use crate::error::AppError;
use crate::types::Platform;

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn get_all(conn: &Connection) -> Result<HashMap<(Platform, String), String>, AppError> {
    let mut stmt = conn.prepare("SELECT platform, platform_user_id, alias FROM user_aliases")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (platform_str, user_id, alias) = row?;
        let platform: Platform = serde_json::from_str(&format!("\"{platform_str}\""))?;
        map.insert((platform, user_id), alias);
    }
    Ok(map)
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn set_alias(
    conn: &Connection,
    platform: Platform,
    platform_user_id: &str,
    alias: &str,
) -> Result<(), AppError> {
    let platform_str = platform_to_str(platform)?;
    conn.execute(
        "INSERT INTO user_aliases (platform, platform_user_id, alias) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(platform, platform_user_id) \
         DO UPDATE SET alias = ?3, updated_at = unixepoch()",
        params![platform_str, platform_user_id, alias],
    )?;
    Ok(())
}

/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON failure.
pub fn remove_alias(
    conn: &Connection,
    platform: Platform,
    platform_user_id: &str,
) -> Result<(), AppError> {
    let platform_str = platform_to_str(platform)?;
    conn.execute(
        "DELETE FROM user_aliases WHERE platform = ?1 AND platform_user_id = ?2",
        params![platform_str, platform_user_id],
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
            "CREATE TABLE user_aliases (
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                alias TEXT NOT NULL,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch()),
                PRIMARY KEY (platform, platform_user_id)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_set_and_get_all() {
        let conn = make_conn();
        set_alias(&conn, Platform::Twitch, "user123", "CoolDude").unwrap();
        let map = get_all(&conn).unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(
            map.get(&(Platform::Twitch, "user123".to_owned())),
            Some(&"CoolDude".to_owned())
        );
    }

    #[test]
    fn test_set_alias_upsert() {
        let conn = make_conn();
        set_alias(&conn, Platform::Twitch, "user123", "CoolDude").unwrap();
        set_alias(&conn, Platform::Twitch, "user123", "EvenCooler").unwrap();
        let map = get_all(&conn).unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(
            map.get(&(Platform::Twitch, "user123".to_owned())),
            Some(&"EvenCooler".to_owned())
        );
    }

    #[test]
    fn test_remove_alias() {
        let conn = make_conn();
        set_alias(&conn, Platform::Twitch, "user123", "CoolDude").unwrap();
        remove_alias(&conn, Platform::Twitch, "user123").unwrap();
        let map = get_all(&conn).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn test_remove_nonexistent() {
        let conn = make_conn();
        remove_alias(&conn, Platform::Twitch, "nobody").unwrap();
    }

    #[test]
    fn test_multiple_platforms() {
        let conn = make_conn();
        set_alias(&conn, Platform::Twitch, "user1", "TwitchAlias").unwrap();
        set_alias(&conn, Platform::Kick, "user1", "KickAlias").unwrap();
        let map = get_all(&conn).unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(
            map.get(&(Platform::Twitch, "user1".to_owned())),
            Some(&"TwitchAlias".to_owned())
        );
        assert_eq!(
            map.get(&(Platform::Kick, "user1".to_owned())),
            Some(&"KickAlias".to_owned())
        );
    }
}
