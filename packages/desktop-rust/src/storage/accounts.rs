use crate::protocol::types::{Account, Platform};
use crate::storage::crypto;
use crate::storage::db::{Connection, Param, Row};
use crate::storage::{StorageError, StorageResult, i64_to_u64, now_unix};

#[derive(Debug, Clone, PartialEq)]
pub struct AccountRecord {
    pub account: Account,
    pub encrypted_access_token: String,
    pub encrypted_refresh_token: Option<String>,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenState {
    Valid(TokenPair),
    ReauthRequired { reason: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountWithTokenState {
    pub account: Account,
    pub token_state: TokenState,
}

pub struct AccountsStore<'a> {
    conn: &'a Connection,
}

impl<'a> AccountsStore<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn find_all(&self) -> StorageResult<Vec<Account>> {
        self.raw_accounts()
            .map(|rows| rows.into_iter().map(|record| record.account).collect())
    }

    pub fn find_all_with_token_state(&self) -> StorageResult<Vec<AccountWithTokenState>> {
        self.raw_accounts().map(|rows| {
            rows.into_iter()
                .map(|record| AccountWithTokenState {
                    token_state: decode_tokens(&record),
                    account: record.account,
                })
                .collect()
        })
    }

    pub fn get_tokens(&self, id: &str) -> StorageResult<Option<TokenState>> {
        let row = self.conn.query_one(
            "SELECT * FROM accounts WHERE id = ? LIMIT 1",
            &[Param::Text(id)],
        )?;
        row.map(|row| row_to_record(&row).map(|record| decode_tokens(&record)))
            .transpose()
    }

    pub fn upsert(&self, params: UpsertAccount<'_>) -> StorageResult<()> {
        let access_token =
            crypto::encrypt(params.access_token).map_err(|_| StorageError::TokenDecode {
                account_id: params.id.into(),
            })?;
        let refresh_token = params
            .refresh_token
            .map(crypto::encrypt)
            .transpose()
            .map_err(|_| StorageError::TokenDecode {
                account_id: params.id.into(),
            })?;
        let scopes = serde_json::to_string(params.scopes)?;
        self.conn.execute(
            r#"INSERT INTO accounts
              (id, platform, platform_user_id, username, display_name, avatar_url,
               access_token, refresh_token, expires_at, scopes, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                platform_user_id = excluded.platform_user_id,
                username = excluded.username,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                scopes = excluded.scopes,
                updated_at = excluded.updated_at"#,
            &[
                Param::Text(params.id),
                Param::Text(platform_to_str(params.platform)),
                Param::Text(params.platform_user_id),
                Param::Text(params.username),
                Param::Text(params.display_name),
                opt_text(params.avatar_url),
                Param::Text(&access_token),
                opt_text(refresh_token.as_deref()),
                opt_i64(
                    params
                        .expires_at
                        .and_then(|value| i64::try_from(value).ok()),
                ),
                Param::Text(&scopes),
                Param::Integer(now_unix()),
            ],
        )?;
        Ok(())
    }

    pub fn update_tokens(
        &self,
        id: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at: Option<u64>,
    ) -> StorageResult<()> {
        let encrypted_access =
            crypto::encrypt(access_token).map_err(|_| StorageError::TokenDecode {
                account_id: id.into(),
            })?;
        let encrypted_refresh = refresh_token
            .map(crypto::encrypt)
            .transpose()
            .map_err(|_| StorageError::TokenDecode {
                account_id: id.into(),
            })?;
        self.conn.execute(
            r#"UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
               WHERE id = ?"#,
            &[
                Param::Text(&encrypted_access),
                opt_text(encrypted_refresh.as_deref()),
                opt_i64(expires_at.and_then(|value| i64::try_from(value).ok())),
                Param::Integer(now_unix()),
                Param::Text(id),
            ],
        )?;
        Ok(())
    }

    fn raw_accounts(&self) -> StorageResult<Vec<AccountRecord>> {
        self.conn
            .query("SELECT * FROM accounts ORDER BY created_at ASC", &[])?
            .iter()
            .map(row_to_record)
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct UpsertAccount<'a> {
    pub id: &'a str,
    pub platform: Platform,
    pub platform_user_id: &'a str,
    pub username: &'a str,
    pub display_name: &'a str,
    pub avatar_url: Option<&'a str>,
    pub access_token: &'a str,
    pub refresh_token: Option<&'a str>,
    pub expires_at: Option<u64>,
    pub scopes: &'a [String],
}

fn row_to_record(row: &Row) -> StorageResult<AccountRecord> {
    let scopes = match row.opt_text("scopes")? {
        Some(value) => parse_scopes(&value),
        None => Vec::new(),
    };
    let account = Account {
        id: row.text("id")?,
        platform: parse_platform(&row.text("platform")?),
        platform_user_id: row.text("platform_user_id")?,
        username: row.text("username")?,
        display_name: row.text("display_name")?,
        avatar_url: row.opt_text("avatar_url")?,
        scopes,
        created_at: i64_to_u64(row.i64("created_at")?),
        updated_at: i64_to_u64(row.i64("updated_at")?),
    };
    Ok(AccountRecord {
        account,
        encrypted_access_token: row.text("access_token")?,
        encrypted_refresh_token: row.opt_text("refresh_token")?,
        expires_at: row
            .opt_i64("expires_at")?
            .and_then(|value| u64::try_from(value).ok()),
    })
}

fn parse_scopes(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).map_or_else(|_| Vec::new(), std::convert::identity)
}

fn decode_tokens(record: &AccountRecord) -> TokenState {
    let access_token = match crypto::decrypt(&record.encrypted_access_token) {
        Ok(value) if !value.is_empty() => value,
        _ => {
            return TokenState::ReauthRequired {
                reason: "access token could not be decoded".into(),
            };
        }
    };
    let refresh_token = match record.encrypted_refresh_token.as_deref() {
        Some(value) => match crypto::decrypt(value) {
            Ok(decoded) => Some(decoded),
            Err(_) => {
                return TokenState::ReauthRequired {
                    reason: "refresh token could not be decoded".into(),
                };
            }
        },
        None => None,
    };
    TokenState::Valid(TokenPair {
        access_token,
        refresh_token,
        expires_at: record.expires_at,
    })
}

pub(crate) fn platform_to_str(platform: Platform) -> &'static str {
    match platform {
        Platform::Twitch => "twitch",
        Platform::Youtube => "youtube",
        Platform::Kick => "kick",
    }
}

pub(crate) fn parse_platform(value: &str) -> Platform {
    match value {
        "youtube" => Platform::Youtube,
        "kick" => Platform::Kick,
        _ => Platform::Twitch,
    }
}

pub(crate) fn opt_text(value: Option<&str>) -> Param<'_> {
    match value {
        Some(value) => Param::Text(value),
        None => Param::Null,
    }
}

pub(crate) fn opt_i64(value: Option<i64>) -> Param<'static> {
    match value {
        Some(value) => Param::Integer(value),
        None => Param::Null,
    }
}
