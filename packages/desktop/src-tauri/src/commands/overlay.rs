use crate::error::AppError;
use crate::overlay::server;
use crate::state::AppState;
use crate::types::{NormalizedChatMessage, NormalizedEvent, OverlayConfig};

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database failure.
pub fn get_overlay_settings(state: tauri::State<'_, AppState>) -> Result<OverlayConfig, AppError> {
    let overlay = {
        let db = state.db()?;
        crate::store::settings::get(&db)?.overlay
    };
    Ok(overlay)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] on database or serialisation failure.
pub fn update_overlay_settings(
    state: tauri::State<'_, AppState>,
    settings: OverlayConfig,
) -> Result<(), AppError> {
    let mut app_settings = {
        let db = state.db()?;
        crate::store::settings::get(&db)?
    };
    app_settings.overlay = settings;

    {
        let db = state.db()?;
        crate::store::settings::update(&db, &app_settings)?;
    }

    Ok(())
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if the overlay server is unavailable.
pub fn push_overlay_message(message: NormalizedChatMessage) -> Result<(), AppError> {
    server::push_message(message);
    Ok(())
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if the overlay server is unavailable.
pub fn push_overlay_event(event: NormalizedEvent) -> Result<(), AppError> {
    server::push_event(event);
    Ok(())
}
