use crate::AppError;
use crate::auth::auth_error;
use axum::{
    Router,
    extract::{Query, State},
    response::{Html, IntoResponse},
    routing::get,
};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, sync::oneshot};

type CallbackPayload = (String, String);
type CallbackSender = oneshot::Sender<CallbackPayload>;
type ShutdownSender = oneshot::Sender<()>;

#[derive(Clone)]
struct CallbackState {
    callback_sender: Arc<Mutex<Option<CallbackSender>>>,
    shutdown_sender: Arc<Mutex<Option<ShutdownSender>>>,
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

pub struct CallbackServer {
    pub redirect_uri: String,
    pub receiver: oneshot::Receiver<CallbackPayload>,
}

/// Starts a local OAuth callback server on `127.0.0.1:{AUTH_SERVER_PORT}` and returns its redirect URI plus receiver.
///
/// # Errors
///
/// Returns [`AppError::Auth`] if the listener cannot be created.
pub async fn start_callback_server(callback_path: &str) -> Result<CallbackServer, AppError> {
    let requested_port: u16 = std::env::var("AUTH_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let listener = TcpListener::bind(format!("127.0.0.1:{requested_port}"))
        .await
        .map_err(|error| auth_error(format!("bind callback server: {error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| auth_error(format!("read callback server address: {error}")))?
        .port();

    let (callback_sender, receiver) = oneshot::channel::<CallbackPayload>();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();

    let router = Router::new()
        .route(callback_path, get(handle_callback))
        .with_state(CallbackState {
            callback_sender: Arc::new(Mutex::new(Some(callback_sender))),
            shutdown_sender: Arc::new(Mutex::new(Some(shutdown_sender))),
        });

    tokio::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_receiver.await;
            })
            .await;

        if let Err(error) = result {
            eprintln!("callback server failed: {error}");
        }
    });

    Ok(CallbackServer {
        redirect_uri: format!("http://localhost:{port}{callback_path}"),
        receiver,
    })
}

async fn handle_callback(
    State(state): State<CallbackState>,
    Query(query): Query<CallbackQuery>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let sender = state
        .callback_sender
        .lock()
        .map_err(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Html(error_page("callback state is poisoned")),
            )
        })?
        .take();

    let Some(sender) = sender else {
        return Err((
            axum::http::StatusCode::CONFLICT,
            Html(error_page("callback already received")),
        ));
    };

    let _ = sender.send((query.code, query.state));

    if let Ok(mut shutdown_sender) = state.shutdown_sender.lock()
        && let Some(sender) = shutdown_sender.take()
    {
        let _ = sender.send(());
    }

    Ok(Html(success_page()))
}

const fn success_page() -> &'static str {
    "<!DOCTYPE html><html><head><title>Authentication Successful</title></head><body style=\"font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#4caf50;\"><h1>Authentication successful</h1><p>You can close this window and return to TwirChat.</p><script>setTimeout(() => window.close(), 2000);</script></body></html>"
}

fn error_page(message: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><title>Authentication Error</title></head><body style=\"font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#ff6b6b;\"><h1>Authentication error</h1><p>{message}</p></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn callback_server_returns_code_and_state_then_stops() {
        let server = start_callback_server("/callback")
            .await
            .expect("start server");

        let response = reqwest::get(format!(
            "{}?code=test-code&state=test-state",
            server.redirect_uri
        ))
        .await
        .expect("request callback");

        assert!(response.status().is_success());

        let (code, state) = server.receiver.await.expect("receive callback payload");
        assert_eq!(code, "test-code");
        assert_eq!(state, "test-state");
    }
}
