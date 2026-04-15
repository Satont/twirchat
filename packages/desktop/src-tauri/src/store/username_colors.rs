use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::types::Platform;

/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn get(
    conn: &Connection,
    platform: Platform,
    username: &str,
) -> Result<Option<String>, AppError> {
    conn.query_row(
        "SELECT json_extract(data, '$.author.color')
         FROM chat_messages
         WHERE platform = ?1
           AND (
             lower(json_extract(data, '$.author.username')) = lower(?2)
             OR lower(author_name) = lower(?2)
           )
           AND json_extract(data, '$.author.color') IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1",
        params![platform_to_str(platform), username],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(AppError::from)
}

const fn platform_to_str(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::YouTube => "youtube",
        Platform::Kick => "kick",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db;

    #[test]
    fn gets_latest_color_by_username() {
        let conn = Connection::open_in_memory().unwrap();
        db::init_db(&conn).unwrap();

        conn.execute(
            "INSERT INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                "msg-1",
                "twitch",
                "chan",
                "user-1",
                "SomeUser",
                "hello",
                "message",
                100,
                r##"{"author":{"id":"user-1","username":"someuser","displayName":"SomeUser","color":"#123456","avatarUrl":null,"badges":[]},"emotes":[],"reply":null}"##,
            ],
        )
        .unwrap();

        let color = get(&conn, Platform::Twitch, "SomeUser").unwrap();
        assert_eq!(color.as_deref(), Some("#123456"));
    }
}
