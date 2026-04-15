use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    net::TcpStream,
    sync::mpsc,
    task::JoinHandle,
    time::{self, Duration},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{
        Message,
        http::{Error as HttpError, Request},
    },
};

use crate::{
    AppError, DesktopToBackendMessage, NormalizedChatMessage, NormalizedEvent, Platform,
    SevenTVEmote, SeventvSubscription,
};

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

/// Manages the desktop WebSocket connection to the backend service.
#[derive(Clone)]
pub struct BackendConnectionManager {
    client_secret: String,
    app_handle: AppHandle,
    connected: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
    task_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    outgoing_tx: Arc<Mutex<Option<mpsc::UnboundedSender<DesktopToBackendMessage>>>>,
    subscriptions: Arc<Mutex<Vec<SeventvSubscription>>>,
}

impl BackendConnectionManager {
    /// Creates a new backend connection manager.
    #[must_use]
    pub fn new(client_secret: String, app_handle: AppHandle) -> Self {
        Self {
            client_secret,
            app_handle,
            connected: Arc::new(AtomicBool::new(false)),
            should_stop: Arc::new(AtomicBool::new(false)),
            task_handle: Arc::new(Mutex::new(None)),
            outgoing_tx: Arc::new(Mutex::new(None)),
            subscriptions: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Starts the backend WebSocket connection and reconnect loop.
    ///
    /// # Errors
    ///
    /// Returns an error when the WebSocket request cannot be built.
    pub async fn connect(&self, url: &str) -> Result<(), AppError> {
        let _request = build_ws_request(url, &self.client_secret)?;
        tokio::task::yield_now().await;

        self.disconnect();
        self.should_stop.store(false, Ordering::SeqCst);

        let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
        {
            let mut guard = self.outgoing_tx.lock().map_err(|_| {
                AppError::Adapter(String::from("backend connection sender lock poisoned"))
            })?;
            *guard = Some(outgoing_tx);
        }

        let app_handle = self.app_handle.clone();
        let client_secret = self.client_secret.clone();
        let connected = Arc::clone(&self.connected);
        let should_stop = Arc::clone(&self.should_stop);
        let subscriptions = Arc::clone(&self.subscriptions);
        let url = url.to_owned();

        let task = tokio::task::spawn(async move {
            run_connection_loop(
                url,
                client_secret,
                app_handle,
                connected,
                should_stop,
                outgoing_rx,
                subscriptions,
            )
            .await;
        });

        {
            let mut guard = self.task_handle.lock().map_err(|_| {
                AppError::Adapter(String::from("backend connection task lock poisoned"))
            })?;
            *guard = Some(task);
        }

        Ok(())
    }

    /// Stops the backend connection and cancels reconnect attempts.
    pub fn disconnect(&self) {
        self.should_stop.store(true, Ordering::SeqCst);
        self.connected.store(false, Ordering::SeqCst);

        match self.outgoing_tx.lock() {
            Ok(mut guard) => {
                *guard = None;
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock backend connection sender");
            }
        }

        match self.task_handle.lock() {
            Ok(mut guard) => {
                if let Some(task) = guard.take() {
                    task.abort();
                }
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock backend connection task handle");
            }
        }
    }

    /// Returns whether the backend WebSocket is currently connected.
    #[must_use]
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// # Errors
    ///
    /// Returns [`AppError`] if the backend sender is unavailable or closed.
    pub fn send(&self, msg: DesktopToBackendMessage) -> Result<(), AppError> {
        let sender = self
            .outgoing_tx
            .lock()
            .map_err(|_| {
                AppError::Adapter(String::from("backend connection sender lock poisoned"))
            })?
            .clone()
            .ok_or_else(|| {
                AppError::Adapter(String::from("backend websocket sender unavailable"))
            })?;

        sender.send(msg).map_err(|_| {
            AppError::Adapter(String::from("failed to queue backend websocket message"))
        })
    }

    pub fn add_subscription(&self, platform: Platform, channel_id: String) {
        match self.subscriptions.lock() {
            Ok(mut guard) => {
                if !guard.iter().any(|subscription| {
                    subscription.platform == platform && subscription.channel_id == channel_id
                }) {
                    guard.push(SeventvSubscription {
                        platform,
                        channel_id,
                    });
                }
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock backend subscriptions");
            }
        }
    }

    pub fn remove_subscription(&self, platform: Platform, channel_id: String) {
        match self.subscriptions.lock() {
            Ok(mut guard) => {
                guard.retain(|subscription| {
                    subscription.platform != platform || subscription.channel_id != channel_id
                });
            }
            Err(error) => {
                tracing::error!(?error, "failed to lock backend subscriptions");
            }
        }
    }
}

async fn run_connection_loop(
    url: String,
    client_secret: String,
    app_handle: AppHandle,
    connected: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
    mut outgoing: mpsc::UnboundedReceiver<DesktopToBackendMessage>,
    subscriptions: Arc<Mutex<Vec<SeventvSubscription>>>,
) {
    let mut reconnect_delay = INITIAL_RECONNECT_DELAY;

    while !should_stop.load(Ordering::SeqCst) {
        let request = match build_ws_request(&url, &client_secret) {
            Ok(request) => request,
            Err(error) => {
                tracing::error!(?error, %url, "failed to build backend websocket request");
                break;
            }
        };

        match connect_async(request).await {
            Ok((mut socket, _response)) => {
                tracing::info!(%url, "connected to backend websocket");
                connected.store(true, Ordering::SeqCst);
                reconnect_delay = INITIAL_RECONNECT_DELAY;

                let pending_subscriptions = match subscriptions.lock() {
                    Ok(guard) => guard.clone(),
                    Err(error) => {
                        tracing::error!(?error, "failed to lock backend subscriptions");
                        Vec::new()
                    }
                };

                if !pending_subscriptions.is_empty() {
                    let message = DesktopToBackendMessage::SeventvResubscribe {
                        subscriptions: pending_subscriptions,
                    };
                    if let Err(error) = send_backend_message(&mut socket, &message).await {
                        tracing::warn!(?error, %url, "failed to send 7tv resubscribe message");
                        connected.store(false, Ordering::SeqCst);
                        continue;
                    }
                }

                let mut ping_interval = time::interval(Duration::from_secs(30));
                ping_interval.tick().await;

                loop {
                    if should_stop.load(Ordering::SeqCst) {
                        break;
                    }

                    tokio::select! {
                        maybe_outgoing = outgoing.recv() => {
                            let Some(message) = maybe_outgoing else {
                                break;
                            };

                            if let Err(error) = send_backend_message(&mut socket, &message).await {
                                tracing::warn!(?error, %url, "backend websocket write error");
                                break;
                            }
                        }
                        _ = ping_interval.tick() => {
                            if let Err(error) = send_backend_message(&mut socket, &DesktopToBackendMessage::Ping).await {
                                tracing::warn!(?error, %url, "backend websocket ping failed");
                                break;
                            }
                        }
                        maybe_message = socket.next() => {
                            match maybe_message {
                                Some(Ok(Message::Text(text))) => dispatch_backend_payload(&app_handle, text.as_ref()),
                                Some(Ok(Message::Close(frame))) => {
                                    tracing::info!(?frame, "backend websocket closed");
                                    break;
                                }
                                Some(Ok(Message::Binary(_) | Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                                Some(Err(error)) => {
                                    tracing::warn!(?error, %url, "backend websocket read error");
                                    break;
                                }
                                None => break,
                            }
                        }
                    }
                }
            }
            Err(error) => {
                tracing::warn!(?error, %url, "failed to connect to backend websocket");
            }
        }

        connected.store(false, Ordering::SeqCst);

        if should_stop.load(Ordering::SeqCst) {
            break;
        }

        tracing::info!(
            delay_seconds = reconnect_delay.as_secs(),
            %url,
            "reconnecting to backend websocket"
        );
        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
    }
}

async fn send_backend_message(
    socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    message: &DesktopToBackendMessage,
) -> Result<(), AppError> {
    let payload = serde_json::to_string(message)?;
    socket
        .send(Message::Text(payload.into()))
        .await
        .map_err(|error| AppError::Adapter(format!("backend websocket write failed: {error}")))
}

fn dispatch_backend_payload(app_handle: &AppHandle, payload: &str) {
    match serde_json::from_str::<BackendToDesktopMessage>(payload) {
        Ok(message) => dispatch_backend_message(app_handle, message),
        Err(error) => {
            tracing::warn!(?error, payload, "failed to parse backend websocket message");
        }
    }
}

fn dispatch_backend_message(app_handle: &AppHandle, message: BackendToDesktopMessage) {
    match message {
        BackendToDesktopMessage::AuthSuccess {
            platform,
            username,
            display_name,
        } => {
            emit_auth_success_event(app_handle, platform, &username, &display_name);
        }
        BackendToDesktopMessage::AuthError { platform, error } => {
            emit_auth_error_event(app_handle, platform, &error);
        }
        BackendToDesktopMessage::ChatMessage { data } => {
            emit_app_event(app_handle, "chat:message", *data);
        }
        BackendToDesktopMessage::ChatEvent { data } => {
            emit_app_event(app_handle, "chat:event", *data);
        }
        BackendToDesktopMessage::PlatformStatus {
            platform,
            status,
            error,
        } => {
            emit_app_event(
                app_handle,
                "platform:status",
                BackendPlatformStatusMessage {
                    platform,
                    status,
                    error,
                },
            );
        }
        BackendToDesktopMessage::SeventvEmoteSet {
            platform,
            channel_id,
            emotes,
        } => {
            handle_seventv_emote_set(app_handle, platform, &channel_id, emotes);
        }
        BackendToDesktopMessage::SeventvEmoteAdded {
            platform,
            channel_id,
            emote,
        } => {
            handle_seventv_emote_added(app_handle, platform, &channel_id, &emote);
        }
        BackendToDesktopMessage::SeventvEmoteRemoved {
            platform,
            channel_id,
            emote_id,
        } => {
            handle_seventv_emote_removed(app_handle, platform, &channel_id, &emote_id);
        }
        BackendToDesktopMessage::SeventvEmoteUpdated {
            platform,
            channel_id,
            emote_id,
            alias,
        } => {
            handle_seventv_emote_updated(app_handle, platform, &channel_id, &emote_id, &alias);
        }
        message @ BackendToDesktopMessage::SeventvSystemMessage { .. } => {
            emit_app_event(app_handle, "7tv:event", message);
        }
        BackendToDesktopMessage::AuthUrl { .. }
        | BackendToDesktopMessage::Error { .. }
        | BackendToDesktopMessage::Pong => {}
    }
}

fn emit_auth_success_event(
    app_handle: &AppHandle,
    platform: Platform,
    username: &str,
    display_name: &str,
) {
    emit_app_event(
        app_handle,
        "auth:success",
        serde_json::json!({
            "platform": platform,
            "username": username,
            "displayName": display_name,
        }),
    );
}

fn emit_auth_error_event(app_handle: &AppHandle, platform: Platform, error: &str) {
    emit_app_event(
        app_handle,
        "auth:error",
        serde_json::json!({
            "platform": platform,
            "error": error,
        }),
    );
}

fn handle_seventv_emote_set(
    app_handle: &AppHandle,
    platform: Platform,
    channel_id: &str,
    emotes: Box<[SevenTVEmote]>,
) {
    let emotes_vec = emotes.into_vec();
    let state = app_handle.state::<crate::state::AppState>();
    let _ = state.set_channel_emotes(platform, channel_id, emotes_vec.clone());

    emit_app_event(
        app_handle,
        "channel_emotes:set",
        serde_json::json!({
            "platform": platform,
            "channelId": channel_id,
            "emotes": emotes_vec,
        }),
    );
}

fn handle_seventv_emote_added(
    app_handle: &AppHandle,
    platform: Platform,
    channel_id: &str,
    emote: &SevenTVEmote,
) {
    let state = app_handle.state::<crate::state::AppState>();
    let _ = state.add_channel_emote(platform, channel_id, emote.clone());

    emit_app_event(
        app_handle,
        "channel_emote:added",
        serde_json::json!({
            "platform": platform,
            "channelId": channel_id,
            "emote": emote,
        }),
    );
}

fn handle_seventv_emote_removed(
    app_handle: &AppHandle,
    platform: Platform,
    channel_id: &str,
    emote_id: &str,
) {
    let state = app_handle.state::<crate::state::AppState>();
    let _ = state.remove_channel_emote(platform, channel_id, emote_id);

    emit_app_event(
        app_handle,
        "channel_emote:removed",
        serde_json::json!({
            "platform": platform,
            "channelId": channel_id,
            "emoteId": emote_id,
        }),
    );
}

fn handle_seventv_emote_updated(
    app_handle: &AppHandle,
    platform: Platform,
    channel_id: &str,
    emote_id: &str,
    alias: &str,
) {
    let state = app_handle.state::<crate::state::AppState>();
    let _ = state.update_channel_emote_alias(platform, channel_id, emote_id, alias);

    emit_app_event(
        app_handle,
        "channel_emote:updated",
        serde_json::json!({
            "platform": platform,
            "channelId": channel_id,
            "emoteId": emote_id,
            "newAlias": alias,
        }),
    );
}

fn emit_app_event<S>(app_handle: &AppHandle, event_name: &str, payload: S)
where
    S: serde::Serialize + Clone,
{
    if let Err(error) = app_handle.emit(event_name, payload) {
        tracing::warn!(?error, event_name, "failed to emit tauri event");
    }
}

fn build_ws_request(url: &str, client_secret: &str) -> Result<Request<()>, AppError> {
    Request::builder()
        .uri(url)
        .header("X-Client-Secret", client_secret)
        .body(())
        .map_err(|error| map_request_error(&error))
}

fn map_request_error(error: &HttpError) -> AppError {
    AppError::Adapter(format!(
        "failed to build backend websocket request: {error}"
    ))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum BackendToDesktopMessage {
    AuthUrl {
        platform: Platform,
        url: String,
    },
    AuthSuccess {
        platform: Platform,
        username: String,
        display_name: String,
    },
    AuthError {
        platform: Platform,
        error: String,
    },
    Error {
        message: String,
    },
    Pong,
    ChatMessage {
        data: Box<NormalizedChatMessage>,
    },
    ChatEvent {
        data: Box<NormalizedEvent>,
    },
    PlatformStatus {
        platform: Platform,
        status: BackendPlatformStatus,
        error: Option<String>,
    },
    SeventvEmoteSet {
        platform: Platform,
        channel_id: String,
        emotes: Box<[SevenTVEmote]>,
    },
    SeventvEmoteAdded {
        platform: Platform,
        channel_id: String,
        emote: Box<SevenTVEmote>,
    },
    SeventvEmoteRemoved {
        platform: Platform,
        channel_id: String,
        emote_id: String,
    },
    SeventvEmoteUpdated {
        platform: Platform,
        channel_id: String,
        emote_id: String,
        alias: String,
    },
    SeventvSystemMessage {
        platform: Platform,
        channel_id: String,
        #[serde(flatten)]
        action: SevenTvSystemAction,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum BackendPlatformStatus {
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendPlatformStatusMessage {
    platform: Platform,
    status: BackendPlatformStatus,
    error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum SevenTvSystemAction {
    Added {
        emote: Box<SevenTVEmote>,
        old_alias: Option<String>,
    },
    Removed {
        emote: Box<SevenTVEmote>,
        old_alias: Option<String>,
    },
    Updated {
        emote: Box<SevenTVEmote>,
        old_alias: Option<String>,
    },
    SetChanged {
        set_name: String,
    },
    SetRenamed {
        old_name: String,
        new_name: String,
    },
    SetDeleted {
        set_name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_chat_message_variant_from_json() {
        let payload = serde_json::json!({
            "type": "chat_message",
            "data": {
                "id": "msg-1",
                "platform": "twitch",
                "channelId": "channel-1",
                "author": {
                    "id": "author-1",
                    "username": "streamer",
                    "displayName": "Streamer",
                    "color": "#ffffff",
                    "avatarUrl": null,
                    "badges": []
                },
                "text": "hello from backend",
                "emotes": [],
                "timestamp": "2026-04-14T00:00:00Z",
                "type": "message",
                "reply": null
            }
        })
        .to_string();

        let message = serde_json::from_str::<BackendToDesktopMessage>(&payload)
            .expect("chat_message JSON should deserialize");

        match message {
            BackendToDesktopMessage::ChatMessage { data } => {
                assert_eq!(data.id, "msg-1");
                assert_eq!(data.text, "hello from backend");
                assert_eq!(data.author.display_name, "Streamer");
                assert!(matches!(data.platform, Platform::Twitch));
            }
            other => panic!("expected chat_message variant, got {other:?}"),
        }
    }
}
