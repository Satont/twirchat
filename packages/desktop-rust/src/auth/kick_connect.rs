use super::browser::{BrowserOpener, SystemBrowser};
use super::callback::{AuthCallback, error_page, success_page};
use super::pkce::{generate_pkce_pair, generate_state};
use crate::protocol::types::{Account, Platform};
use crate::storage::accounts::UpsertAccount;
use crate::storage::{Storage, now_millis};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;
use url::Url;

const KICK_REDIRECT_URI: &str = "http://localhost:45825/auth/kick/callback";

pub fn connect_kick_account(storage: &Storage) -> Result<Account, String> {
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

    println!("[kick/auth] requesting auth URL from backend");
    let auth_url = build_kick_auth_url(&http, runtime.backend_url(), &pkce.code_challenge, &state)?;
    println!("[kick/auth] auth URL received; opening system browser");
    SystemBrowser
        .open(&auth_url)
        .map_err(|error| error.to_string())?;
    println!("[kick/auth] browser opened; waiting for local callback");

    let mut pending_callback = wait_for_kick_callback(&state)?;
    let result = finish_kick_connection(
        storage,
        &http,
        runtime.backend_url(),
        &pending_callback.callback,
        &pkce.code_verifier,
    );

    match result {
        Ok(account) => {
            let page = success_page("Kick");
            if let Err(error) = write_callback_page(
                &mut pending_callback.stream,
                page.status,
                page.content_type,
                &page.body,
            ) {
                println!("[kick/auth] failed to write success callback page: {error}");
            }
            println!("[kick/auth] Kick account connected: @{}", account.username);
            Ok(account)
        }
        Err(error) => {
            println!("[kick/auth] Kick account connection failed: {error}");
            let page = error_page(
                "Kick authentication failed. Return to TwirChat and check the app logs.",
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

fn finish_kick_connection(
    storage: &Storage,
    http: &Client,
    backend_url: &str,
    callback: &AuthCallback,
    code_verifier: &str,
) -> Result<Account, String> {
    println!("[kick/auth] exchanging callback code with backend");
    let tokens = exchange_kick_code(http, backend_url, &callback.code, code_verifier)?;
    println!("[kick/auth] token exchange succeeded; fetching Kick user");
    let user = fetch_kick_user(http, &tokens.access_token)?;
    println!("[kick/auth] fetched Kick user @{}", user.name);

    let expires_at = tokens
        .expires_in
        .map(|expires_in| (now_millis() / 1000).saturating_add(expires_in));
    let account_id = format!("kick:{}", user.user_id);
    let scopes = tokens.scope.unwrap_or_default();

    println!("[kick/auth] persisting Kick account {account_id}");
    storage
        .accounts()
        .upsert(UpsertAccount {
            id: &account_id,
            platform: Platform::Kick,
            platform_user_id: &user.user_id,
            username: &user.name,
            display_name: &user.name,
            avatar_url: user.profile_picture.as_deref(),
            access_token: &tokens.access_token,
            refresh_token: tokens.refresh_token.as_deref(),
            expires_at,
            scopes: &scopes,
        })
        .map_err(|error| error.to_string())?;

    println!("[kick/auth] reloading persisted Kick account {account_id}");
    storage
        .accounts()
        .find_all()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|account| account.id == account_id)
        .ok_or_else(|| String::from("Kick account persisted but could not be reloaded"))
}

struct PendingKickCallback {
    callback: AuthCallback,
    stream: TcpStream,
}

fn build_kick_auth_url(
    http: &Client,
    backend_url: &str,
    code_challenge: &str,
    state: &str,
) -> Result<String, String> {
    let response = http
        .post(format!("{backend_url}/api/auth/kick/start"))
        .json(&serde_json::json!({
            "codeChallenge": code_challenge,
            "state": state,
            "redirectUri": KICK_REDIRECT_URI,
        }))
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[kick/auth] auth URL request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[kick/auth] auth URL response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Kick auth URL request failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    let body: KickBuildUrlResponse = response.json().map_err(|error| error.to_string())?;
    Ok(body.url)
}

fn wait_for_kick_callback(expected_state: &str) -> Result<PendingKickCallback, String> {
    let listener = TcpListener::bind("127.0.0.1:45825").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;

    let (mut stream, address) = listener.accept().map_err(|error| error.to_string())?;
    println!("[kick/auth] accepted callback connection from {address}");
    let mut buffer = [0_u8; 8192];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| String::from("Invalid callback request"))?;
    let url =
        Url::parse(&format!("http://localhost:45825{path}")).map_err(|error| error.to_string())?;
    let callback = AuthCallback::from_url(&url).map_err(|error| error.to_string())?;
    println!(
        "[kick/auth] callback parsed: code_present={}, state_present={}",
        !callback.code.is_empty(),
        !callback.state.is_empty()
    );
    if callback.state != expected_state {
        let page = error_page("OAuth state mismatch");
        write_callback_page(&mut stream, page.status, page.content_type, &page.body)?;
        return Err(String::from("Kick OAuth state mismatch"));
    }

    Ok(PendingKickCallback { callback, stream })
}

fn write_callback_page(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_reason(status),
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}

fn exchange_kick_code(
    http: &Client,
    backend_url: &str,
    code: &str,
    code_verifier: &str,
) -> Result<KickExchangeResponse, String> {
    let response = http
        .post(format!("{backend_url}/api/auth/kick/exchange"))
        .json(&serde_json::json!({
            "code": code,
            "codeVerifier": code_verifier,
            "redirectUri": KICK_REDIRECT_URI,
        }))
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[kick/auth] token exchange request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[kick/auth] token exchange response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Kick token exchange failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    response.json().map_err(|error| error.to_string())
}

fn fetch_kick_user(http: &Client, access_token: &str) -> Result<KickUser, String> {
    let response = http
        .get("https://api.kick.com/public/v1/users")
        .bearer_auth(access_token)
        .send()
        .map_err(|error| {
            let message = error.to_string();
            println!("[kick/auth] Kick user request failed before response: {message}");
            message
        })?;

    let status = response.status();
    println!("[kick/auth] Kick user response status: {status}");

    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(format!(
            "Kick user info request failed with {status}: {}",
            body_snippet(&body)
        ));
    }

    let body: KickUsersResponse = response.json().map_err(|error| error.to_string())?;
    body.data
        .into_iter()
        .next()
        .ok_or_else(|| String::from("Kick user info response empty"))
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

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

#[derive(Deserialize)]
struct KickBuildUrlResponse {
    url: String,
}

#[derive(Deserialize)]
struct KickExchangeResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresIn")]
    expires_in: Option<u64>,
    scope: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct KickUsersResponse {
    data: Vec<KickUser>,
}

#[derive(Deserialize)]
struct KickUser {
    #[serde(rename = "user_id", deserialize_with = "deserialize_user_id")]
    user_id: String,
    name: String,
    #[serde(rename = "profile_picture")]
    profile_picture: Option<String>,
}

fn deserialize_user_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum UserId {
        Number(u64),
        String(String),
    }

    match UserId::deserialize(deserializer)? {
        UserId::Number(value) => Ok(value.to_string()),
        UserId::String(value) => Ok(value),
    }
}
