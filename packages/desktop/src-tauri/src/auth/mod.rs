pub mod kick;
pub mod pkce;
pub mod server;
pub mod twitch;
pub mod youtube;

use crate::{
    AppError,
    store::{db, migration},
};
use rand::RngCore;
use rusqlite::Connection;
use std::{io, path::PathBuf, time::UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

pub(crate) fn auth_error(message: impl Into<String>) -> AppError {
    AppError::Auth(message.into())
}

pub(crate) fn generate_state() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub(crate) fn now_unix_seconds() -> Result<i64, AppError> {
    let duration = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| auth_error(format!("system clock error: {error}")))?;

    i64::try_from(duration.as_secs())
        .map_err(|error| auth_error(format!("timestamp overflow: {error}")))
}

pub(crate) fn db_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, AppError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| io::Error::other(format!("resolve app data dir: {error}")))?;

    Ok(app_data_dir.join("data.db"))
}

pub(crate) fn open_connection<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Connection, AppError> {
    let path = db_path(app_handle)?;
    migration::migrate_db_path(&path)?;

    let conn = db::open_db(&path)?;
    db::init_db(&conn)?;
    migration::migrate_tokens(&conn)?;

    Ok(conn)
}

pub(crate) fn open_system_browser<R: Runtime>(
    app_handle: &AppHandle<R>,
    url: &str,
) -> Result<(), AppError> {
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|error| auth_error(format!("open browser: {error}")))
}

pub(crate) fn emit_auth_success<R: Runtime>(
    app_handle: &AppHandle<R>,
    platform: crate::Platform,
    username: &str,
    display_name: &str,
) {
    let _ = app_handle.emit(
        "auth:success",
        serde_json::json!({
            "platform": platform,
            "username": username,
            "displayName": display_name,
        }),
    );
}

pub(crate) fn emit_auth_error<R: Runtime>(
    app_handle: &AppHandle<R>,
    platform: crate::Platform,
    error: &AppError,
) {
    let _ = app_handle.emit(
        "auth:error",
        serde_json::json!({
            "platform": platform,
            "error": error.to_string(),
        }),
    );
}
