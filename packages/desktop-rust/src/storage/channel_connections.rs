use crate::protocol::types::Platform;
use crate::storage::StorageResult;
use crate::storage::accounts::{parse_platform, platform_to_str};
use crate::storage::db::{Connection, Param};
use std::collections::BTreeMap;

pub struct ChannelConnectionsStore<'a> {
    conn: &'a Connection,
}

impl<'a> ChannelConnectionsStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn save(&self, platform: Platform, channel_slug: &str) -> StorageResult<()> {
        let slug = channel_slug.to_lowercase();
        self.conn.execute(
            "INSERT OR IGNORE INTO channel_connections (platform, channel_slug) VALUES (?, ?)",
            &[Param::Text(platform_to_str(platform)), Param::Text(&slug)],
        )?;
        Ok(())
    }

    pub fn remove(&self, platform: Platform, channel_slug: &str) -> StorageResult<()> {
        let slug = channel_slug.to_lowercase();
        self.conn.execute(
            "DELETE FROM channel_connections WHERE platform = ? AND channel_slug = ?",
            &[Param::Text(platform_to_str(platform)), Param::Text(&slug)],
        )?;
        Ok(())
    }

    pub fn find_all(&self) -> StorageResult<BTreeMap<Platform, Vec<String>>> {
        let rows = self.conn.query(
            "SELECT platform, channel_slug FROM channel_connections ORDER BY platform, channel_slug",
            &[],
        )?;
        let mut result: BTreeMap<Platform, Vec<String>> = BTreeMap::new();
        for row in rows {
            result
                .entry(parse_platform(&row.text("platform")?))
                .or_default()
                .push(row.text("channel_slug")?);
        }
        Ok(result)
    }
}
