use crate::error::AppError;
use crate::platforms::adapter::AdapterState;
use crate::state::AppState;
use crate::types::{
    ConnectionMode, Platform, PlatformStatus, PlatformStatusInfo, WatchedChannel,
    WatchedChannelStatus,
};

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_watched_channels(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WatchedChannel>, AppError> {
    {
        let db = state.db()?;
        crate::store::watched_channels::get_all(&db)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn add_watched_channel(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    channel_slug: String,
) -> Result<WatchedChannel, AppError> {
    {
        let db = state.db()?;
        crate::store::watched_channels::add(&db, platform, &channel_slug, &channel_slug)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn remove_watched_channel(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    {
        let db = state.db()?;
        crate::store::watched_channels::remove(&db, &id)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_watched_channel_messages(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<crate::NormalizedChatMessage>, AppError> {
    let channel_slug = {
        let channels = {
            let db = state.db()?;
            crate::store::watched_channels::get_all(&db)?
        };
        channels
            .into_iter()
            .find(|c| c.id == id)
            .map(|channel| channel.channel_slug)
            .ok_or_else(|| AppError::NotFound(format!("watched channel {id}")))?
    };

    {
        let db = state.db()?;
        crate::store::messages::get_recent(&db, &channel_slug, 100)
    }
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or adapter failure.
pub async fn send_watched_channel_message(
    state: tauri::State<'_, AppState>,
    id: String,
    text: String,
    reply_to_message_id: Option<String>,
) -> Result<(), AppError> {
    let watched_channel = {
        let db = state.db()?;
        crate::store::watched_channels::get_all(&db)?
            .into_iter()
            .find(|channel| channel.id == id)
            .ok_or_else(|| AppError::NotFound(format!("watched channel {id}")))?
    };

    crate::commands::channels::send_message_inner(
        &state,
        watched_channel.platform,
        &watched_channel.channel_slug,
        &text,
        reply_to_message_id.as_deref(),
    )
    .await
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub async fn get_watched_channel_statuses(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WatchedChannelStatus>, AppError> {
    let channels = {
        let db = state.db()?;
        crate::store::watched_channels::get_all(&db)?
    };

    let mut statuses = Vec::new();
    for ch in channels {
        let adapter_state = match ch.platform {
            Platform::Twitch => state.twitch_manager.get_state(&ch.channel_slug).await,
            Platform::Kick => state.kick_manager.get_state(&ch.channel_slug).await,
            Platform::YouTube => state.youtube_manager.get_state(&ch.channel_slug).await,
        };

        let (status, error) = adapter_state_to_platform_status(&adapter_state);
        statuses.push(WatchedChannelStatus {
            channel_id: ch.id,
            status: PlatformStatusInfo {
                platform: ch.platform,
                status,
                error,
                mode: ConnectionMode::Anonymous,
                channel_login: Some(ch.channel_slug),
            },
        });
    }
    Ok(statuses)
}

fn adapter_state_to_platform_status(state: &AdapterState) -> (PlatformStatus, Option<String>) {
    match state {
        AdapterState::Connected => (PlatformStatus::Connected, None),
        AdapterState::Connecting => (PlatformStatus::Connecting, None),
        AdapterState::Disconnected | AdapterState::Disconnecting => {
            (PlatformStatus::Disconnected, None)
        }
        AdapterState::Error(e) => (PlatformStatus::Error, Some(e.clone())),
    }
}
