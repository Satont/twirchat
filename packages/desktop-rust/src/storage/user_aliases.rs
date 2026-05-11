use crate::protocol::rpc::UserAlias;
use crate::protocol::types::Platform;
use crate::storage::accounts::{parse_platform, platform_to_str};
use crate::storage::db::{Connection, Param};
use crate::storage::{StorageResult, i64_to_u64};

pub struct UserAliasStore<'a> {
    conn: &'a Connection,
}

impl<'a> UserAliasStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn find_all(&self) -> StorageResult<Vec<UserAlias>> {
        self.conn
            .query("SELECT * FROM user_aliases", &[])?
            .iter()
            .map(row_to_alias)
            .collect()
    }

    pub fn upsert(
        &self,
        platform: Platform,
        platform_user_id: &str,
        alias: &str,
    ) -> StorageResult<()> {
        self.conn.execute(
            r#"INSERT INTO user_aliases (platform, platform_user_id, alias)
               VALUES (?, ?, ?)
               ON CONFLICT(platform, platform_user_id) DO UPDATE SET
                 alias = ?,
                 updated_at = unixepoch()"#,
            &[
                Param::Text(platform_to_str(platform)),
                Param::Text(platform_user_id),
                Param::Text(alias),
                Param::Text(alias),
            ],
        )?;
        Ok(())
    }

    pub fn remove(&self, platform: Platform, platform_user_id: &str) -> StorageResult<()> {
        self.conn.execute(
            "DELETE FROM user_aliases WHERE platform = ? AND platform_user_id = ?",
            &[
                Param::Text(platform_to_str(platform)),
                Param::Text(platform_user_id),
            ],
        )?;
        Ok(())
    }
}

fn row_to_alias(row: &crate::storage::db::Row) -> StorageResult<UserAlias> {
    Ok(UserAlias {
        platform: parse_platform(&row.text("platform")?),
        platform_user_id: row.text("platform_user_id")?,
        alias: row.text("alias")?,
        created_at: i64_to_u64(row.i64("created_at")?),
        updated_at: i64_to_u64(row.i64("updated_at")?),
    })
}
