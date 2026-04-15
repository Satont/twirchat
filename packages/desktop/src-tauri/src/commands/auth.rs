use crate::auth;
use crate::error::AppError;
use crate::state::AppState;
use crate::types::Platform;

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns an error if the OAuth flow fails for the selected platform.
pub async fn auth_start(app_handle: tauri::AppHandle, platform: Platform) -> Result<(), AppError> {
    match platform {
        Platform::Twitch => auth::twitch::start_auth_flow(app_handle).await,
        Platform::YouTube => auth::youtube::start_auth_flow(app_handle).await,
        Platform::Kick => auth::kick::start_auth_flow(app_handle).await,
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn auth_logout(state: tauri::State<'_, AppState>, platform: Platform) -> Result<(), AppError> {
    let account_ids = {
        let db = state.db()?;
        crate::store::accounts::get_all(&db)?
            .into_iter()
            .filter(|account| account.platform == platform)
            .map(|account| account.id)
            .collect::<Vec<_>>()
    };

    {
        let db = state.db()?;
        for account_id in account_ids {
            crate::store::accounts::delete(&db, &account_id)?;
        }
    }

    Ok(())
}
