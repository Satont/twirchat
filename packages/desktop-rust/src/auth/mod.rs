pub mod browser;
pub mod callback;
pub mod kick_connect;
pub mod pkce;
pub mod server;

use crate::protocol::types::Platform;
use crate::storage::accounts::UpsertAccount;
use crate::storage::{StorageError, now_millis};
use std::collections::HashMap;
use std::error::Error;
use std::fmt;

pub use callback::AuthCallback;
pub use server::{AuthErrorOutcome, AuthService, AuthStartOutcome, AuthSuccessOutcome};

pub type AuthResult<T> = Result<T, AuthError>;

const DEFAULT_SESSION_TTL_MS: u64 = 10 * 60 * 1000;

#[derive(Debug)]
pub enum AuthError {
    BrowserOpenFailed {
        url: String,
        message: String,
    },
    MissingCallbackParam {
        name: &'static str,
    },
    ProviderRejected {
        error: String,
        description: Option<String>,
    },
    UnknownState,
    ExpiredState,
    StatePlatformMismatch {
        expected: Platform,
        actual: Platform,
    },
    Provider {
        platform: Platform,
        message: String,
    },
    Storage(StorageError),
    StorageInvariant {
        message: String,
    },
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BrowserOpenFailed { url, message } => {
                write!(f, "failed to open browser for {url}: {message}")
            }
            Self::MissingCallbackParam { name } => {
                write!(f, "missing {name} in OAuth callback")
            }
            Self::ProviderRejected { error, description } => match description {
                Some(description) => {
                    write!(f, "OAuth provider rejected auth: {error} — {description}")
                }
                None => write!(f, "OAuth provider rejected auth: {error}"),
            },
            Self::UnknownState => write!(f, "unknown or expired OAuth state"),
            Self::ExpiredState => write!(f, "OAuth session expired"),
            Self::StatePlatformMismatch { expected, actual } => write!(
                f,
                "OAuth state belongs to {actual:?}, not expected platform {expected:?}"
            ),
            Self::Provider { platform, message } => {
                write!(f, "{platform:?} auth provider error: {message}")
            }
            Self::Storage(source) => write!(f, "auth storage error: {source}"),
            Self::StorageInvariant { message } => {
                write!(f, "auth storage invariant failed: {message}")
            }
        }
    }
}

impl Error for AuthError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::BrowserOpenFailed { .. }
            | Self::MissingCallbackParam { .. }
            | Self::ProviderRejected { .. }
            | Self::UnknownState
            | Self::ExpiredState
            | Self::StatePlatformMismatch { .. }
            | Self::Provider { .. }
            | Self::StorageInvariant { .. } => None,
        }
    }
}

impl From<StorageError> for AuthError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedAccount {
    pub id: String,
    pub platform: Platform,
    pub platform_user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub scopes: Vec<String>,
    pub channel_slug: String,
}

impl<'a> From<&'a AuthenticatedAccount> for UpsertAccount<'a> {
    fn from(value: &'a AuthenticatedAccount) -> Self {
        Self {
            id: &value.id,
            platform: value.platform,
            platform_user_id: &value.platform_user_id,
            username: &value.username,
            display_name: &value.display_name,
            avatar_url: value.avatar_url.as_deref(),
            access_token: &value.access_token,
            refresh_token: value.refresh_token.as_deref(),
            expires_at: value.expires_at,
            scopes: &value.scopes,
        }
    }
}

pub trait AuthProvider {
    fn platform(&self) -> Platform;
    fn display_name(&self) -> &'static str;
    fn redirect_uri(&self) -> &str;
    fn build_authorization_url(&self, code_challenge: &str, state: &str) -> AuthResult<String>;
    fn exchange_callback(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> AuthResult<AuthenticatedAccount>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAuthSession {
    pub platform: Platform,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone)]
pub struct AuthSessionStore {
    ttl_ms: u64,
    sessions: HashMap<String, PendingAuthSession>,
}

impl Default for AuthSessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthSessionStore {
    pub fn new() -> Self {
        Self::with_ttl(DEFAULT_SESSION_TTL_MS)
    }

    pub fn with_ttl(ttl_ms: u64) -> Self {
        Self {
            ttl_ms,
            sessions: HashMap::new(),
        }
    }

    pub fn insert(
        &mut self,
        state: String,
        platform: Platform,
        code_verifier: String,
        redirect_uri: String,
    ) {
        self.sessions.insert(
            state,
            PendingAuthSession {
                platform,
                code_verifier,
                redirect_uri,
                expires_at_ms: now_millis().saturating_add(self.ttl_ms),
            },
        );
    }

    pub fn take_valid(
        &mut self,
        state: &str,
        expected_platform: Platform,
    ) -> AuthResult<PendingAuthSession> {
        let session = self.sessions.remove(state).ok_or(AuthError::UnknownState)?;
        if session.platform != expected_platform {
            return Err(AuthError::StatePlatformMismatch {
                expected: expected_platform,
                actual: session.platform,
            });
        }
        if now_millis() > session.expires_at_ms {
            return Err(AuthError::ExpiredState);
        }
        Ok(session)
    }

    pub fn cleanup_expired(&mut self) {
        let now = now_millis();
        self.sessions
            .retain(|_, session| now <= session.expires_at_ms);
    }
}
