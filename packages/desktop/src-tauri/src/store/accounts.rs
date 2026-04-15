use crate::{Account, AppError, Platform, store::crypto};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rusqlite::{Connection, Row, params};

const APP_NAME: &str = "TwirChat";

fn xor_key() -> String {
    xor_key_pub()
}

#[must_use]
pub fn xor_key_pub() -> String {
    let host = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!("{APP_NAME}:{host}")
}

#[must_use]
pub fn xor_encrypt(plaintext: &str, key: &str) -> String {
    let encoded: Vec<u8> = plaintext
        .bytes()
        .zip(key.bytes().cycle())
        .map(|(b, k)| b ^ k)
        .collect();
    B64.encode(encoded)
}

/// # Errors
///
/// Returns [`AppError::Auth`] if base64 decode or UTF-8 conversion fails.
pub fn xor_decrypt(encoded: &str, key: &str) -> Result<String, AppError> {
    let bytes = B64
        .decode(encoded)
        .map_err(|e| AppError::Auth(format!("base64 decode: {e}")))?;
    let decoded: Vec<u8> = bytes
        .into_iter()
        .zip(key.bytes().cycle())
        .map(|(b, k)| b ^ k)
        .collect();
    String::from_utf8(decoded).map_err(|e| AppError::Auth(format!("utf8 decode: {e}")))
}

#[derive(Debug)]
pub struct AccountTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<Account> {
    let scopes_json: Option<String> = row.get("scopes")?;
    let scopes: Vec<String> = scopes_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Ok(Account {
        id: row.get("id")?,
        platform: row.get::<_, String>("platform")?.parse().map_err(|_| {
            rusqlite::Error::InvalidColumnType(
                0,
                "platform".to_owned(),
                rusqlite::types::Type::Text,
            )
        })?,
        platform_user_id: row.get("platform_user_id")?,
        username: row.get("username")?,
        display_name: row.get("display_name")?,
        avatar_url: row.get("avatar_url")?,
        scopes,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

impl std::str::FromStr for Platform {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "twitch" => Ok(Self::Twitch),
            "youtube" => Ok(Self::YouTube),
            "kick" => Ok(Self::Kick),
            other => Err(format!("unknown platform: {other}")),
        }
    }
}

/// Returns all accounts (without token fields).
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn get_all(conn: &Connection) -> Result<Vec<Account>, AppError> {
    let mut stmt = conn.prepare("SELECT * FROM accounts")?;
    let rows = stmt.query_map([], map_row)?;
    rows.map(|r| r.map_err(AppError::from)).collect()
}

/// Returns the account with the given `id`, or `None` if not found.
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<Account>, AppError> {
    let mut stmt = conn.prepare("SELECT * FROM accounts WHERE id = ?")?;
    let mut rows = stmt.query_map([id], map_row)?;
    rows.next()
        .map_or_else(|| Ok(None), |r| r.map(Some).map_err(AppError::from))
}

/// Deletes the account with the given `id`.
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure.
pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM accounts WHERE id = ?", [id])?;
    Ok(())
}

/// Upserts an account and its encrypted tokens into the DB.
///
/// # Errors
///
/// Returns [`AppError::Database`] or [`AppError::Serde`] on failure.
pub fn upsert(
    conn: &Connection,
    account: &Account,
    tokens: &AccountTokens,
) -> Result<(), AppError> {
    let encrypted_access = crypto::aes_encrypt(&tokens.access_token)?;
    let encrypted_refresh = tokens
        .refresh_token
        .as_deref()
        .map(crypto::aes_encrypt)
        .transpose()?;
    let scopes_json = serde_json::to_string(&account.scopes)?;

    conn.execute(
        "INSERT INTO accounts
            (id, platform, platform_user_id, username, display_name, avatar_url,
             access_token, refresh_token, expires_at, scopes, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
         ON CONFLICT(id) DO UPDATE SET
             platform_user_id = excluded.platform_user_id,
             username         = excluded.username,
             display_name     = excluded.display_name,
             avatar_url       = excluded.avatar_url,
             access_token     = excluded.access_token,
             refresh_token    = excluded.refresh_token,
             expires_at       = excluded.expires_at,
             scopes           = excluded.scopes,
             updated_at       = unixepoch()",
        params![
            account.id,
            platform_to_str(account.platform),
            account.platform_user_id,
            account.username,
            account.display_name,
            account.avatar_url,
            encrypted_access,
            encrypted_refresh,
            tokens.expires_at,
            scopes_json,
        ],
    )?;
    Ok(())
}

/// Returns decrypted tokens for an account, or `None` if the account doesn't exist.
///
/// # Errors
///
/// Returns [`AppError::Database`] on SQL failure or [`AppError::Auth`] on decryption failure.
pub fn get_tokens(conn: &Connection, id: &str) -> Result<Option<AccountTokens>, AppError> {
    let mut stmt =
        conn.prepare("SELECT access_token, refresh_token, expires_at FROM accounts WHERE id = ?")?;
    let mut rows = stmt.query([id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };

    let encrypted_access: String = row.get(0)?;
    let encrypted_refresh: Option<String> = row.get(1)?;
    let expires_at: Option<i64> = row.get(2)?;

    let access_token = if crypto::is_aes_encrypted(&encrypted_access) {
        crypto::aes_decrypt(&encrypted_access)?
    } else {
        xor_decrypt(&encrypted_access, &xor_key())?
    };
    let refresh_token = match encrypted_refresh {
        Some(ref token) if crypto::is_aes_encrypted(token) => Some(crypto::aes_decrypt(token)?),
        Some(ref token) => Some(xor_decrypt(token, &xor_key())?),
        None => None,
    };

    Ok(Some(AccountTokens {
        access_token,
        refresh_token,
        expires_at,
    }))
}

const fn platform_to_str(p: Platform) -> &'static str {
    match p {
        Platform::Twitch => "twitch",
        Platform::YouTube => "youtube",
        Platform::Kick => "kick",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{crypto, db};

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        db::init_db(&conn).expect("init_db");
        conn
    }

    fn sample_account() -> Account {
        Account {
            id: "test-id-1".to_owned(),
            platform: Platform::Twitch,
            platform_user_id: "12345".to_owned(),
            username: "testuser".to_owned(),
            display_name: "TestUser".to_owned(),
            avatar_url: Some("https://example.com/avatar.png".to_owned()),
            scopes: vec!["chat:read".to_owned(), "chat:edit".to_owned()],
            created_at: 0,
            updated_at: 0,
        }
    }

    fn sample_tokens() -> AccountTokens {
        AccountTokens {
            access_token: "my_access_token".to_owned(),
            refresh_token: Some("my_refresh_token".to_owned()),
            expires_at: Some(9_999_999),
        }
    }

    #[test]
    fn xor_round_trip() {
        let key = "TwirChat:testhost";
        let plain = "hello world";
        let enc = xor_encrypt(plain, key);
        let dec = xor_decrypt(&enc, key).expect("decrypt");
        assert_eq!(dec, plain);
    }

    #[test]
    fn xor_encrypt_is_base64() {
        let enc = xor_encrypt("abc", "key");
        assert!(B64.decode(&enc).is_ok(), "output should be valid base64");
    }

    #[test]
    fn upsert_and_get_all() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");
        let accounts = get_all(&conn).expect("get_all");
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "test-id-1");
    }

    #[test]
    fn get_by_id_some_and_none() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");

        let found = get_by_id(&conn, "test-id-1").expect("get_by_id");
        assert!(found.is_some());

        let missing = get_by_id(&conn, "does-not-exist").expect("get_by_id missing");
        assert!(missing.is_none());
    }

    #[test]
    fn delete_removes_account() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");
        delete(&conn, "test-id-1").expect("delete");
        let accounts = get_all(&conn).expect("get_all");
        assert!(accounts.is_empty());
    }

    #[test]
    fn get_tokens_decrypts_correctly() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");
        let tokens = get_tokens(&conn, "test-id-1")
            .expect("get_tokens")
            .expect("tokens should be Some");
        assert_eq!(tokens.access_token, "my_access_token");
        assert_eq!(tokens.refresh_token.as_deref(), Some("my_refresh_token"));
        assert_eq!(tokens.expires_at, Some(9_999_999));
    }

    #[test]
    fn get_tokens_returns_none_for_missing() {
        let conn = setup();
        let result = get_tokens(&conn, "nonexistent").expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn upsert_stores_aes_encrypted_tokens() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");

        let (encrypted_access, encrypted_refresh): (String, Option<String>) = conn
            .query_row(
                "SELECT access_token, refresh_token FROM accounts WHERE id = ?",
                ["test-id-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query row");

        assert!(crypto::is_aes_encrypted(&encrypted_access));
        assert_eq!(
            crypto::aes_decrypt(&encrypted_access).expect("decrypt access"),
            "my_access_token"
        );
        assert!(
            encrypted_refresh
                .as_ref()
                .is_some_and(|token| crypto::is_aes_encrypted(token))
        );
        assert_eq!(
            crypto::aes_decrypt(encrypted_refresh.as_deref().expect("refresh token"))
                .expect("decrypt refresh"),
            "my_refresh_token"
        );
    }

    #[test]
    fn upsert_updates_on_conflict() {
        let conn = setup();
        upsert(&conn, &sample_account(), &sample_tokens()).expect("upsert");

        let mut updated = sample_account();
        updated.username = "updated_user".to_owned();
        upsert(&conn, &updated, &sample_tokens()).expect("upsert again");

        let accounts = get_all(&conn).expect("get_all");
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].username, "updated_user");
    }
}
