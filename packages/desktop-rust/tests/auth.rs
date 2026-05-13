use std::cell::RefCell;
use std::rc::Rc;
use twirchat_desktop_rust::auth::browser::BrowserOpener;
use twirchat_desktop_rust::auth::callback::AuthCallback;
use twirchat_desktop_rust::auth::pkce::{generate_code_challenge, generate_pkce_pair};
use twirchat_desktop_rust::auth::{
    AuthError, AuthProvider, AuthResult, AuthService, AuthenticatedAccount,
};
use twirchat_desktop_rust::protocol::types::Platform;
use twirchat_desktop_rust::runtime::TWITCH_REDIRECT_URI;
use twirchat_desktop_rust::storage::{Storage, TokenState};

#[test]
fn auth_pkce_round_trip() -> Result<(), Box<dyn std::error::Error>> {
    let pair = generate_pkce_pair();

    assert!((43..=128).contains(&pair.code_verifier.len()));
    assert_eq!(
        generate_code_challenge(&pair.code_verifier),
        pair.code_challenge
    );
    assert_eq!(
        generate_code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    assert!(!pair.code_challenge.contains('='));

    Ok(())
}

#[test]
fn auth_invalid_state_rejected() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("auth-invalid.sqlite"))?;
    let provider = FakeProvider::default();
    let browser = FakeBrowser::default();
    let mut service = AuthService::new();

    let outcome = service.start(&provider, &browser)?;
    assert_eq!(browser.opened_urls.borrow().as_slice(), &[outcome.auth_url]);

    let result = service.handle_callback(
        &provider,
        &storage,
        AuthCallback {
            code: "valid-code".into(),
            state: "not-the-generated-state".into(),
        },
    );

    assert!(matches!(result, Err(AuthError::UnknownState)));
    assert!(storage.accounts().find_all()?.is_empty());

    let mut expired_service = AuthService::with_session_ttl(0);
    let expired = expired_service.start(&provider, &browser)?;
    std::thread::sleep(std::time::Duration::from_millis(2));

    let expired_result = expired_service.handle_callback(
        &provider,
        &storage,
        AuthCallback {
            code: "valid-code".into(),
            state: expired.state,
        },
    );

    assert!(matches!(expired_result, Err(AuthError::ExpiredState)));
    assert!(storage.accounts().find_all()?.is_empty());

    Ok(())
}

#[test]
fn auth_callback_success_stores_account() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let storage = Storage::open(&temp.path().join("auth-success.sqlite"))?;
    let provider = FakeProvider::default();
    let browser = FakeBrowser::default();
    let mut service = AuthService::new();

    let start = service.start(&provider, &browser)?;
    assert_eq!(start.event.platform, Platform::Twitch);
    assert!(start.event.url.contains(&start.state));
    assert!(start.event.url.contains(&start.code_challenge));

    let success = service.handle_callback(
        &provider,
        &storage,
        AuthCallback {
            code: "valid-code".into(),
            state: start.state,
        },
    )?;

    assert_eq!(success.platform, Platform::Twitch);
    assert_eq!(success.channel_slug, "fixturestreamer");
    assert_eq!(success.event.platform, Platform::Twitch);
    assert_eq!(success.event.username, "fixturestreamer");
    assert_eq!(success.event.display_name, "Fixture Streamer");
    assert_eq!(success.page.status, 200);

    let accounts = storage.accounts().find_all_with_token_state()?;
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].account.id, "twitch:user-1");
    assert_eq!(accounts[0].account.platform, Platform::Twitch);
    assert_eq!(accounts[0].account.platform_user_id, "user-1");
    assert_eq!(accounts[0].account.username, "fixturestreamer");
    assert_eq!(accounts[0].account.display_name, "Fixture Streamer");
    assert_eq!(accounts[0].account.scopes, vec!["chat:read", "chat:edit"]);

    match &accounts[0].token_state {
        TokenState::Valid(tokens) => {
            assert_eq!(tokens.access_token, "access-from-valid-code");
            assert_eq!(
                tokens.refresh_token.as_deref(),
                Some("refresh-from-valid-code")
            );
            assert_eq!(tokens.expires_at, Some(4_102_444_800));
        }
        TokenState::ReauthRequired { reason } => {
            return Err(format!("expected valid token state, got {reason}").into());
        }
    }

    assert_eq!(provider.last_exchange.borrow().len(), 1);
    let exchange = provider.last_exchange.borrow();
    assert_eq!(exchange[0].code, "valid-code");
    assert!(!exchange[0].code_verifier.is_empty());

    Ok(())
}

#[derive(Debug, Default)]
struct FakeBrowser {
    opened_urls: RefCell<Vec<String>>,
}

impl BrowserOpener for FakeBrowser {
    fn open(&self, url: &str) -> AuthResult<()> {
        self.opened_urls.borrow_mut().push(url.to_string());
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExchangeCall {
    code: String,
    code_verifier: String,
}

#[derive(Debug, Default)]
struct FakeProvider {
    last_exchange: Rc<RefCell<Vec<ExchangeCall>>>,
}

impl AuthProvider for FakeProvider {
    fn platform(&self) -> Platform {
        Platform::Twitch
    }

    fn display_name(&self) -> &'static str {
        "Twitch"
    }

    fn redirect_uri(&self) -> &str {
        TWITCH_REDIRECT_URI
    }

    fn build_authorization_url(&self, code_challenge: &str, state: &str) -> AuthResult<String> {
        Ok(format!(
            "https://auth.example.test/oauth?response_type=code&code_challenge={code_challenge}&state={state}&redirect_uri={}",
            self.redirect_uri()
        ))
    }

    fn exchange_callback(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> AuthResult<AuthenticatedAccount> {
        self.last_exchange.borrow_mut().push(ExchangeCall {
            code: code.to_string(),
            code_verifier: code_verifier.to_string(),
        });

        if code != "valid-code" {
            return Err(AuthError::Provider {
                platform: self.platform(),
                message: "fake provider only accepts valid-code".into(),
            });
        }

        Ok(AuthenticatedAccount {
            id: "twitch:user-1".into(),
            platform: Platform::Twitch,
            platform_user_id: "user-1".into(),
            username: "fixturestreamer".into(),
            display_name: "Fixture Streamer".into(),
            avatar_url: Some("https://cdn.example.test/avatar.png".into()),
            access_token: "access-from-valid-code".into(),
            refresh_token: Some("refresh-from-valid-code".into()),
            expires_at: Some(4_102_444_800),
            scopes: vec!["chat:read".into(), "chat:edit".into()],
            channel_slug: "fixturestreamer".into(),
        })
    }
}
