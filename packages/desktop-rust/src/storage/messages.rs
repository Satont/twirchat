use crate::protocol::rpc::{UserChatHistoryCursor, UserChatHistoryPage};
use crate::protocol::types::{ChatMessageType, NormalizedChatMessage, Platform};
use crate::storage::StorageResult;
use crate::storage::accounts::platform_to_str;
use crate::storage::db::{Connection, Param, Row};

const DEFAULT_LOAD_COUNT: u64 = 100;
const DEFAULT_USER_HISTORY_LOAD_COUNT: u64 = 50;
const MAX_USER_HISTORY_LOAD_COUNT: u64 = 100;
const MAX_STORED: i64 = 1000;

pub struct MessageStore<'a> {
    conn: &'a Connection,
}

impl<'a> MessageStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get_recent(&self, limit: Option<u64>) -> StorageResult<Vec<NormalizedChatMessage>> {
        let limit = limit.map_or(DEFAULT_LOAD_COUNT, |value| value);
        let rows = self.conn.query(
            r#"SELECT data, created_at FROM chat_messages
               WHERE data IS NOT NULL
               ORDER BY created_at DESC
               LIMIT ?"#,
            &[Param::Integer(to_i64_or_max(limit))],
        )?;
        let mut messages: Vec<NormalizedChatMessage> =
            rows.iter().filter_map(parse_message).collect();
        messages.reverse();
        Ok(messages)
    }

    pub fn get_by_user(
        &self,
        platform: Platform,
        platform_user_id: &str,
        limit: Option<u64>,
        cursor: Option<&UserChatHistoryCursor>,
    ) -> StorageResult<UserChatHistoryPage> {
        let safe_limit = limit
            .map_or(DEFAULT_USER_HISTORY_LOAD_COUNT, |value| value)
            .clamp(1, MAX_USER_HISTORY_LOAD_COUNT);
        let cursor_created_at = cursor
            .and_then(|cursor| i64::try_from(cursor.created_at).ok())
            .map_or(0, |value| value);
        let cursor_id = cursor.map_or("", |cursor| cursor.id.as_str());
        let rows = self.conn.query(
            r#"SELECT id, data, created_at FROM chat_messages
               WHERE platform = ?
                 AND author_id = ?
                 AND data IS NOT NULL
                 AND (
                   ? IS NULL
                   OR created_at < ?
                   OR (created_at = ? AND id < ?)
                 )
               ORDER BY created_at DESC, id DESC
               LIMIT ?"#,
            &[
                Param::Text(platform_to_str(platform)),
                Param::Text(platform_user_id),
                match cursor {
                    Some(_) => Param::Integer(cursor_created_at),
                    None => Param::Null,
                },
                Param::Integer(cursor_created_at),
                Param::Integer(cursor_created_at),
                Param::Text(cursor_id),
                Param::Integer(to_i64_or_max(safe_limit + 1)),
            ],
        )?;

        let parsed_rows: Vec<ParsedMessage> =
            rows.iter().filter_map(parse_history_message).collect();
        let has_more = parsed_rows.len() > to_usize_or_max(safe_limit);
        let take = to_usize_or_max(safe_limit);
        let page_rows: Vec<ParsedMessage> = parsed_rows.into_iter().take(take).collect();
        let next_cursor = page_rows.last().map(|entry| UserChatHistoryCursor {
            created_at: u64::try_from(entry.created_at)
                .ok()
                .map_or(0, |value| value),
            id: entry.id.clone(),
        });
        let mut messages: Vec<NormalizedChatMessage> =
            page_rows.into_iter().map(|entry| entry.message).collect();
        messages.reverse();
        Ok(UserChatHistoryPage {
            messages,
            next_cursor,
            has_more,
        })
    }

    pub fn save(&self, msg: &NormalizedChatMessage) -> StorageResult<()> {
        let data = serde_json::to_string(msg)?;
        let author_name = &msg.author.display_name;
        let created_at = parse_timestamp_millis(&msg.timestamp);
        self.conn.execute(
            r#"INSERT OR REPLACE INTO chat_messages
               (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            &[
                Param::Text(&msg.id),
                Param::Text(platform_to_str(msg.platform)),
                Param::Text(&msg.channel_id),
                Param::Text(&msg.author.id),
                Param::Text(author_name),
                Param::Text(&msg.text),
                Param::Text(message_type_to_str(msg.message_type)),
                Param::Integer(created_at),
                Param::Text(&data),
            ],
        )?;
        self.conn.execute(
            r#"DELETE FROM chat_messages
               WHERE created_at <= (
                 SELECT created_at FROM chat_messages
                 ORDER BY created_at DESC
                 LIMIT 1 OFFSET ?
               )"#,
            &[Param::Integer(MAX_STORED - 1)],
        )?;
        Ok(())
    }
}

struct ParsedMessage {
    id: String,
    created_at: i64,
    message: NormalizedChatMessage,
}

fn parse_message(row: &Row) -> Option<NormalizedChatMessage> {
    let data = row.opt_text("data").ok().flatten()?;
    serde_json::from_str::<NormalizedChatMessage>(&data).ok()
}

fn parse_history_message(row: &Row) -> Option<ParsedMessage> {
    Some(ParsedMessage {
        id: row.text("id").ok()?,
        created_at: row.i64("created_at").ok()?,
        message: parse_message(row)?,
    })
}

fn parse_timestamp_millis(timestamp: &str) -> i64 {
    (match timestamp.parse::<i64>() {
        Ok(value) => value,
        Err(_) => crate::storage::now_unix(),
    }) * 1000
}

fn message_type_to_str(message_type: ChatMessageType) -> &'static str {
    match message_type {
        ChatMessageType::Message => "message",
        ChatMessageType::Action => "action",
        ChatMessageType::System => "system",
    }
}

fn to_i64_or_max(value: u64) -> i64 {
    i64::try_from(value).ok().map_or(i64::MAX, |value| value)
}

fn to_usize_or_max(value: u64) -> usize {
    usize::try_from(value)
        .ok()
        .map_or(usize::MAX, |value| value)
}
