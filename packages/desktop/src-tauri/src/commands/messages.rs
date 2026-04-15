use crate::error::AppError;
use crate::state::AppState;
use crate::types::{Platform, SevenTVEmote};

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_recent_messages(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<crate::NormalizedChatMessage>, AppError> {
    let limit = u32::try_from(limit.unwrap_or(100)).unwrap_or(100);
    {
        let db = state.db()?;
        crate::store::messages::get_recent_all(&db, limit)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_username_color(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    username: String,
) -> Result<Option<String>, AppError> {
    let db = state.db()?;
    crate::store::username_colors::get(&db, platform, &username)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_channel_emotes(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    channel_id: String,
) -> Result<Vec<SevenTVEmote>, AppError> {
    state.get_channel_emotes(platform, &channel_id)
}
