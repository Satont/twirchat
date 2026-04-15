use crate::error::AppError;
use crate::state::AppState;
use crate::types::Account;

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_accounts(state: tauri::State<'_, AppState>) -> Result<Vec<Account>, AppError> {
    {
        let db = state.db()?;
        crate::store::accounts::get_all(&db)
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure or if not found.
pub fn get_account(state: tauri::State<'_, AppState>, id: String) -> Result<Account, AppError> {
    {
        let db = state.db()?;
        crate::store::accounts::get_by_id(&db, &id)?
            .ok_or_else(|| AppError::NotFound(format!("account {id}")))
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn remove_account(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    {
        let db = state.db()?;
        crate::store::accounts::delete(&db, &id)
    }
}
