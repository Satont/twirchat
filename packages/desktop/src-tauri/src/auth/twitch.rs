use crate::auth::{
    auth_error, emit_auth_error, emit_auth_success, generate_state, now_unix_seconds,
    open_connection, open_system_browser,
};
use crate::store::accounts::{self, AccountTokens};
use crate::{Account, AppError, Platform};
use reqwest::Client;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

use super::pkce::{generate_code_challenge, generate_code_verifier};
use super::server::start_callback_server;

const TWITCH_CALLBACK_PATH: &str = "/auth/twitch/callback";
const TWITCH_VALIDATE_URL: &str = "https://id.twitch.tv/oauth2/validate";

#[derive(Deserialize)]
struct TwitchStartResponse {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TwitchTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct TwitchValidateResponse {
    user_id: String,
    login: String,
    scopes: Vec<String>,
}

/// Starts the Twitch PKCE OAuth flow and stores the resulting account locally.
///
/// # Errors
///
/// Returns [`AppError::Auth`] for OAuth/browser/network failures and [`AppError::Database`] for storage failures.
pub async fn start_auth_flow<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), AppError> {
    let result = async {
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);
        let expected_state = generate_state();
        let callback_server = start_callback_server(TWITCH_CALLBACK_PATH).await?;
        let app_state = app_handle.state::<crate::state::AppState>();
        let backend_url = app_state.backend_url.clone();
        let client = app_state.http_client.clone();
        let client_secret = {
            let conn = open_connection(&app_handle)?;
            crate::store::client_identity::get_or_create(&conn)?
        };
        let start_url = format!("{backend_url}/api/auth/twitch/start");
        let auth_url = client
            .post(&start_url)
            .header("X-Client-Secret", &client_secret)
            .json(&serde_json::json!({
                "codeChallenge": code_challenge,
                "state": expected_state,
                "redirectUri": callback_server.redirect_uri,
            }))
            .send()
            .await
            .map_err(|error| auth_error(format!("twitch auth start request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("twitch auth start failed: {error}")))?
            .json::<TwitchStartResponse>()
            .await
            .map_err(|error| auth_error(format!("twitch auth start decode: {error}")))?;

        open_system_browser(&app_handle, &auth_url.url)?;

        let (code, state) = callback_server
            .receiver
            .await
            .map_err(|error| auth_error(format!("receive twitch callback: {error}")))?;

        if state != expected_state {
            return Err(auth_error("twitch oauth state mismatch"));
        }

        let exchange_url = format!("{backend_url}/api/auth/twitch/exchange");
        let tokens = client
            .post(&exchange_url)
            .header("X-Client-Secret", &client_secret)
            .json(&serde_json::json!({
                "code": code,
                "codeVerifier": code_verifier,
                "redirectUri": callback_server.redirect_uri,
            }))
            .send()
            .await
            .map_err(|error| auth_error(format!("twitch auth exchange request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("twitch auth exchange failed: {error}")))?
            .json::<TwitchTokenResponse>()
            .await
            .map_err(|error| auth_error(format!("twitch auth exchange decode: {error}")))?;
        let profile = fetch_user(&client, &tokens.access_token).await?;
        let expires_at = tokens
            .expires_in
            .map(|expires_in| now_unix_seconds().map(|now| now + expires_in))
            .transpose()?;

        let account = Account {
            id: format!("twitch:{}", profile.user_id),
            platform: Platform::Twitch,
            platform_user_id: profile.user_id.clone(),
            username: profile.login.clone(),
            display_name: profile.login.clone(),
            avatar_url: None,
            scopes: tokens.scope.unwrap_or(profile.scopes),
            created_at: 0,
            updated_at: 0,
        };

        let token_record = AccountTokens {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
        };

        let conn = open_connection(&app_handle)?;
        accounts::upsert(&conn, &account, &token_record)?;
        emit_auth_success(
            &app_handle,
            Platform::Twitch,
            &account.username,
            &account.display_name,
        );

        Ok(())
    }
    .await;

    if let Err(error) = &result {
        emit_auth_error(&app_handle, Platform::Twitch, error);
    }

    result
}

async fn fetch_user(
    client: &Client,
    access_token: &str,
) -> Result<TwitchValidateResponse, AppError> {
    let response = client
        .get(TWITCH_VALIDATE_URL)
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .await
        .map_err(|error| auth_error(format!("fetch twitch user: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| auth_error(format!("read twitch validate error body: {error}")))?;
        return Err(auth_error(format!(
            "twitch token validation failed: {status} {body}"
        )));
    }

    response
        .json::<TwitchValidateResponse>()
        .await
        .map_err(|error| auth_error(format!("decode twitch user response: {error}")))
}
