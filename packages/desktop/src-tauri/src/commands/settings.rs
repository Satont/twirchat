use crate::error::AppError;
use crate::state::AppState;
use crate::types::AppSettings;

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, AppError> {
    {
        let db = state.db()?;
        crate::store::settings::get(&db)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure or serialisation failure.
pub fn save_settings(
    state: tauri::State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), AppError> {
    {
        let db = state.db()?;
        crate::store::settings::update(&db, &settings)
    }
}
