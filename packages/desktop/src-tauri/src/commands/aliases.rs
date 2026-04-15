use crate::error::AppError;
use crate::state::AppState;
use crate::types::{Platform, UserAlias};

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_user_aliases(state: tauri::State<'_, AppState>) -> Result<Vec<UserAlias>, AppError> {
    let map = {
        let db = state.db()?;
        crate::store::user_aliases::get_all(&db)?
    };
    let aliases = map
        .into_iter()
        .map(|((platform, platform_user_id), alias)| UserAlias {
            platform,
            platform_user_id,
            alias,
            created_at: 0,
            updated_at: 0,
        })
        .collect();
    Ok(aliases)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn set_user_alias(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    platform_user_id: String,
    alias: String,
) -> Result<(), AppError> {
    {
        let db = state.db()?;
        crate::store::user_aliases::set_alias(&db, platform, &platform_user_id, &alias)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn remove_user_alias(
    state: tauri::State<'_, AppState>,
    platform: Platform,
    platform_user_id: String,
) -> Result<(), AppError> {
    {
        let db = state.db()?;
        crate::store::user_aliases::remove_alias(&db, platform, &platform_user_id)
    }
}
