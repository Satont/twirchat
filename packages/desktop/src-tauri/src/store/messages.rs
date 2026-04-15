use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::types::{
    Emote, MessageType, NormalizedChatMessage, NormalizedChatMessageAuthor,
    NormalizedChatMessageReply,
};

/// JSON blob stored in the `data` column of `chat_messages`.
#[derive(Debug, Serialize, Deserialize)]
struct MessageData {
    author: NormalizedChatMessageAuthor,
    emotes: Vec<Emote>,
    reply: Option<NormalizedChatMessageReply>,
}

/// Persist a [`NormalizedChatMessage`] to `chat_messages`.
///
/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON serialisation
/// failure.
pub fn save_message(conn: &Connection, msg: &NormalizedChatMessage) -> Result<(), AppError> {
    let platform = serde_json::to_string(&msg.platform)?;
    // Strip surrounding quotes that serde_json adds for string enums
    let platform = platform.trim_matches('"');

    let msg_type = serde_json::to_string(&msg.message_type)?;
    let msg_type = msg_type.trim_matches('"');

    // Parse ISO 8601 timestamp to Unix seconds (i64). Fall back to 0 on parse error rather than
    // panicking so a malformed timestamp doesn't crash the whole store operation.
    let created_at: i64 = parse_timestamp(&msg.timestamp);

    let data = MessageData {
        author: msg.author.clone(),
        emotes: msg.emotes.clone(),
        reply: msg.reply.clone(),
    };
    let data_json = serde_json::to_string(&data)?;

    conn.execute(
        "INSERT OR REPLACE INTO chat_messages \
         (id, platform, channel_id, author_id, author_name, text, type, created_at, data) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            msg.id,
            platform,
            msg.channel_id,
            msg.author.id,
            msg.author.display_name,
            msg.text,
            msg_type,
            created_at,
            data_json,
        ],
    )?;
    Ok(())
}

/// Retrieve the most recent `limit` messages for a channel, ordered newest-first.
///
/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON
/// deserialisation failure.
pub fn get_recent(
    conn: &Connection,
    channel_id: &str,
    limit: u32,
) -> Result<Vec<NormalizedChatMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, channel_id, text, type, created_at, data \
         FROM chat_messages \
         WHERE channel_id = ?1 \
         ORDER BY created_at DESC \
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![channel_id, limit], |row| {
        Ok(RawMessageRow {
            id: row.get(0)?,
            platform: row.get(1)?,
            channel_id: row.get(2)?,
            text: row.get(3)?,
            msg_type: row.get(4)?,
            created_at: row.get(5)?,
            data: row.get(6)?,
        })
    })?;

    let mut messages = Vec::new();
    for row in rows {
        let raw = row?;
        let msg = reconstruct_message(raw)?;
        messages.push(msg);
    }
    Ok(messages)
}

/// Retrieve the most recent `limit` messages across all channels, ordered newest-first.
///
/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure or [`AppError::Serde`] on JSON
/// deserialisation failure.
pub fn get_recent_all(
    conn: &Connection,
    limit: u32,
) -> Result<Vec<NormalizedChatMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, platform, channel_id, text, type, created_at, data \
         FROM chat_messages \
         ORDER BY created_at DESC \
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(RawMessageRow {
            id: row.get(0)?,
            platform: row.get(1)?,
            channel_id: row.get(2)?,
            text: row.get(3)?,
            msg_type: row.get(4)?,
            created_at: row.get(5)?,
            data: row.get(6)?,
        })
    })?;

    let mut messages = Vec::new();
    for row in rows {
        let raw = row?;
        let msg = reconstruct_message(raw)?;
        messages.push(msg);
    }
    Ok(messages)
}

/// Delete all messages belonging to `channel_id`.
///
/// # Errors
///
/// Returns [`AppError::Database`] on `SQLite` failure.
pub fn clear_channel(conn: &Connection, channel_id: &str) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM chat_messages WHERE channel_id = ?1",
        params![channel_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

struct RawMessageRow {
    id: String,
    platform: String,
    channel_id: String,
    text: String,
    msg_type: String,
    created_at: i64,
    data: Option<String>,
}

fn reconstruct_message(raw: RawMessageRow) -> Result<NormalizedChatMessage, AppError> {
    let platform_str = &raw.platform;
    let platform = serde_json::from_str(&format!("\"{platform_str}\""))?;
    let msg_type_str = &raw.msg_type;
    let message_type: MessageType = serde_json::from_str(&format!("\"{msg_type_str}\""))?;

    let (author, emotes, reply) = if let Some(data_json) = raw.data {
        let data: MessageData = serde_json::from_str(&data_json)?;
        (data.author, data.emotes, data.reply)
    } else {
        // Legacy rows without a data column: reconstruct a minimal author
        let author = NormalizedChatMessageAuthor {
            id: String::new(),
            username: None,
            display_name: String::new(),
            color: None,
            avatar_url: None,
            badges: vec![],
        };
        (author, vec![], None)
    };

    let timestamp = format_timestamp(raw.created_at);

    Ok(NormalizedChatMessage {
        id: raw.id,
        platform,
        channel_id: raw.channel_id,
        author,
        text: raw.text,
        emotes,
        timestamp,
        message_type,
        reply,
    })
}

/// Parse an ISO 8601 / RFC 3339 string to Unix seconds.
/// Falls back to 0 on any parse error.
fn parse_timestamp(ts: &str) -> i64 {
    // Try parsing as a plain integer first (already a unix timestamp)
    if let Ok(n) = ts.parse::<i64>() {
        return n;
    }
    // Try RFC 3339 parsing via manual approach (no chrono dep)
    // Format: 2024-01-15T12:34:56Z or 2024-01-15T12:34:56.000Z
    parse_rfc3339(ts).unwrap_or(0)
}

/// Very lightweight RFC 3339 parser (subset: no timezone offset).
fn parse_rfc3339(s: &str) -> Option<i64> {
    // Strip trailing Z or timezone
    let s = s.trim_end_matches('Z');
    // Split off fractional seconds
    let s = s.split('.').next()?;
    // Expect "YYYY-MM-DDTHH:MM:SS"
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let year: i64 = d.next()?.parse().ok()?;
    let month: i64 = d.next()?.parse().ok()?;
    let day: i64 = d.next()?.parse().ok()?;
    let mut t = time.split(':');
    let hour: i64 = t.next()?.parse().ok()?;
    let min: i64 = t.next()?.parse().ok()?;
    let sec: i64 = t.next()?.parse().ok()?;

    // Days since Unix epoch via a simple Gregorian formula
    let days = days_from_civil(year, month, day);
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}

/// Gregorian calendar days since 1970-01-01 (algorithm from Howard Hinnant).
const fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn format_timestamp(unix_secs: i64) -> String {
    // Produce a minimal ISO 8601 UTC string from Unix seconds
    let (y, mo, d, h, mi, s) = unix_to_parts(unix_secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Decompose Unix seconds into (year, month, day, hour, minute, second).
#[allow(clippy::many_single_char_names)]
const fn unix_to_parts(secs: i64) -> (i64, i64, i64, i64, i64, i64) {
    let s = secs % 86400;
    let days = secs / 86400;
    let (h, rem) = (s / 3600, s % 3600);
    let (mi, sec) = (rem / 60, rem % 60);

    // Civil date from days (Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = mp + if mp < 10 { 3 } else { -9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, mi, sec)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Badge, Platform};
    use rusqlite::Connection;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_messages (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                author_name TEXT NOT NULL,
                text TEXT NOT NULL,
                type TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                data TEXT
            );",
        )
        .unwrap();
        conn
    }

    fn sample_msg() -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: "msg1".into(),
            platform: Platform::Twitch,
            channel_id: "ch1".into(),
            author: NormalizedChatMessageAuthor {
                id: "u1".into(),
                username: Some("user1".into()),
                display_name: "User One".into(),
                color: Some("#ff0000".into()),
                avatar_url: None,
                badges: vec![Badge {
                    id: "b1".into(),
                    badge_type: "subscriber".into(),
                    text: "Sub".into(),
                    image_url: None,
                }],
            },
            text: "Hello world".into(),
            emotes: vec![],
            timestamp: "2024-01-15T12:00:00Z".into(),
            message_type: MessageType::Message,
            reply: None,
        }
    }

    #[test]
    fn test_save_and_get_recent() {
        let conn = make_conn();
        let msg = sample_msg();
        save_message(&conn, &msg).unwrap();

        let msgs = get_recent(&conn, "ch1", 10).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "msg1");
        assert_eq!(msgs[0].text, "Hello world");
        assert_eq!(msgs[0].author.display_name, "User One");
    }

    #[test]
    fn test_get_recent_limit() {
        let conn = make_conn();
        for i in 0..5u8 {
            let mut msg = sample_msg();
            msg.id = format!("msg{i}");
            msg.timestamp = format!("2024-01-15T12:00:0{i}Z");
            save_message(&conn, &msg).unwrap();
        }
        let msgs = get_recent(&conn, "ch1", 3).unwrap();
        assert_eq!(msgs.len(), 3);
    }

    #[test]
    fn test_clear_channel() {
        let conn = make_conn();
        let msg = sample_msg();
        save_message(&conn, &msg).unwrap();
        clear_channel(&conn, "ch1").unwrap();
        let msgs = get_recent(&conn, "ch1", 10).unwrap();
        assert!(msgs.is_empty());
    }

    #[test]
    fn test_parse_timestamp_rfc3339() {
        let ts = parse_timestamp("2024-01-15T12:00:00Z");
        assert!(ts > 0);
    }

    #[test]
    fn test_parse_timestamp_integer() {
        assert_eq!(parse_timestamp("1705320000"), 1_705_320_000);
    }

    #[test]
    fn test_roundtrip_timestamp() {
        let ts: i64 = 1_705_320_000;
        let s = format_timestamp(ts);
        let back = parse_timestamp(&s);
        assert_eq!(back, ts);
    }
}
