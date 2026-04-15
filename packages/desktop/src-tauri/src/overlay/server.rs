use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use axum::{
    Router,
    extract::{
        FromRequestParts, Request, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
};
use tauri::Manager;
use tokio::{net::TcpListener, sync::broadcast};
use tower_http::services::{ServeDir, ServeFile};

use crate::{NormalizedChatMessage, NormalizedEvent};

const OVERLAY_BROADCAST_CAPACITY: usize = 256;
const OVERLAY_DIST_DIR: &str = "dist/overlay";

static OVERLAY_SERVER: OnceLock<OverlayServer> = OnceLock::new();
static OVERLAY_SERVER_STARTED: OnceLock<()> = OnceLock::new();

fn overlay_server_port() -> u16 {
    std::env::var("OVERLAY_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(45_823)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OverlayMessage {
    ChatMessage { data: Box<NormalizedChatMessage> },
    ChatEvent { data: Box<NormalizedEvent> },
    Clear,
}

#[derive(Clone)]
struct OverlayState {
    sender: broadcast::Sender<OverlayMessage>,
    index_file: PathBuf,
    assets_dir: PathBuf,
}

/// Overlay HTTP+WebSocket server for OBS browser sources.
#[derive(Clone)]
pub struct OverlayServer {
    state: Arc<OverlayState>,
}

impl OverlayServer {
    #[must_use]
    pub fn new() -> Self {
        Self::with_dist_dir(&resolve_overlay_dist_dir(None))
    }

    #[must_use]
    fn with_dist_dir(dist_dir: &Path) -> Self {
        let (sender, _) = broadcast::channel(OVERLAY_BROADCAST_CAPACITY);

        Self {
            state: Arc::new(OverlayState {
                sender,
                index_file: dist_dir.join("index.html"),
                assets_dir: dist_dir.join("assets"),
            }),
        }
    }

    pub fn start(&self) {
        let app = build_router(self.state.clone());

        tauri::async_runtime::spawn(async move {
            let address = SocketAddr::from(([127, 0, 0, 1], overlay_server_port()));
            let listener = match TcpListener::bind(address).await {
                Ok(listener) => listener,
                Err(error) => {
                    tracing::error!(?error, "failed to bind overlay server");
                    return;
                }
            };

            if let Err(error) = axum::serve(listener, app).await {
                tracing::error!(?error, "overlay server exited");
            }
        });
    }

    pub fn push_message(&self, message: NormalizedChatMessage) {
        if self
            .state
            .sender
            .send(OverlayMessage::ChatMessage {
                data: Box::new(message),
            })
            .is_err()
        {
            tracing::trace!("no overlay websocket clients connected for chat message");
        }
    }

    pub fn push_event(&self, event: NormalizedEvent) {
        if self
            .state
            .sender
            .send(OverlayMessage::ChatEvent {
                data: Box::new(event),
            })
            .is_err()
        {
            tracing::trace!("no overlay websocket clients connected for chat event");
        }
    }

    pub fn clear(&self) {
        if self.state.sender.send(OverlayMessage::Clear).is_err() {
            tracing::trace!("no overlay websocket clients connected for clear event");
        }
    }
}

impl Default for OverlayServer {
    fn default() -> Self {
        Self::new()
    }
}

pub fn init(app_handle: &tauri::AppHandle) {
    let server = OVERLAY_SERVER.get_or_init(|| {
        let dist_dir = resolve_overlay_dist_dir(Some(app_handle));
        OverlayServer::with_dist_dir(&dist_dir)
    });

    OVERLAY_SERVER_STARTED.get_or_init(|| {
        server.start();
    });
}

pub fn push_message(message: NormalizedChatMessage) {
    if let Some(server) = OVERLAY_SERVER.get() {
        server.push_message(message);
    }
}

pub fn push_event(event: NormalizedEvent) {
    if let Some(server) = OVERLAY_SERVER.get() {
        server.push_event(event);
    }
}

fn build_router(state: Arc<OverlayState>) -> Router {
    let index_file = state.index_file.clone();

    Router::new()
        .route("/", get(root_handler))
        .route("/ws", get(ws_handler))
        .nest_service("/assets", ServeDir::new(state.assets_dir.clone()))
        .fallback_service(ServeFile::new(index_file))
        .with_state(state)
}

fn resolve_overlay_dist_dir(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    if let Some(app_handle) = app_handle
        && let Ok(resource_dir) = app_handle.path().resource_dir()
    {
        return resource_dir.join(OVERLAY_DIST_DIR);
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(OVERLAY_DIST_DIR)
}

async fn root_handler(State(state): State<Arc<OverlayState>>, request: Request) -> Response {
    let (mut parts, _body) = request.into_parts();

    if let Ok(ws) = WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
        return ws
            .on_upgrade(move |socket| handle_websocket(socket, state.sender.subscribe()))
            .into_response();
    }

    match tokio::fs::read_to_string(&state.index_file).await {
        Ok(content) => Html(content).into_response(),
        Err(error) => {
            tracing::error!(?error, "failed to read overlay index file");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to load overlay").into_response()
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<OverlayState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_websocket(socket, state.sender.subscribe()))
}

async fn handle_websocket(
    mut socket: WebSocket,
    mut receiver: broadcast::Receiver<OverlayMessage>,
) {
    loop {
        match receiver.recv().await {
            Ok(message) => match serde_json::to_string(&message) {
                Ok(payload) => {
                    if socket.send(Message::Text(payload.into())).await.is_err() {
                        break;
                    }
                }
                Err(error) => tracing::error!(?error, "failed to serialize overlay message"),
            },
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                tracing::warn!(
                    skipped,
                    "overlay websocket client lagged behind broadcast channel"
                );
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}
