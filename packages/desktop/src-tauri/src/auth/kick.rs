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

const KICK_CALLBACK_PATH: &str = "/auth/kick/callback";
const KICK_USER_URL: &str = "https://api.kick.com/public/v1/users";

#[derive(Deserialize)]
struct KickStartResponse {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KickTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct KickUsersResponse {
    data: Vec<KickUser>,
}

#[derive(Deserialize)]
struct KickUser {
    user_id: u64,
    name: String,
    profile_picture: Option<String>,
}

/// Starts the Kick PKCE OAuth flow and stores the resulting account locally.
///
/// # Errors
///
/// Returns [`AppError::Auth`] for OAuth/browser/network failures and [`AppError::Database`] for storage failures.
pub async fn start_auth_flow<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), AppError> {
    let result = async {
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);
        let expected_state = generate_state();
        let callback_server = start_callback_server(KICK_CALLBACK_PATH).await?;
        let app_state = app_handle.state::<crate::state::AppState>();
        let backend_url = app_state.backend_url.clone();
        let client = app_state.http_client.clone();
        let client_secret = {
            let conn = open_connection(&app_handle)?;
            crate::store::client_identity::get_or_create(&conn)?
        };
        let start_url = format!("{backend_url}/api/auth/kick/start");
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
            .map_err(|error| auth_error(format!("kick auth start request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("kick auth start failed: {error}")))?
            .json::<KickStartResponse>()
            .await
            .map_err(|error| auth_error(format!("kick auth start decode: {error}")))?;

        open_system_browser(&app_handle, &auth_url.url)?;

        let (code, state) = callback_server
            .receiver
            .await
            .map_err(|error| auth_error(format!("receive kick callback: {error}")))?;

        if state != expected_state {
            return Err(auth_error("kick oauth state mismatch"));
        }

        let exchange_url = format!("{backend_url}/api/auth/kick/exchange");
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
            .map_err(|error| auth_error(format!("kick auth exchange request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("kick auth exchange failed: {error}")))?
            .json::<KickTokenResponse>()
            .await
            .map_err(|error| auth_error(format!("kick auth exchange decode: {error}")))?;
        let user = fetch_user(&client, &tokens.access_token).await?;
        let expires_at = tokens
            .expires_in
            .map(|expires_in| now_unix_seconds().map(|now| now + expires_in))
            .transpose()?;

        let account = Account {
            id: format!("kick:{}", user.user_id),
            platform: Platform::Kick,
            platform_user_id: user.user_id.to_string(),
            username: user.name.clone(),
            display_name: user.name.clone(),
            avatar_url: user.profile_picture,
            scopes: tokens.scope.unwrap_or_default(),
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
            Platform::Kick,
            &account.username,
            &account.display_name,
        );

        Ok(())
    }
    .await;

    if let Err(error) = &result {
        emit_auth_error(&app_handle, Platform::Kick, error);
    }

    result
}

async fn fetch_user(client: &Client, access_token: &str) -> Result<KickUser, AppError> {
    let response = client
        .get(KICK_USER_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| auth_error(format!("fetch kick user: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| auth_error(format!("read kick user error body: {error}")))?;
        return Err(auth_error(format!(
            "kick user info request failed: {status} {body}"
        )));
    }

    let payload = response
        .json::<KickUsersResponse>()
        .await
        .map_err(|error| auth_error(format!("decode kick user response: {error}")))?;

    payload
        .data
        .into_iter()
        .next()
        .ok_or_else(|| auth_error("kick user info response empty"))
}
