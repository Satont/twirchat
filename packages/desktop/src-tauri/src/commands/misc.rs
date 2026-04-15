use crate::error::AppError;
use crate::platforms::adapter::AdapterState;
use crate::state::AppState;
use crate::types::{ConnectionMode, Platform, PlatformStatus, PlatformStatusInfo};
use tauri_plugin_opener::OpenerExt as _;

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub async fn get_statuses(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PlatformStatusInfo>, AppError> {
    let connections = {
        let db = state.db()?;
        crate::store::connections::get_all(&db)?
    };

    let mut statuses = Vec::new();
    for ch in connections {
        let adapter_state = match ch.platform {
            Platform::Twitch => state.twitch_manager.get_state(&ch.channel_slug).await,
            Platform::Kick => state.kick_manager.get_state(&ch.channel_slug).await,
            Platform::YouTube => state.youtube_manager.get_state(&ch.channel_slug).await,
        };

        let (status, error) = adapter_state_to_status(&adapter_state);
        statuses.push(PlatformStatusInfo {
            platform: ch.platform,
            status,
            error,
            mode: ConnectionMode::Anonymous,
            channel_login: Some(ch.channel_slug),
        });
    }
    Ok(statuses)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if opening the URL fails.
pub fn open_external_url(app_handle: tauri::AppHandle, url: String) -> Result<(), AppError> {
    app_handle
        .opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Adapter(format!("open url: {e}")))
}

#[tauri::command]
/// # Errors
///
/// Always returns `Ok` — version is embedded at compile time.
pub fn get_app_version() -> Result<String, AppError> {
    Ok(env!("CARGO_PKG_VERSION").to_owned())
}

fn adapter_state_to_status(state: &AdapterState) -> (PlatformStatus, Option<String>) {
    match state {
        AdapterState::Connected => (PlatformStatus::Connected, None),
        AdapterState::Connecting => (PlatformStatus::Connecting, None),
        AdapterState::Disconnected | AdapterState::Disconnecting => {
            (PlatformStatus::Disconnected, None)
        }
        AdapterState::Error(e) => (PlatformStatus::Error, Some(e.clone())),
    }
}
