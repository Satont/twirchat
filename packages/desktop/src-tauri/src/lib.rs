pub mod auth;
pub mod backend;
pub mod chat;
pub mod commands;
pub mod error;
pub mod overlay;
pub mod platforms;
pub mod state;
pub mod store;
pub mod types;

pub use error::AppError;
pub use types::*;

use tauri::Manager as _;

fn start_backend_connection(state: &state::AppState) {
    let backend = state.backend.clone();
    let backend_url = state.backend_ws_url.clone();
    if !backend_url.is_empty() {
        tauri::async_runtime::spawn(async move {
            let _ = backend.connect(&backend_url).await;
        });
    }
}

fn spawn_event_router(
    app_handle: tauri::AppHandle,
    mut event_rx: tokio::sync::mpsc::Receiver<platforms::adapter::AdapterEvent>,
) {
    tauri::async_runtime::spawn(async move {
        use platforms::adapter::AdapterEvent;
        use tauri::Emitter as _;

        while let Some(event) = event_rx.recv().await {
            match event {
                AdapterEvent::Message(msg) => {
                    let msg = *msg;
                    route_message_event(&app_handle, &msg);
                }
                AdapterEvent::Event(ev) => {
                    let _ = app_handle.emit("chat:event", *ev);
                }
                AdapterEvent::Status {
                    platform,
                    channel,
                    state,
                } => route_status_event(&app_handle, platform, &channel, &state),
            }
        }
    });
}

fn route_message_event(app_handle: &tauri::AppHandle, msg: &NormalizedChatMessage) {
    use tauri::Emitter as _;

    let _ = app_handle.emit("chat:message", msg.clone());

    for watched_channel_id in watched_channel_ids_by_slug(app_handle, msg.platform, &msg.channel_id)
    {
        let _ = app_handle.emit(
            "watched_channel:message",
            WatchedMessagePayload {
                channel_id: watched_channel_id,
                message: msg.clone(),
            },
        );
    }
}

fn route_status_event(
    app_handle: &tauri::AppHandle,
    platform: Platform,
    channel: &str,
    state: &platforms::adapter::AdapterState,
) {
    use tauri::Emitter as _;

    let status_info = status_info_from_adapter_state(platform, channel, state);

    let _ = app_handle.emit(
        "platform:status",
        serde_json::json!({
            "platform": platform,
            "channel": channel,
            "state": format!("{state:?}"),
        }),
    );

    for watched_channel_id in watched_channel_ids_by_slug(app_handle, platform, channel) {
        let _ = app_handle.emit(
            "watched_channel:status",
            WatchedStatusPayload {
                channel_id: watched_channel_id,
                status: status_info.clone(),
            },
        );
    }
}

fn status_info_from_adapter_state(
    platform: Platform,
    channel: &str,
    state: &platforms::adapter::AdapterState,
) -> PlatformStatusInfo {
    let (status, error) = match state {
        platforms::adapter::AdapterState::Connected => (PlatformStatus::Connected, None),
        platforms::adapter::AdapterState::Connecting => (PlatformStatus::Connecting, None),
        platforms::adapter::AdapterState::Disconnected
        | platforms::adapter::AdapterState::Disconnecting => (PlatformStatus::Disconnected, None),
        platforms::adapter::AdapterState::Error(error) => {
            (PlatformStatus::Error, Some(error.clone()))
        }
    };

    PlatformStatusInfo {
        platform,
        status,
        error,
        mode: ConnectionMode::Anonymous,
        channel_login: Some(channel.to_owned()),
    }
}

fn watched_channel_ids_by_slug(
    app_handle: &tauri::AppHandle,
    platform: Platform,
    channel_slug: &str,
) -> Vec<String> {
    let state = app_handle.state::<state::AppState>();
    let Ok(db) = state.db() else {
        return Vec::new();
    };
    let Ok(watched_channels) = crate::store::watched_channels::get_all(&db) else {
        return Vec::new();
    };

    watched_channels
        .into_iter()
        .filter(|channel| channel.platform == platform && channel.channel_slug == channel_slug)
        .map(|channel| channel.id)
        .collect()
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchedMessagePayload {
    channel_id: String,
    message: NormalizedChatMessage,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchedStatusPayload {
    channel_id: String,
    status: PlatformStatusInfo,
}

/// # Panics
///
/// Panics if the Tauri runtime fails to start.
pub fn run() {
    use tauri::Manager as _;

    tauri::Builder::default()
        .setup(|app| {
            overlay::server::init(app.handle());

            let db_path = auth::db_path(app.handle())?;
            let conn = auth::open_connection(app.handle())?;
            let client_secret = store::client_identity::get_or_create(&conn)?;

            let (event_tx, event_rx) =
                tokio::sync::mpsc::channel::<platforms::adapter::AdapterEvent>(256);

            let backend_mgr = backend::connection::BackendConnectionManager::new(
                client_secret.clone(),
                app.handle().clone(),
            );

            let twitch_adapter = std::sync::Arc::new(
                platforms::twitch::adapter::TwitchAdapter::new(db_path.clone()),
            );
            let kick_adapter = std::sync::Arc::new(platforms::kick::adapter::KickAdapter::new());

            let app_state = state::AppState::new(
                conn,
                db_path,
                backend_mgr,
                event_tx,
                client_secret,
                twitch_adapter,
                kick_adapter,
            );
            start_backend_connection(&app_state);
            app.manage(app_state);

            spawn_event_router(app.handle().clone(), event_rx);

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::accounts::get_accounts,
            commands::accounts::get_account,
            commands::accounts::remove_account,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::aliases::get_user_aliases,
            commands::aliases::set_user_alias,
            commands::aliases::remove_user_alias,
            commands::channels::get_channels,
            commands::channels::join_channel,
            commands::channels::leave_channel,
            commands::channels::send_message,
            commands::auth::auth_start,
            commands::auth::auth_logout,
            commands::stream::get_stream_status,
            commands::stream::update_stream,
            commands::stream::search_categories,
            commands::stream::get_channels_status,
            commands::messages::get_recent_messages,
            commands::messages::get_username_color,
            commands::messages::get_channel_emotes,
            commands::updates::check_for_update,
            commands::updates::download_update,
            commands::updates::apply_update,
            commands::updates::skip_update,
            commands::watched::get_watched_channels,
            commands::watched::add_watched_channel,
            commands::watched::remove_watched_channel,
            commands::watched::get_watched_channel_messages,
            commands::watched::send_watched_channel_message,
            commands::watched::get_watched_channel_statuses,
            commands::layout::get_tab_channel_ids,
            commands::layout::set_tab_channel_ids,
            commands::layout::get_watched_channels_layout,
            commands::layout::set_watched_channels_layout,
            commands::layout::remove_panel,
            commands::layout::assign_channel_to_panel,
            commands::layout::split_panel,
            commands::overlay::get_overlay_settings,
            commands::overlay::update_overlay_settings,
            commands::overlay::push_overlay_message,
            commands::overlay::push_overlay_event,
            commands::misc::get_statuses,
            commands::misc::open_external_url,
            commands::misc::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
