use crate::error::AppError;
use crate::platforms::adapter::PlatformAdapter;
use crate::state::AppState;
use crate::types::{DesktopToBackendMessage, Platform};
use std::collections::HashMap;
use std::sync::Arc;

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_channels(
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<Platform, Vec<String>>, AppError> {
    let connections = {
        let db = state.db()?;
        crate::store::connections::get_all(&db)?
    };
    let mut map: HashMap<Platform, Vec<String>> = HashMap::new();
    for ch in connections {
        map.entry(ch.platform).or_default().push(ch.channel_slug);
    }
    Ok(map)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on adapter or database failure.
pub async fn join_channel(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    channel_slug: String,
) -> Result<(), AppError> {
    match platform {
        Platform::Twitch => {
            state
                .twitch_manager
                .connect(
                    Arc::clone(&state.twitch_adapter),
                    &channel_slug,
                    state.event_tx.clone(),
                )
                .await?;
        }
        Platform::Kick => {
            state
                .kick_manager
                .connect(
                    Arc::clone(&state.kick_adapter),
                    &channel_slug,
                    state.event_tx.clone(),
                )
                .await?;
        }
        Platform::YouTube => {
            return Err(AppError::Adapter("YouTube join not supported".into()));
        }
    }

    if let Some(seventv_channel_id) = seventv_channel_id(&state, platform, &channel_slug) {
        state
            .backend
            .add_subscription(platform, seventv_channel_id.clone());
        let _ = state
            .backend
            .send(DesktopToBackendMessage::SeventvSubscribe {
                platform,
                channel_id: seventv_channel_id,
            });
    }

    {
        let db = state.db()?;
        crate::store::connections::upsert(&db, platform, &channel_slug)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on adapter or database failure.
pub async fn leave_channel(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    channel_slug: String,
) -> Result<(), AppError> {
    match platform {
        Platform::Twitch => {
            state.twitch_manager.disconnect(&channel_slug).await?;
        }
        Platform::Kick => {
            state.kick_manager.disconnect(&channel_slug).await?;
        }
        Platform::YouTube => {
            state.youtube_manager.disconnect(&channel_slug).await?;
        }
    }

    if let Some(seventv_channel_id) = seventv_channel_id(&state, platform, &channel_slug) {
        state
            .backend
            .remove_subscription(platform, seventv_channel_id.clone());
        let _ = state
            .backend
            .send(DesktopToBackendMessage::SeventvUnsubscribe {
                platform,
                channel_id: seventv_channel_id,
            });
    }

    {
        let db = state.db()?;
        crate::store::connections::delete(&db, platform, &channel_slug)
    }
}

pub(crate) async fn send_message_inner(
    state: &AppState,
    platform: Platform,
    channel_id: &str,
    text: &str,
    reply_to_message_id: Option<&str>,
) -> Result<(), AppError> {
    match platform {
        Platform::Twitch => {
            state
                .twitch_adapter
                .send_message(channel_id, text, reply_to_message_id)
                .await
        }
        Platform::Kick => {
            state
                .kick_adapter
                .send_message(channel_id, text, reply_to_message_id)
                .await
        }
        Platform::YouTube => Err(AppError::Adapter(
            "youtube message sending is not supported".to_owned(),
        )),
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on adapter failure.
pub async fn send_message(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    channel_id: String,
    text: String,
    reply_to_message_id: Option<String>,
) -> Result<(), AppError> {
    send_message_inner(
        &state,
        platform,
        &channel_id,
        &text,
        reply_to_message_id.as_deref(),
    )
    .await
}

fn seventv_channel_id(state: &AppState, platform: Platform, channel_slug: &str) -> Option<String> {
    match platform {
        Platform::Twitch => Some(channel_slug.to_owned()),
        Platform::Kick => Some(
            state
                .kick_adapter
                .broadcaster_user_id()
                .unwrap_or_else(|| channel_slug.to_owned()),
        ),
        Platform::YouTube => None,
    }
}
