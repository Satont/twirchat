use crate::error::AppError;
use crate::state::AppState;
use crate::types::{
    ChannelStatusRequest, ChannelsStatusResponse, SearchCategoriesResponse, StreamStatusParams,
    StreamStatusResponse, UpdateStreamRequest, UpdateStreamResponse,
};

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if backend URL is not configured or the HTTP request fails.
pub async fn get_stream_status(
    state: tauri::State<'_, AppState>,
    platform: crate::types::Platform,
    channel_id: String,
) -> Result<StreamStatusResponse, AppError> {
    if state.backend_url.is_empty() {
        return Err(AppError::Adapter("backend URL not configured".into()));
    }
    let url = format!("{}/stream/status", state.backend_url);
    let params = StreamStatusParams {
        platform,
        channel_id,
    };
    let resp = state
        .http_client
        .get(&url)
        .header("X-Client-Secret", &state.client_secret)
        .json(&params)
        .send()
        .await
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    resp.json::<StreamStatusResponse>()
        .await
        .map_err(|e| AppError::Adapter(format!("parse: {e}")))
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if backend URL is not configured or the HTTP request fails.
pub async fn update_stream(
    state: tauri::State<'_, AppState>,
    platform: crate::types::Platform,
    channel_id: String,
    title: Option<String>,
    category_id: Option<String>,
) -> Result<UpdateStreamResponse, AppError> {
    if state.backend_url.is_empty() {
        return Err(AppError::Adapter("backend URL not configured".into()));
    }
    let url = format!("{}/stream/update", state.backend_url);
    let params = UpdateStreamRequest {
        platform,
        channel_id,
        title,
        category_id,
    };
    let resp = state
        .http_client
        .post(&url)
        .header("X-Client-Secret", &state.client_secret)
        .json(&params)
        .send()
        .await
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    resp.json::<UpdateStreamResponse>()
        .await
        .map_err(|e| AppError::Adapter(format!("parse: {e}")))
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if backend URL is not configured or the HTTP request fails.
pub async fn search_categories(
    state: tauri::State<'_, AppState>,
    platform: crate::types::Platform,
    query: String,
) -> Result<SearchCategoriesResponse, AppError> {
    if state.backend_url.is_empty() {
        return Err(AppError::Adapter("backend URL not configured".into()));
    }
    let url = format!("{}/stream/categories", state.backend_url);
    let params = crate::types::SearchCategoriesParams { platform, query };
    let resp = state
        .http_client
        .get(&url)
        .header("X-Client-Secret", &state.client_secret)
        .json(&params)
        .send()
        .await
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    resp.json::<SearchCategoriesResponse>()
        .await
        .map_err(|e| AppError::Adapter(format!("parse: {e}")))
}

#[tauri::command]
/// # Errors
///
/// Returns [`AppError`] if backend URL is not configured or the HTTP request fails.
pub async fn get_channels_status(
    state: tauri::State<'_, AppState>,
    channels: Vec<ChannelStatusRequest>,
) -> Result<ChannelsStatusResponse, AppError> {
    if state.backend_url.is_empty() {
        return Err(AppError::Adapter("backend URL not configured".into()));
    }
    let url = format!("{}/stream/channels-status", state.backend_url);
    let params = crate::types::ChannelStatusRequestList { channels };
    let resp = state
        .http_client
        .post(&url)
        .header("X-Client-Secret", &state.client_secret)
        .json(&params)
        .send()
        .await
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| AppError::Adapter(format!("http: {e}")))?;
    resp.json::<ChannelsStatusResponse>()
        .await
        .map_err(|e| AppError::Adapter(format!("parse: {e}")))
}
