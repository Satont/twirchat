use crate::storage::StorageResult;
use crate::storage::db::{Connection, Param};

const SECRET_KEY: &str = "client_secret";

pub struct ClientIdentityStore<'a> {
    conn: &'a Connection,
}

impl<'a> ClientIdentityStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get_client_secret(&self) -> StorageResult<String> {
        if let Some(row) = self.conn.query_one(
            "SELECT value FROM client_identity WHERE key = ? LIMIT 1",
            &[Param::Text(SECRET_KEY)],
        )? {
            return row.text("value").map_err(Into::into);
        }

        let secret = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO client_identity (key, value) VALUES (?, ?)",
            &[Param::Text(SECRET_KEY), Param::Text(&secret)],
        )?;
        Ok(secret)
    }
}
