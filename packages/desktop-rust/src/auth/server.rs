use crate::auth::callback::{AuthCallback, CallbackPage, error_page, success_page};
use crate::auth::pkce::{generate_pkce_pair, generate_state};
use crate::auth::{AuthError, AuthProvider, AuthResult, AuthSessionStore};
use crate::protocol::rpc::{AuthErrorPayload, AuthSuccessPayload, AuthUrlPayload};
use crate::protocol::types::{Account, Platform};
use crate::storage::Storage;

#[derive(Debug, Clone, PartialEq)]
pub struct AuthStartOutcome {
    pub platform: Platform,
    pub state: String,
    pub code_challenge: String,
    pub auth_url: String,
    pub event: AuthUrlPayload,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthSuccessOutcome {
    pub platform: Platform,
    pub account: Account,
    pub channel_slug: String,
    pub event: AuthSuccessPayload,
    pub page: CallbackPage,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthErrorOutcome {
    pub platform: Platform,
    pub event: AuthErrorPayload,
    pub page: CallbackPage,
}

pub struct AuthService {
    sessions: AuthSessionStore,
}

impl Default for AuthService {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            sessions: AuthSessionStore::new(),
        }
    }

    pub fn with_session_ttl(ttl_ms: u64) -> Self {
        Self {
            sessions: AuthSessionStore::with_ttl(ttl_ms),
        }
    }

    pub fn start<P, B>(&mut self, provider: &P, browser: &B) -> AuthResult<AuthStartOutcome>
    where
        P: AuthProvider,
        B: crate::auth::browser::BrowserOpener,
    {
        self.sessions.cleanup_expired();

        let pkce = generate_pkce_pair();
        let state = generate_state();
        let auth_url = provider.build_authorization_url(&pkce.code_challenge, &state)?;

        self.sessions.insert(
            state.clone(),
            provider.platform(),
            pkce.code_verifier,
            provider.redirect_uri().to_string(),
        );
        browser.open(&auth_url)?;

        Ok(AuthStartOutcome {
            platform: provider.platform(),
            state,
            code_challenge: pkce.code_challenge,
            auth_url: auth_url.clone(),
            event: AuthUrlPayload {
                platform: provider.platform(),
                url: auth_url,
            },
        })
    }

    pub fn handle_callback<P>(
        &mut self,
        provider: &P,
        storage: &Storage,
        callback: AuthCallback,
    ) -> AuthResult<AuthSuccessOutcome>
    where
        P: AuthProvider,
    {
        let session = self
            .sessions
            .take_valid(&callback.state, provider.platform())?;
        let account = provider.exchange_callback(&callback.code, &session.code_verifier)?;

        storage.accounts().upsert((&account).into())?;

        let persisted = storage
            .accounts()
            .find_all()?
            .into_iter()
            .find(|stored| stored.id == account.id)
            .ok_or_else(|| AuthError::StorageInvariant {
                message: format!("account {} was not persisted", account.id),
            })?;

        let channel_slug = account.channel_slug.clone();
        let event = AuthSuccessPayload {
            platform: persisted.platform,
            username: persisted.username.clone(),
            display_name: persisted.display_name.clone(),
        };

        Ok(AuthSuccessOutcome {
            platform: persisted.platform,
            account: persisted,
            channel_slug,
            event,
            page: success_page(provider.display_name()),
        })
    }

    pub fn handle_callback_url<P>(
        &mut self,
        provider: &P,
        storage: &Storage,
        url: &url::Url,
    ) -> Result<AuthSuccessOutcome, AuthErrorOutcome>
    where
        P: AuthProvider,
    {
        AuthCallback::from_url(url)
            .and_then(|callback| self.handle_callback(provider, storage, callback))
            .map_err(|error| AuthErrorOutcome {
                platform: provider.platform(),
                event: AuthErrorPayload {
                    platform: provider.platform(),
                    error: error.to_string(),
                },
                page: error_page(&error.to_string()),
            })
    }
}
