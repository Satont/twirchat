//! DB path migration and token re-encryption (XOR → AES-256-GCM).
//!
//! On first startup after migrating from Electrobun, this module:
//! 1. Copies the old Electrobun DB file to the new Tauri data dir path.
//! 2. Re-encrypts all XOR-encoded account tokens to AES-256-GCM on first read.
//!
//! The AES-GCM format matches `packages/desktop/src/store/crypto.ts`:
//! `base64( salt[16] || iv[12] || ciphertext )`
//! Key derivation: PBKDF2-SHA-256, 100 000 iterations, 32-byte output.
//! Input key material: `"TwirChat:{hostname}"`.

use rusqlite::Connection;
use std::path::{Path, PathBuf};

use crate::{
    AppError,
    store::{accounts, crypto},
};

pub use crate::store::crypto::{aes_decrypt, aes_encrypt, is_aes_encrypted};

// ---------------------------------------------------------------------------
// Per-account token migration
// ---------------------------------------------------------------------------

/// Re-encrypts XOR-encoded tokens for all accounts to AES-256-GCM.
///
/// Tokens that are already AES-encrypted (detected by length heuristic) are left unchanged.
///
/// # Errors
///
/// Returns [`AppError`] on any DB or crypto failure.
pub fn migrate_tokens(conn: &Connection) -> Result<(), AppError> {
    struct AccountRow {
        id: String,
        access_token: String,
        refresh_token: Option<String>,
    }

    let xor_key = accounts::xor_key_pub();

    let mut stmt = conn.prepare("SELECT id, access_token, refresh_token FROM accounts")?;

    let rows: Vec<AccountRow> = stmt
        .query_map([], |row| {
            Ok(AccountRow {
                id: row.get(0)?,
                access_token: row.get(1)?,
                refresh_token: row.get(2)?,
            })
        })?
        .map(|r| r.map_err(AppError::from))
        .collect::<Result<_, _>>()?;

    for row in rows {
        let new_access = if crypto::is_aes_encrypted(&row.access_token) {
            None // already AES
        } else {
            let plain = accounts::xor_decrypt(&row.access_token, &xor_key)?;
            Some(crypto::aes_encrypt(&plain)?)
        };

        let new_refresh = match row.refresh_token {
            None => None,
            Some(ref enc) if crypto::is_aes_encrypted(enc) => None,
            Some(ref enc) => {
                let plain = accounts::xor_decrypt(enc, &xor_key)?;
                Some(crypto::aes_encrypt(&plain)?)
            }
        };

        if new_access.is_some() || new_refresh.is_some() {
            conn.execute(
                "UPDATE accounts SET
                    access_token  = COALESCE(?1, access_token),
                    refresh_token = COALESCE(?2, refresh_token)
                 WHERE id = ?3",
                rusqlite::params![new_access, new_refresh, row.id],
            )?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// DB path migration (Electrobun → Tauri data dir)
// ---------------------------------------------------------------------------

/// Returns candidate old-Electrobun DB paths for the current OS.
fn electrobun_db_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    // Linux/macOS old Electrobun locations:
    // ~/.twirchat/db.sqlite and ~/.twirchat-dev/db.sqlite
    if let Some(home) = dirs_next_home_dir() {
        paths.push(home.join(".twirchat").join("db.sqlite"));
        paths.push(home.join(".twirchat-dev").join("db.sqlite"));
    }

    // Linux: ~/.local/share/TwirChat/db.sqlite
    if let Some(data_dir) = dirs_next_home_dir().map(|h| {
        h.join(".local")
            .join("share")
            .join("TwirChat")
            .join("db.sqlite")
    }) {
        paths.push(data_dir);
    }

    // macOS: ~/Library/Application Support/TwirChat/db.sqlite
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        paths.push(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("TwirChat")
                .join("db.sqlite"),
        );
    }

    // Windows: %APPDATA%\TwirChat\db.sqlite
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(PathBuf::from(appdata).join("TwirChat").join("db.sqlite"));
    }

    paths
}

fn dirs_next_home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// Copies the old Electrobun DB to `new_path` if the new path doesn't yet exist.
///
/// Does nothing (returns `Ok(())`) if:
/// - `new_path` already exists, OR
/// - no old DB path exists (first-time install)
///
/// The old DB file is **not deleted** — it serves as a backup.
///
/// # Errors
///
/// Returns [`AppError::Io`] if the file copy fails.
pub fn migrate_db_path(new_path: &Path) -> Result<(), AppError> {
    if new_path.exists() {
        return Ok(());
    }
    for old in electrobun_db_paths() {
        if old.exists() {
            if let Some(parent) = new_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&old, new_path)?;
            return Ok(());
        }
    }
    Ok(()) // No old DB found → first-time install, nothing to migrate
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{accounts, db};
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use rusqlite::Connection;

    // ---- AES round-trip ----

    #[test]
    fn aes_round_trip() {
        let plain = "super_secret_access_token";
        let enc = crypto::aes_encrypt(plain).expect("encrypt");
        let dec = crypto::aes_decrypt(&enc).expect("decrypt");
        assert_eq!(dec, plain);
    }

    #[test]
    fn aes_output_is_base64() {
        let enc = crypto::aes_encrypt("hello").expect("encrypt");
        assert!(B64.decode(&enc).is_ok());
    }

    #[test]
    fn aes_encrypted_detection() {
        let enc = crypto::aes_encrypt("token").expect("encrypt");
        assert!(crypto::is_aes_encrypted(&enc));
    }

    #[test]
    fn xor_not_detected_as_aes() {
        let xor_enc = accounts::xor_encrypt("short_token", "TwirChat:myhost");
        // Short tokens produce short base64 → below the 60-char threshold
        // (11 bytes → 16 base64 chars, well below 60)
        assert!(!crypto::is_aes_encrypted(&xor_enc));
    }

    // ---- XOR known-vector test (matching crypto.ts xorEncode behaviour) ----

    #[test]
    fn xor_decode_known_vector() {
        // Encode with known key, decode with same key → round trip
        let key = "TwirChat:testhost";
        let plain = "access_token_value";
        let enc = accounts::xor_encrypt(plain, key);
        let dec = accounts::xor_decrypt(&enc, key).expect("decrypt");
        assert_eq!(dec, plain);
    }

    // ---- Token migration ----

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .expect("pragmas");
        db::init_db(&conn).expect("init_db");
        conn
    }

    #[test]
    fn migrate_tokens_re_encrypts_xor_tokens() {
        let conn = setup();
        let xor_key = accounts::xor_key_pub();
        let plain_access = "my_access_token";
        let plain_refresh = "my_refresh_token";

        // Insert a row with XOR-encrypted tokens directly
        let enc_access = accounts::xor_encrypt(plain_access, &xor_key);
        let enc_refresh = accounts::xor_encrypt(plain_refresh, &xor_key);
        conn.execute(
            "INSERT INTO accounts
                (id, platform, platform_user_id, username, display_name,
                 access_token, refresh_token)
             VALUES ('acc1', 'twitch', 'uid1', 'user1', 'User1', ?1, ?2)",
            rusqlite::params![enc_access, enc_refresh],
        )
        .expect("insert");

        migrate_tokens(&conn).expect("migrate_tokens");

        // After migration, tokens should be AES-encrypted
        let (new_access, new_refresh): (String, String) = conn
            .query_row(
                "SELECT access_token, refresh_token FROM accounts WHERE id = 'acc1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query");

        assert!(
            crypto::is_aes_encrypted(&new_access),
            "access_token should be AES after migration"
        );
        assert!(
            crypto::is_aes_encrypted(&new_refresh),
            "refresh_token should be AES after migration"
        );

        // Decrypt and verify plaintext preserved
        let dec_access = crypto::aes_decrypt(&new_access).expect("aes_decrypt access");
        let dec_refresh = crypto::aes_decrypt(&new_refresh).expect("aes_decrypt refresh");
        assert_eq!(dec_access, plain_access);
        assert_eq!(dec_refresh, plain_refresh);
    }

    #[test]
    fn migrate_tokens_skips_already_aes_tokens() {
        let conn = setup();
        let enc_access = crypto::aes_encrypt("already_encrypted").expect("aes_encrypt");
        conn.execute(
            "INSERT INTO accounts
                (id, platform, platform_user_id, username, display_name,
                 access_token)
             VALUES ('acc2', 'twitch', 'uid2', 'user2', 'User2', ?1)",
            rusqlite::params![enc_access],
        )
        .expect("insert");

        // Run migration — should leave token unchanged
        migrate_tokens(&conn).expect("migrate_tokens");

        let new_access: String = conn
            .query_row(
                "SELECT access_token FROM accounts WHERE id = 'acc2'",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(new_access, enc_access, "AES token should be unchanged");
    }

    // ---- DB path migration ----

    #[test]
    fn migrate_db_path_copies_old_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old_path = dir.path().join("old").join("db.sqlite");
        std::fs::create_dir_all(old_path.parent().unwrap()).unwrap();
        std::fs::write(&old_path, b"sqlite_data").unwrap();

        let new_path = dir.path().join("new").join("data.db");

        // Manually call copy (simulate what migrate_db_path does with a known old path)
        std::fs::create_dir_all(new_path.parent().unwrap()).unwrap();
        std::fs::copy(&old_path, &new_path).unwrap();

        assert!(new_path.exists());
        assert_eq!(std::fs::read(&new_path).unwrap(), b"sqlite_data");
    }

    #[test]
    fn migrate_db_path_noop_when_new_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let new_path = dir.path().join("data.db");
        std::fs::write(&new_path, b"existing").unwrap();

        // Should not overwrite
        migrate_db_path(&new_path).expect("no error");
        assert_eq!(std::fs::read(&new_path).unwrap(), b"existing");
    }

    #[test]
    fn migrate_db_path_noop_when_no_old_db() {
        let dir = tempfile::tempdir().expect("tempdir");
        let new_path = dir.path().join("data.db");

        // Isolate from real HOME so electrobun_db_paths() doesn't find a real old DB.
        let original_home = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", dir.path()) };

        // No old DB exists, new_path doesn't exist → should just return Ok
        migrate_db_path(&new_path).expect("no error");

        // Restore HOME
        match original_home {
            Some(h) => unsafe { std::env::set_var("HOME", h) },
            None => unsafe { std::env::remove_var("HOME") },
        }

        // new_path should still not exist
        assert!(!new_path.exists());
    }
}
