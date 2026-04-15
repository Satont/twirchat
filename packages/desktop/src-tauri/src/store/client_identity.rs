use crate::AppError;
use rusqlite::Connection;
use uuid::Uuid;

const SECRET_KEY: &str = "client_secret";

/// Returns the persistent client-secret UUID for this installation.
///
/// If no row exists, a new UUID v4 is generated and stored before returning.
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn get_or_create(conn: &Connection) -> Result<String, AppError> {
    let mut stmt = conn.prepare("SELECT value FROM client_identity WHERE key = ?")?;
    let mut rows = stmt.query([SECRET_KEY])?;

    if let Some(row) = rows.next()? {
        let value: String = row.get(0)?;
        return Ok(value);
    }

    let secret = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO client_identity (key, value) VALUES (?1, ?2)",
        rusqlite::params![SECRET_KEY, secret],
    )?;
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        db::init_db(&conn).expect("init_db");
        conn
    }

    #[test]
    fn creates_secret_on_first_call() {
        let conn = setup();
        let secret = get_or_create(&conn).expect("get_or_create");
        assert!(!secret.is_empty());
        assert!(Uuid::parse_str(&secret).is_ok(), "should be a valid UUID");
    }

    #[test]
    fn returns_same_secret_on_subsequent_calls() {
        let conn = setup();
        let first = get_or_create(&conn).expect("first call");
        let second = get_or_create(&conn).expect("second call");
        assert_eq!(first, second, "secret must not change between calls");
    }

    #[test]
    fn does_not_overwrite_existing_secret() {
        let conn = setup();
        let existing = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        conn.execute(
            "INSERT INTO client_identity (key, value) VALUES ('client_secret', ?1)",
            rusqlite::params![existing],
        )
        .expect("pre-insert");

        let result = get_or_create(&conn).expect("get_or_create with existing");
        assert_eq!(result, existing);
    }
}
