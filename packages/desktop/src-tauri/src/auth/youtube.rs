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

const YOUTUBE_CALLBACK_PATH: &str = "/auth/youtube/callback";
const YOUTUBE_CHANNELS_URL: &str =
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

#[derive(Deserialize)]
struct YouTubeStartResponse {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct YouTubeTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct YouTubeChannelsResponse {
    items: Option<Vec<YouTubeChannel>>,
}

#[derive(Deserialize)]
struct YouTubeChannel {
    id: String,
    snippet: YouTubeChannelSnippet,
}

#[derive(Deserialize)]
struct YouTubeChannelSnippet {
    title: String,
    #[serde(rename = "customUrl")]
    custom_url: Option<String>,
    thumbnails: Option<YouTubeThumbnailSet>,
}

#[derive(Deserialize)]
struct YouTubeThumbnailSet {
    default: Option<YouTubeThumbnail>,
}

#[derive(Deserialize)]
struct YouTubeThumbnail {
    url: String,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    sub: String,
    name: Option<String>,
    given_name: Option<String>,
    picture: Option<String>,
}

struct YouTubeProfile {
    user_id: String,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

/// Starts the `YouTube` PKCE OAuth flow and stores the resulting account locally.
///
/// # Errors
///
/// Returns [`AppError::Auth`] for OAuth/browser/network failures and [`AppError::Database`] for storage failures.
pub async fn start_auth_flow<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), AppError> {
    let result = async {
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);
        let expected_state = generate_state();
        let callback_server = start_callback_server(YOUTUBE_CALLBACK_PATH).await?;
        let app_state = app_handle.state::<crate::state::AppState>();
        let backend_url = app_state.backend_url.clone();
        let client = app_state.http_client.clone();
        let client_secret = {
            let conn = open_connection(&app_handle)?;
            crate::store::client_identity::get_or_create(&conn)?
        };
        let start_url = format!("{backend_url}/api/auth/youtube/start");
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
            .map_err(|error| auth_error(format!("youtube auth start request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("youtube auth start failed: {error}")))?
            .json::<YouTubeStartResponse>()
            .await
            .map_err(|error| auth_error(format!("youtube auth start decode: {error}")))?;

        open_system_browser(&app_handle, &auth_url.url)?;

        let (code, state) = callback_server
            .receiver
            .await
            .map_err(|error| auth_error(format!("receive youtube callback: {error}")))?;

        if state != expected_state {
            return Err(auth_error("youtube oauth state mismatch"));
        }

        let exchange_url = format!("{backend_url}/api/auth/youtube/exchange");
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
            .map_err(|error| auth_error(format!("youtube auth exchange request: {error}")))?
            .error_for_status()
            .map_err(|error| auth_error(format!("youtube auth exchange failed: {error}")))?
            .json::<YouTubeTokenResponse>()
            .await
            .map_err(|error| auth_error(format!("youtube auth exchange decode: {error}")))?;
        let profile = fetch_user(&client, &tokens.access_token).await?;
        let expires_at = tokens
            .expires_in
            .map(|expires_in| now_unix_seconds().map(|now| now + expires_in))
            .transpose()?;

        let account = Account {
            id: format!("youtube:{}", profile.user_id),
            platform: Platform::YouTube,
            platform_user_id: profile.user_id.clone(),
            username: profile.username,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
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
            Platform::YouTube,
            &account.username,
            &account.display_name,
        );

        Ok(())
    }
    .await;

    if let Err(error) = &result {
        emit_auth_error(&app_handle, Platform::YouTube, error);
    }

    result
}

async fn fetch_user(client: &Client, access_token: &str) -> Result<YouTubeProfile, AppError> {
    let channels_response = client
        .get(YOUTUBE_CHANNELS_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| auth_error(format!("fetch youtube channel info: {error}")))?;

    if channels_response.status().is_success() {
        let payload = channels_response
            .json::<YouTubeChannelsResponse>()
            .await
            .map_err(|error| auth_error(format!("decode youtube channel info: {error}")))?;

        let channel = payload
            .items
            .and_then(|items| items.into_iter().next())
            .ok_or_else(|| auth_error("youtube user info response empty"))?;

        let username = channel.custom_url_or_id();
        return Ok(YouTubeProfile {
            user_id: channel.id,
            username,
            display_name: channel.snippet.title,
            avatar_url: channel
                .snippet
                .thumbnails
                .and_then(|thumbnails| thumbnails.default)
                .map(|thumbnail| thumbnail.url),
        });
    }

    let channel_status = channels_response.status();
    let channel_body = channels_response
        .text()
        .await
        .map_err(|error| auth_error(format!("read youtube channels error body: {error}")))?;

    let userinfo_response = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| auth_error(format!("fetch google user info: {error}")))?;

    if !userinfo_response.status().is_success() {
        let userinfo_status = userinfo_response.status();
        let userinfo_body = userinfo_response
            .text()
            .await
            .map_err(|error| auth_error(format!("read google userinfo error body: {error}")))?;
        return Err(auth_error(format!(
            "youtube user info request failed: {channel_status} {channel_body}; {userinfo_status} {userinfo_body}"
        )));
    }

    let userinfo = userinfo_response
        .json::<GoogleUserInfo>()
        .await
        .map_err(|error| auth_error(format!("decode google userinfo response: {error}")))?;
    let display_name = userinfo
        .name
        .or(userinfo.given_name)
        .unwrap_or_else(|| userinfo.sub.clone());

    Ok(YouTubeProfile {
        user_id: userinfo.sub.clone(),
        username: userinfo.sub,
        display_name,
        avatar_url: userinfo.picture,
    })
}

impl YouTubeChannel {
    fn custom_url_or_id(&self) -> String {
        self.snippet
            .custom_url
            .clone()
            .unwrap_or_else(|| self.id.clone())
    }
}
