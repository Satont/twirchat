use crate::error::AppError;
use crate::types::{UpdateCheckResponse, UpdateDownloadResponse};

#[tauri::command]
/// # Errors
///
/// Always returns `Ok` — no update system is implemented.
pub fn check_for_update() -> Result<UpdateCheckResponse, AppError> {
    Ok(UpdateCheckResponse {
        update_available: false,
        version: None,
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
    })
}

#[tauri::command]
/// # Errors
///
/// Always returns `Ok` — no update system is implemented.
pub fn download_update() -> Result<UpdateDownloadResponse, AppError> {
    Ok(UpdateDownloadResponse {
        success: false,
        error: Some("not implemented".into()),
    })
}

#[tauri::command]
/// # Errors
///
/// Always returns `Ok` — no update system is implemented.
pub const fn apply_update() -> Result<(), AppError> {
    Ok(())
}

#[tauri::command]
/// # Errors
///
/// Always returns `Ok` — no update system is implemented.
pub fn skip_update(_hash: String) -> Result<(), AppError> {
    Ok(())
}
