use crate::protocol::types::{Platform, WatchedChannel};
use crate::storage::accounts::{parse_platform, platform_to_str};
use crate::storage::db::{Connection, Param};
use crate::storage::{StorageResult, i64_to_u64, now_unix};

pub struct WatchedChannelsStore<'a> {
    conn: &'a Connection,
}

impl<'a> WatchedChannelsStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn find_all(&self) -> StorageResult<Vec<WatchedChannel>> {
        self.conn
            .query(
                "SELECT * FROM watched_channels ORDER BY created_at ASC",
                &[],
            )?
            .iter()
            .map(row_to_watched_channel)
            .collect()
    }

    pub fn find_by_id(&self, id: &str) -> StorageResult<Option<WatchedChannel>> {
        self.conn
            .query_one(
                "SELECT * FROM watched_channels WHERE id = ? LIMIT 1",
                &[Param::Text(id)],
            )?
            .map(|row| row_to_watched_channel(&row))
            .transpose()
    }

    pub fn upsert(
        &self,
        platform: Platform,
        channel_slug: &str,
        display_name: &str,
    ) -> StorageResult<WatchedChannel> {
        let slug = normalize_watched_channel_slug(platform, channel_slug);
        if let Some(row) = self.conn.query_one(
            "SELECT * FROM watched_channels WHERE platform = ? AND channel_slug = ? LIMIT 1",
            &[Param::Text(platform_to_str(platform)), Param::Text(&slug)],
        )? {
            let id = row.text("id")?;
            self.conn.execute(
                "UPDATE watched_channels SET display_name = ? WHERE id = ?",
                &[Param::Text(display_name), Param::Text(&id)],
            )?;
            return Ok(WatchedChannel {
                display_name: display_name.into(),
                ..row_to_watched_channel(&row)?
            });
        }

        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_unix();
        self.conn.execute(
            "INSERT INTO watched_channels (id, platform, channel_slug, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
            &[
                Param::Text(&id),
                Param::Text(platform_to_str(platform)),
                Param::Text(&slug),
                Param::Text(display_name),
                Param::Integer(created_at),
            ],
        )?;
        Ok(WatchedChannel {
            id,
            platform,
            channel_slug: slug,
            display_name: display_name.into(),
            created_at: i64_to_u64(created_at),
        })
    }

    pub fn remove(&self, id: &str) -> StorageResult<()> {
        self.conn.execute(
            "DELETE FROM watched_channels WHERE id = ?",
            &[Param::Text(id)],
        )?;
        Ok(())
    }
}

pub fn normalize_watched_channel_slug(platform: Platform, channel_slug: &str) -> String {
    let trimmed = channel_slug.trim();
    match platform {
        Platform::Twitch => trimmed.trim_start_matches('#').to_lowercase(),
        Platform::Kick => trimmed.trim_start_matches('@').to_lowercase(),
        Platform::Youtube => trimmed.to_lowercase(),
    }
}

fn row_to_watched_channel(row: &crate::storage::db::Row) -> StorageResult<WatchedChannel> {
    Ok(WatchedChannel {
        id: row.text("id")?,
        platform: parse_platform(&row.text("platform")?),
        channel_slug: row.text("channel_slug")?,
        display_name: row.text("display_name")?,
        created_at: i64_to_u64(row.i64("created_at")?),
    })
}
