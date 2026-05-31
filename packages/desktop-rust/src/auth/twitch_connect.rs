use super::browser::{BrowserOpener, SystemBrowser};
use super::callback::{AuthCallback, error_page, success_page};
use super::local_callback::{PendingOAuthCallback, wait_for_oauth_callback, write_callback_page};
use super::pkce::{generate_pkce_pair, generate_state};
use crate::protocol::types::{Account, Platform};
use crate::runtime::TWITCH_REDIRECT_URI;
use crate::storage::accounts::UpsertAccount;
use crate::storage::{Storage, now_millis};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Duration;

pub fn connect_twitch_account(storage: &Storage) -> Result<Account, String> {
    let runtime =
        crate::runtime::config::RuntimeConfig::new(crate::runtime::config::RuntimeConfigInput {
            client_secret: storage.client_identity().get_client_secret().ok(),
            ..Default::default()
        });
    let http = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let pkce = generate_pkce_pair();
    let state = generate_state();

    println!("[twitch/auth] requesting auth URL from backend");
    let auth_url =
        build_twitch_auth_url(&http, runtime.backend_url(), &pkce.code_challenge, &state)?;
    println!("[twitch/auth] auth URL received; opening system browser");
    SystemBrowser
        .open(&auth_url)
        .map_err(|error| error.to_string())?;
    println!("[twitch/auth] browser opened; waiting for local callback");

    let mut pending_callback = wait_for_twitch_callback(&state)?;
    let result = finish_twitch_connection(
        storage,
        &http,
        runtime.backend_url(),
        &pending_callback.callback,
        &pkce.code_verifier,
    );

    match result {
        Ok(account) => {
            let page = success_page("Twitch");
            if let Err(error) = write_callback_page(
                &mut pending_callback.stream,
                page.status,
                page.content_type,
                &page.body,
            ) {
                println!("[twitch/auth] failed to write success callback page: {error}");
            }
            println!(
                "[twitch/auth] Twitch account connected: @{}",
                account.username
            );
            Ok(account)
        }
        Err(error) => {
            println!("[twitch/auth] Twitch account connection failed: {error}");
            let page = error_page(
                "Twitch authentication failed. Return to TwirChat and check the app logs.",
            );
            let _ = write_callback_page(
                &mut pending_callback.stream,
                page.status,
                page.content_type,
                &page.body,
            );
            Err(error)
        }
    }
}

fn finish_twitch_connection(
    storage: &Storage,
    http: &Client,
    backend_url: &str,
    callback: &AuthCallback,
    code_verifier: &str,
) -> Result<Account, String> {
    println!("[twitch/auth] exchanging callback code with backend");
    let tokens = exchange_twitch_code(http, backend_url, &callback.code, code_verifier)?;
    println!("[twitch/auth] token exchange succeeded; validating Twitch token");
    let validated = validate_twitch_token(http, &tokens.access_token)?;
    println!("[twitch/auth] validated token for @{}", validated.login);
    let user = fetch_twitch_user(
        http,
        &tokens.access_token,
        &validated.user_id,
        &validated.client_id,
    )?;

    let expires_at = tokens
        .expires_in
        .map(|expires_in| (now_millis() / 1000).saturating_add(expires_in));
    let account_id = format!("twitch:{}", validated.user_id);
    let scopes = validated.scopes;
    let display_name = user
        .as_ref()
        .and_then(|user| user.display_name.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&validated.login);
    let avatar_url = user
        .as_ref()
        .and_then(|user| user.profile_image_url.as_deref());

    println!("[twitch/auth] persisting Twitch account {account_id}");
    storage
        .accounts()
        .upsert(UpsertAccount {
            id: &account_id,
            platform: Platform::Twitch,
            platform_user_id: &validated.user_id,
            username: &validated.login,
            display_name,
            avatar_url,
            access_token: &tokens.access_token,
            refresh_token: tokens.refresh_token.as_deref(),
            expires_at,
            scopes: &scopes,
        })
        .map_err(|error| error.to_string())?;

    println!("[twitch/auth] reloading persisted Twitch account {account_id}");
    storage
        .accounts()
        .find_all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|account| account.id == account_id)
        .ok_or_else(|| String::from("Twitch account persisted but could not be reloaded"))
}

fn build_twitch_auth_url(
    http: &Client,
    backend_url: &str,
    code_challenge: &str,
    state: &str,
) -> Result<String, String> {
    let response = http
        .post(format!("{backend_url}/api/auth/twitch/start"))
        .json(&serde_json::json!({
            "codeChallenge": code_challenge,
            "state": state,
            "redirectUri": TWITCH_REDIRECT_URI,
        }))
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[twitch/auth] auth URL request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[twitch/auth] auth URL response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Twitch auth URL request failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    let body: TwitchBuildUrlResponse = response.json().map_err(|error| error.to_string())?;
    Ok(body.url)
}

fn wait_for_twitch_callback(expected_state: &str) -> Result<PendingOAuthCallback, String> {
    wait_for_oauth_callback("Twitch", expected_state)
}

fn exchange_twitch_code(
    http: &Client,
    backend_url: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TwitchExchangeResponse, String> {
    let response = http
        .post(format!("{backend_url}/api/auth/twitch/exchange"))
        .json(&serde_json::json!({
            "code": code,
            "codeVerifier": code_verifier,
            "redirectUri": TWITCH_REDIRECT_URI,
        }))
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[twitch/auth] token exchange request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[twitch/auth] token exchange response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Twitch token exchange failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    response.json().map_err(|error| error.to_string())
}

fn validate_twitch_token(
    http: &Client,
    access_token: &str,
) -> Result<TwitchValidatedToken, String> {
    let response = http
        .get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[twitch/auth] token validate request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[twitch/auth] token validate response status: {status}");

    if !status.is_success() {
        return Err(format!("Twitch token validation failed: {status}"));
    }

    response.json().map_err(|error| error.to_string())
}

fn fetch_twitch_user(
    http: &Client,
    access_token: &str,
    user_id: &str,
    client_id: &str,
) -> Result<Option<TwitchUser>, String> {
    let response = http
        .get("https://api.twitch.tv/helix/users")
        .query(&[("id", user_id)])
        .bearer_auth(access_token)
        .header("Client-Id", client_id)
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[twitch/auth] helix users request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[twitch/auth] helix users response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Twitch user info request failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    let body: TwitchUsersResponse = response.json().map_err(|error| error.to_string())?;
    Ok(body.data.into_iter().next())
}

fn body_snippet(value: &str) -> String {
    const MAX_LENGTH: usize = 500;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_LENGTH {
        trimmed.to_string()
    } else {
        let snippet: String = trimmed.chars().take(MAX_LENGTH).collect();
        format!("{snippet}...")
    }
}

#[derive(Deserialize)]
struct TwitchBuildUrlResponse {
    url: String,
}

#[derive(Deserialize)]
struct TwitchExchangeResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct TwitchValidatedToken {
    client_id: String,
    login: String,
    scopes: Vec<String>,
    user_id: String,
}

#[derive(Deserialize)]
struct TwitchUsersResponse {
    #[serde(default)]
    data: Vec<TwitchUser>,
}

#[derive(Deserialize)]
struct TwitchUser {
    display_name: Option<String>,
    profile_image_url: Option<String>,
}
