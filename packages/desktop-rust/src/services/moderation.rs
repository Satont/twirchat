use crate::protocol::types::{ModerationAction, ModerationBanResponse, ModerationError, Platform};
use crate::runtime::RuntimeConfig;
use crate::storage::{Storage, StorageError, TokenState};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;
use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum ModerationServiceError {
    Storage(StorageError),
    Http(reqwest::Error),
    HttpStatus {
        status: u16,
        body: String,
    },
    InvalidKickUserId(String),
    InvalidKickBroadcasterId(String),
    MissingScope {
        platform: Platform,
        scope: &'static str,
    },
    NoAccount(Platform),
    UnsupportedPlatform(Platform),
}

impl fmt::Display for ModerationServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "failed to load moderation storage data: {source}"),
            Self::Http(source) => write!(f, "moderation request failed: {source}"),
            Self::HttpStatus { status, body } => {
                write!(f, "moderation request failed with {status}: {body}")
            }
            Self::InvalidKickUserId(user_id) => write!(f, "invalid Kick user id: {user_id}"),
            Self::InvalidKickBroadcasterId(broadcaster_id) => {
                write!(f, "invalid Kick broadcaster user id: {broadcaster_id}")
            }
            Self::MissingScope { platform, scope } => write!(
                f,
                "local {platform:?} account is missing required moderation scope {scope}; reconnect the account"
            ),
            Self::NoAccount(platform) => {
                write!(f, "no local account found for platform: {platform:?}")
            }
            Self::UnsupportedPlatform(platform) => {
                write!(f, "moderation is not supported for platform: {platform:?}")
            }
        }
    }
}

impl Error for ModerationServiceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::Http(source) => Some(source),
            Self::HttpStatus { .. }
            | Self::InvalidKickUserId(_)
            | Self::InvalidKickBroadcasterId(_)
            | Self::MissingScope { .. }
            | Self::NoAccount(_)
            | Self::UnsupportedPlatform(_) => None,
        }
    }
}

impl From<StorageError> for ModerationServiceError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<reqwest::Error> for ModerationServiceError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value)
    }
}

pub type ModerationServiceResult<T> = Result<T, ModerationServiceError>;

#[expect(clippy::too_many_arguments)]
pub fn execute_moderation_ban(
    storage: &Storage,
    _config: &RuntimeConfig,
    platform: Platform,
    target_user_id: String,
    channel_id: String,
    action: ModerationAction,
    duration_seconds: Option<u32>,
    reason: Option<String>,
) -> ModerationServiceResult<ModerationBanResponse> {
    eprintln!(
        "[moderation-service] preparing local moderation request platform={platform:?} channel_id={channel_id} target_user_id={target_user_id} action={action:?} duration_seconds={duration_seconds:?}"
    );

    if platform == Platform::Youtube {
        return Err(ModerationServiceError::UnsupportedPlatform(platform));
    }

    let accounts = storage.accounts().find_all_with_token_state()?;
    let account = accounts.into_iter().find(|entry| {
        entry.account.platform == platform && matches!(entry.token_state, TokenState::Valid(_))
    });
    let account = account.ok_or(ModerationServiceError::NoAccount(platform))?;
    let TokenState::Valid(tokens) = account.token_state else {
        return Err(ModerationServiceError::NoAccount(platform));
    };

    eprintln!(
        "[moderation-service] using local account platform={:?} platform_user_id={} scopes={:?}",
        account.account.platform, account.account.platform_user_id, account.account.scopes,
    );

    let required_scope = required_moderation_scope(platform)
        .ok_or(ModerationServiceError::UnsupportedPlatform(platform))?;
    if !account
        .account
        .scopes
        .iter()
        .any(|scope| scope == required_scope)
    {
        return Err(ModerationServiceError::MissingScope {
            platform,
            scope: required_scope,
        });
    }

    let client = Client::new();
    match platform {
        Platform::Kick => execute_kick_ban(
            &client,
            &tokens.access_token,
            &target_user_id,
            &channel_id,
            duration_seconds,
            reason.as_deref(),
        ),
        Platform::Twitch => execute_twitch_ban(
            storage,
            &client,
            &tokens.access_token,
            &target_user_id,
            &channel_id,
            duration_seconds,
            reason.as_deref(),
        ),
        Platform::Youtube => Err(ModerationServiceError::UnsupportedPlatform(platform)),
    }
}

fn execute_kick_ban(
    client: &Client,
    access_token: &str,
    target_user_id: &str,
    channel_id: &str,
    duration_seconds: Option<u32>,
    reason: Option<&str>,
) -> ModerationServiceResult<ModerationBanResponse> {
    let banned_user_id = target_user_id
        .parse::<u64>()
        .map_err(|_| ModerationServiceError::InvalidKickUserId(target_user_id.to_string()))?;
    let broadcaster_user_id = channel_id
        .parse::<u64>()
        .map_err(|_| ModerationServiceError::InvalidKickBroadcasterId(channel_id.to_string()))?;
    let duration = duration_seconds.map(|seconds| seconds.div_ceil(60));
    let mut body = json!({
        "broadcaster_user_id": broadcaster_user_id,
        "user_id": banned_user_id,
    });
    if let Some(reason) = reason {
        body["reason"] = json!(reason);
    }
    if let Some(duration) = duration {
        body["duration"] = json!(duration);
    }

    eprintln!(
        "[moderation-service] kick request broadcaster_user_id={channel_id} target_user_id={target_user_id} duration={duration:?}"
    );

    let response = client
        .post("https://api.kick.com/public/v1/moderation/bans")
        .bearer_auth(access_token)
        .json(&body)
        .send()?;
    let status = response.status();
    let text = response.text()?;
    if !status.is_success() {
        eprintln!(
            "[moderation-service] kick moderation failed status={status} channel_id={channel_id} target_user_id={target_user_id} body={text}"
        );
        return Ok(failed_response(
            target_user_id,
            duration_seconds,
            "KICK_MODERATION_FAILED",
            status.as_u16().into(),
            format!(
                "Kick moderation failed with {status}: {}",
                body_snippet(&text)
            ),
        ));
    }

    eprintln!(
        "[moderation-service] kick moderation succeeded channel_id={channel_id} target_user_id={target_user_id} response={}",
        body_snippet(&text),
    );
    Ok(success_response(target_user_id, duration_seconds))
}

fn execute_twitch_ban(
    storage: &Storage,
    client: &Client,
    access_token: &str,
    target_user_id: &str,
    channel_id: &str,
    duration_seconds: Option<u32>,
    reason: Option<&str>,
) -> ModerationServiceResult<ModerationBanResponse> {
    let validated = validate_twitch_token(client, access_token)?;
    let broadcaster_id = twitch_broadcaster_id(storage, channel_id)?;
    let mut ban_data = json!({
        "user_id": target_user_id,
    });
    if let Some(reason) = reason {
        ban_data["reason"] = json!(reason);
    }
    if let Some(duration_seconds) = duration_seconds {
        ban_data["duration"] = json!(duration_seconds);
    }

    eprintln!(
        "[moderation-service] twitch request broadcaster_id={broadcaster_id} channel_id={channel_id} moderator_id={} target_user_id={target_user_id} duration_seconds={duration_seconds:?}",
        validated.user_id,
    );

    let response = client
        .post("https://api.twitch.tv/helix/moderation/bans")
        .query(&[
            ("broadcaster_id", broadcaster_id.as_str()),
            ("moderator_id", validated.user_id.as_str()),
        ])
        .bearer_auth(access_token)
        .header("Client-Id", validated.client_id.as_str())
        .json(&json!({ "data": ban_data }))
        .send()?;
    let status = response.status();
    let text = response.text()?;
    if !status.is_success() {
        eprintln!(
            "[moderation-service] twitch moderation failed status={status} broadcaster_id={broadcaster_id} channel_id={channel_id} moderator_id={} target_user_id={target_user_id} body={text}",
            validated.user_id,
        );
        return Ok(failed_response(
            target_user_id,
            duration_seconds,
            "TWITCH_MODERATION_FAILED",
            status.as_u16().into(),
            format!(
                "Twitch moderation failed with {status}: {}",
                body_snippet(&text)
            ),
        ));
    }

    eprintln!(
        "[moderation-service] twitch moderation succeeded broadcaster_id={broadcaster_id} channel_id={channel_id} target_user_id={target_user_id} response={}",
        body_snippet(&text),
    );
    Ok(success_response(target_user_id, duration_seconds))
}

fn twitch_broadcaster_id(storage: &Storage, channel_id: &str) -> ModerationServiceResult<String> {
    if is_twitch_user_id(channel_id) {
        return Ok(channel_id.to_string());
    }

    let watched = storage
        .watched_channels()
        .find_by_platform_and_slug(Platform::Twitch, channel_id)?;
    if let Some(broadcaster_id) = watched
        .and_then(|channel| channel.broadcaster_id)
        .filter(|broadcaster_id| is_twitch_user_id(broadcaster_id))
    {
        return Ok(broadcaster_id);
    }

    eprintln!(
        "[moderation-service] twitch broadcaster_id missing for channel_id={channel_id}; falling back to channel_id"
    );
    Ok(channel_id.to_string())
}

fn is_twitch_user_id(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|char| char.is_ascii_digit())
}

fn validate_twitch_token(
    client: &Client,
    access_token: &str,
) -> ModerationServiceResult<TwitchValidatedToken> {
    let response = client
        .get("https://id.twitch.tv/oauth2/validate")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_else(|error| error.to_string());
        eprintln!(
            "[moderation-service] twitch token validation failed status={status} body={text}"
        );
        return Err(ModerationServiceError::HttpStatus {
            status: status.as_u16(),
            body: text,
        });
    }
    Ok(response.json()?)
}

fn success_response(target_user_id: &str, duration_seconds: Option<u32>) -> ModerationBanResponse {
    ModerationBanResponse {
        success: true,
        user_id: target_user_id.to_string(),
        is_permanent: duration_seconds.is_none(),
        duration_seconds,
        error: None,
    }
}

fn failed_response(
    target_user_id: &str,
    duration_seconds: Option<u32>,
    code: &str,
    status: u32,
    message: String,
) -> ModerationBanResponse {
    ModerationBanResponse {
        success: false,
        user_id: target_user_id.to_string(),
        is_permanent: duration_seconds.is_none(),
        duration_seconds,
        error: Some(ModerationError {
            code: code.to_string(),
            status,
            message,
        }),
    }
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

fn required_moderation_scope(platform: Platform) -> Option<&'static str> {
    match platform {
        Platform::Kick => Some("moderation:ban"),
        Platform::Twitch => Some("moderator:manage:banned_users"),
        Platform::Youtube => None,
    }
}

#[derive(Debug, Deserialize)]
struct TwitchValidatedToken {
    client_id: String,
    user_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::Platform;
    use crate::storage::accounts::UpsertAccount;

    fn temp_storage(name: &str) -> Result<Storage, Box<dyn Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.keep().join(format!("{name}.sqlite"));
        Ok(Storage::open(&path)?)
    }

    #[test]
    fn no_account_returns_error() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("moderation-no-account")?;
        let config = RuntimeConfig::default();
        let result = execute_moderation_ban(
            &storage,
            &config,
            Platform::Twitch,
            "user-123".into(),
            "channel-456".into(),
            ModerationAction::Ban,
            None,
            None,
        );
        assert!(result.is_err());
        match result.unwrap_err() {
            ModerationServiceError::NoAccount(Platform::Twitch) => {}
            other => panic!("expected NoAccount(Twitch), got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn no_account_for_youtube_when_only_twitch_exists() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("moderation-youtube-no-account")?;
        storage.accounts().upsert(UpsertAccount {
            id: "twitch-account",
            platform: Platform::Twitch,
            platform_user_id: "broadcaster-1",
            username: "streamer",
            display_name: "Streamer",
            avatar_url: None,
            access_token: "access-token",
            refresh_token: Some("refresh-token"),
            expires_at: None,
            scopes: &["moderator:read:followers".to_string()],
        })?;

        let config = RuntimeConfig::default();
        let result = execute_moderation_ban(
            &storage,
            &config,
            Platform::Youtube,
            "user-123".into(),
            "channel-456".into(),
            ModerationAction::Ban,
            None,
            None,
        );
        assert!(result.is_err());
        match result.unwrap_err() {
            ModerationServiceError::UnsupportedPlatform(Platform::Youtube) => {}
            other => panic!("expected UnsupportedPlatform(Youtube), got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn invalid_kick_user_id_returns_error_before_network() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("moderation-invalid-kick-user")?;
        storage.accounts().upsert(UpsertAccount {
            id: "kick-account",
            platform: Platform::Kick,
            platform_user_id: "3195252",
            username: "streamer",
            display_name: "Streamer",
            avatar_url: None,
            access_token: "access-token",
            refresh_token: Some("refresh-token"),
            expires_at: None,
            scopes: &["moderation:ban".to_string()],
        })?;

        let config = RuntimeConfig::default();
        let result = execute_moderation_ban(
            &storage,
            &config,
            Platform::Kick,
            "not-a-number".into(),
            "3195252".into(),
            ModerationAction::Timeout,
            Some(60),
            None,
        );
        assert!(matches!(
            result.unwrap_err(),
            ModerationServiceError::InvalidKickUserId(_)
        ));
        Ok(())
    }

    #[test]
    fn missing_kick_moderation_scope_returns_reconnect_error() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("moderation-missing-kick-scope")?;
        storage.accounts().upsert(UpsertAccount {
            id: "kick-account",
            platform: Platform::Kick,
            platform_user_id: "3195252",
            username: "streamer",
            display_name: "Streamer",
            avatar_url: None,
            access_token: "access-token",
            refresh_token: Some("refresh-token"),
            expires_at: None,
            scopes: &["chat:write".to_string()],
        })?;

        let config = RuntimeConfig::default();
        let result = execute_moderation_ban(
            &storage,
            &config,
            Platform::Kick,
            "31059576".into(),
            "3195252".into(),
            ModerationAction::Timeout,
            Some(60),
            None,
        );
        assert!(matches!(
            result.unwrap_err(),
            ModerationServiceError::MissingScope {
                platform: Platform::Kick,
                scope: "moderation:ban",
            }
        ));
        Ok(())
    }

    #[test]
    fn twitch_broadcaster_id_uses_stored_watched_channel_id() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("moderation-twitch-broadcaster-id")?;
        storage.watched_channels().upsert(
            Platform::Twitch,
            "FixtureStreamer",
            "Fixture Streamer",
        )?;
        storage.watched_channels().set_broadcaster_id(
            Platform::Twitch,
            "fixturestreamer",
            "123456789",
        )?;

        assert_eq!(
            twitch_broadcaster_id(&storage, "fixturestreamer")?,
            "123456789"
        );
        assert_eq!(twitch_broadcaster_id(&storage, "987654321")?, "987654321");

        Ok(())
    }
}
