use crate::protocol::messages::{
    TwitchUserCardAuth, UserCardMetadataBackendRequest, UserCardMetadataPlatform,
    UserCardMetadataRequest, UserCardMetadataResponse,
};
use crate::protocol::rpc::{GetUserChatHistoryParams, UserChatHistoryPage};
use crate::protocol::types::Platform;
use crate::runtime::RuntimeConfig;
use crate::storage::{Storage, StorageError, TokenState};
use std::error::Error;
use std::fmt;

const USER_CARD_METADATA_PATH: &str = "/api/user-card-metadata";

#[derive(Debug)]
pub enum UserCardServiceError {
    Storage(StorageError),
    Http(reqwest::Error),
    HttpStatus {
        status: reqwest::StatusCode,
        body: String,
    },
}

impl fmt::Display for UserCardServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "failed to load user-card storage data: {source}"),
            Self::Http(source) => write!(f, "user-card metadata request failed: {source}"),
            Self::HttpStatus { status, body } => {
                write!(f, "user-card metadata request failed with {status}: {body}")
            }
        }
    }
}

impl Error for UserCardServiceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(source) => Some(source),
            Self::Http(source) => Some(source),
            Self::HttpStatus { .. } => None,
        }
    }
}

impl From<StorageError> for UserCardServiceError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<reqwest::Error> for UserCardServiceError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value)
    }
}

pub type UserCardServiceResult<T> = Result<T, UserCardServiceError>;

pub fn get_user_chat_history(
    storage: &Storage,
    params: GetUserChatHistoryParams,
) -> UserCardServiceResult<UserChatHistoryPage> {
    Ok(storage.messages().get_by_user(
        params.platform,
        &params.platform_user_id,
        params.limit,
        params.cursor.as_ref(),
    )?)
}

pub fn build_user_card_backend_request(
    storage: &Storage,
    request: UserCardMetadataRequest,
) -> UserCardServiceResult<UserCardMetadataBackendRequest> {
    let twitch_auth = match request.platform {
        UserCardMetadataPlatform::Twitch => find_twitch_auth(storage)?,
        UserCardMetadataPlatform::Kick => None,
    };

    Ok(UserCardMetadataBackendRequest {
        request,
        twitch_auth,
    })
}

pub fn fetch_user_card_metadata(
    storage: &Storage,
    config: &RuntimeConfig,
    request: UserCardMetadataRequest,
) -> UserCardServiceResult<UserCardMetadataResponse> {
    let body = build_user_card_backend_request(storage, request)?;
    let backend_request = config.backend_request(USER_CARD_METADATA_PATH);
    let client = reqwest::blocking::Client::new();
    let mut http_request = client.post(backend_request.url).json(&body);
    for (name, value) in backend_request.headers {
        http_request = http_request.header(name, value);
    }

    let response = http_request.send()?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_else(|error| error.to_string());
        return Err(UserCardServiceError::HttpStatus { status, body });
    }

    Ok(response.json()?)
}

fn find_twitch_auth(storage: &Storage) -> UserCardServiceResult<Option<TwitchUserCardAuth>> {
    let accounts = storage.accounts().find_all_with_token_state()?;
    Ok(accounts.into_iter().find_map(|entry| {
        if entry.account.platform != Platform::Twitch || entry.account.platform_user_id.is_empty() {
            return None;
        }

        let TokenState::Valid(tokens) = entry.token_state else {
            return None;
        };

        Some(TwitchUserCardAuth {
            access_token: tokens.access_token,
            platform_user_id: entry.account.platform_user_id,
            scopes: entry.account.scopes,
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::rpc::GetUserChatHistoryParams;
    use crate::protocol::types::{ChatAuthor, ChatMessageType, NormalizedChatMessage};
    use crate::storage::accounts::UpsertAccount;

    #[test]
    fn user_card_metadata_request_includes_twitch_auth() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("user-card-metadata-twitch")?;
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
            scopes: &[
                "moderator:read:followers".to_string(),
                "channel:read:subscriptions".to_string(),
            ],
        })?;

        let request = build_user_card_backend_request(
            &storage,
            metadata_request(UserCardMetadataPlatform::Twitch),
        )?;

        assert_eq!(
            request.twitch_auth,
            Some(TwitchUserCardAuth {
                access_token: "access-token".to_string(),
                platform_user_id: "broadcaster-1".to_string(),
                scopes: vec![
                    "moderator:read:followers".to_string(),
                    "channel:read:subscriptions".to_string(),
                ],
            })
        );
        Ok(())
    }

    #[test]
    fn user_card_metadata_request_omits_kick_auth() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("user-card-metadata-kick")?;
        storage.accounts().upsert(UpsertAccount {
            id: "twitch-account",
            platform: Platform::Twitch,
            platform_user_id: "broadcaster-1",
            username: "streamer",
            display_name: "Streamer",
            avatar_url: None,
            access_token: "access-token",
            refresh_token: None,
            expires_at: None,
            scopes: &["moderator:read:followers".to_string()],
        })?;

        let request = build_user_card_backend_request(
            &storage,
            metadata_request(UserCardMetadataPlatform::Kick),
        )?;

        assert_eq!(request.twitch_auth, None);
        Ok(())
    }

    #[test]
    fn user_card_history_loads_storage_by_user() -> Result<(), Box<dyn Error>> {
        let storage = temp_storage("user-card-history-service")?;
        storage.messages().save(&chat_message(
            "twitch-old",
            Platform::Twitch,
            "twitch-user",
            1_700_000_001,
        ))?;
        storage.messages().save(&chat_message(
            "twitch-new",
            Platform::Twitch,
            "twitch-user",
            1_700_000_002,
        ))?;
        storage.messages().save(&chat_message(
            "kick-other",
            Platform::Kick,
            "twitch-user",
            1_700_000_003,
        ))?;

        let page = get_user_chat_history(
            &storage,
            GetUserChatHistoryParams {
                platform: Platform::Twitch,
                platform_user_id: "twitch-user".to_string(),
                limit: Some(10),
                cursor: None,
            },
        )?;

        assert_eq!(
            page.messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["twitch-old", "twitch-new"]
        );
        Ok(())
    }

    fn metadata_request(platform: UserCardMetadataPlatform) -> UserCardMetadataRequest {
        UserCardMetadataRequest {
            platform,
            platform_user_id: "viewer-1".to_string(),
            username: Some("viewer".to_string()),
            channel_id: Some("streamer".to_string()),
            channel_slug: Some("streamer".to_string()),
        }
    }

    fn temp_storage(name: &str) -> Result<Storage, Box<dyn Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.keep().join(format!("{name}.sqlite"));
        Ok(Storage::open(&path)?)
    }

    fn chat_message(
        id: &str,
        platform: Platform,
        author_id: &str,
        timestamp: u64,
    ) -> NormalizedChatMessage {
        NormalizedChatMessage {
            id: id.to_string(),
            platform,
            channel_id: "channel-1".to_string(),
            author: ChatAuthor {
                id: author_id.to_string(),
                username: Some("viewer".to_string()),
                display_name: "Viewer".to_string(),
                color: None,
                avatar_url: None,
                badges: Vec::new(),
            },
            text: id.to_string(),
            emotes: Vec::new(),
            timestamp: timestamp.to_string(),
            message_type: ChatMessageType::Message,
            reply: None,
        }
    }
}
