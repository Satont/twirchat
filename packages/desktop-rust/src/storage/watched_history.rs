use crate::protocol::types::NormalizedChatMessage;
use crate::storage::db::Connection;
use crate::storage::settings::SettingsStore;
use crate::storage::{StorageResult, now_millis};

pub struct WatchedHistoryStore<'a> {
    conn: &'a Connection,
}

impl<'a> WatchedHistoryStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(&self, watched_channel_id: &str) -> StorageResult<Vec<NormalizedChatMessage>> {
        match SettingsStore::new(self.conn).get_json(&history_key(watched_channel_id))? {
            Some(value) => serde_json::from_value(value).map_err(Into::into),
            None => Ok(Vec::new()),
        }
    }

    pub fn set(
        &self,
        watched_channel_id: &str,
        messages: &[NormalizedChatMessage],
    ) -> StorageResult<()> {
        let mut messages = messages.to_vec();
        messages.sort_by_key(history_sort_key);
        SettingsStore::new(self.conn).set_json(
            &history_key(watched_channel_id),
            &serde_json::to_value(messages)?,
        )
    }

    pub fn remove(&self, watched_channel_id: &str) -> StorageResult<()> {
        SettingsStore::new(self.conn).set_json(
            &history_key(watched_channel_id),
            &serde_json::Value::Array(Vec::new()),
        )
    }
}

fn history_key(watched_channel_id: &str) -> String {
    format!("watched_channel_history_v1_{watched_channel_id}")
}

fn history_sort_key(message: &NormalizedChatMessage) -> u64 {
    message
        .timestamp
        .parse::<u64>()
        .ok()
        .unwrap_or_else(now_millis)
}
