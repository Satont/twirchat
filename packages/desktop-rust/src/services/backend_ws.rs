use crate::protocol::error::ProtocolDecodeError;
use crate::protocol::messages::{
    BackendToDesktopMessage, DesktopToBackendMessage, parse_backend_to_desktop_message,
};
use crate::services::bus::{BusReceiver, BusRecvError, BusSender};
use crate::services::commands::{BackendWsCommand, LifecycleCommand, ServiceCommand};
use crate::services::events::{
    BackendToDesktopMessageKind, BackendWsDisconnectReason, BackendWsEvent,
    DesktopToBackendMessageKind, ServiceEvent, ServiceKind,
};
use crate::services::supervisor::{
    CancellationToken, ReconnectBackoff, ServiceExitReason, ServiceStopReport,
};
use crate::storage::Storage;
use std::error::Error;
use std::fmt;
use std::io;
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tungstenite::client::{IntoClientRequest, connect_with_config};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};
use url::Url;

const DEFAULT_BACKEND_WS_URL: &str = "ws://localhost:3000/ws";
const DEFAULT_STORAGE_FILE: &str = "twirchat.sqlite";
const MAX_BACKEND_WS_FRAME_PAYLOAD_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendWsConfig {
    url: String,
    storage_path: PathBuf,
    backoff: ReconnectBackoff,
}

impl BackendWsConfig {
    pub fn new(url: impl Into<String>, storage_path: impl Into<PathBuf>) -> Self {
        Self {
            url: url.into(),
            storage_path: storage_path.into(),
            backoff: ReconnectBackoff::default(),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn storage_path(&self) -> &PathBuf {
        &self.storage_path
    }

    pub fn backoff(&self) -> ReconnectBackoff {
        self.backoff
    }

    pub fn with_backoff(mut self, backoff: ReconnectBackoff) -> Self {
        self.backoff = backoff;
        self
    }
}

impl Default for BackendWsConfig {
    fn default() -> Self {
        Self::new(DEFAULT_BACKEND_WS_URL, PathBuf::from(DEFAULT_STORAGE_FILE))
    }
}

#[derive(Debug)]
pub enum BackendWsError {
    Storage(String),
    Url(url::ParseError),
    UnsupportedScheme(String),
    MissingHost,
    Io(io::Error),
    Handshake { status: u16, message: String },
    Protocol(String),
    Json(serde_json::Error),
}

impl fmt::Display for BackendWsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(source) => write!(f, "backend websocket storage error: {source}"),
            Self::Url(source) => write!(f, "invalid backend websocket URL: {source}"),
            Self::UnsupportedScheme(scheme) => {
                write!(f, "unsupported backend websocket URL scheme: {scheme}")
            }
            Self::MissingHost => write!(f, "backend websocket URL is missing a host"),
            Self::Io(source) => write!(f, "backend websocket IO error: {source}"),
            Self::Handshake { status, message } => {
                write!(
                    f,
                    "backend websocket handshake failed with {status}: {message}"
                )
            }
            Self::Protocol(message) => write!(f, "backend websocket protocol error: {message}"),
            Self::Json(source) => write!(f, "backend websocket JSON encode error: {source}"),
        }
    }
}

impl Error for BackendWsError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Url(source) => Some(source),
            Self::Io(source) => Some(source),
            Self::Json(source) => Some(source),
            Self::Storage(_)
            | Self::UnsupportedScheme(_)
            | Self::MissingHost
            | Self::Handshake { .. }
            | Self::Protocol(_) => None,
        }
    }
}

impl From<io::Error> for BackendWsError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<url::ParseError> for BackendWsError {
    fn from(value: url::ParseError) -> Self {
        Self::Url(value)
    }
}

impl From<serde_json::Error> for BackendWsError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<tungstenite::Error> for BackendWsError {
    fn from(value: tungstenite::Error) -> Self {
        match value {
            tungstenite::Error::Io(error) => Self::Io(error),
            tungstenite::Error::Url(error) => Self::Protocol(error.to_string()),
            tungstenite::Error::Http(response) => Self::Handshake {
                status: response.status().as_u16(),
                message: response
                    .status()
                    .canonical_reason()
                    .unwrap_or("HTTP error")
                    .to_string(),
            },
            error => Self::Protocol(error.to_string()),
        }
    }
}

pub fn run_backend_ws_service(
    config: BackendWsConfig,
    cancellation: CancellationToken,
    poll_interval: Duration,
    commands: BusReceiver<ServiceCommand>,
    events: BusSender<ServiceEvent>,
) -> ServiceStopReport {
    let mut runner = BackendWsRunner::new(config, cancellation, poll_interval, commands, events);
    runner.run()
}

pub fn decode_backend_payload(text: &str) -> Result<BackendToDesktopMessage, ProtocolDecodeError> {
    parse_backend_to_desktop_message(text)
}

struct BackendWsRunner {
    config: BackendWsConfig,
    cancellation: CancellationToken,
    poll_interval: Duration,
    commands: BusReceiver<ServiceCommand>,
    events: BusSender<ServiceEvent>,
    socket: Option<WebSocketClient>,
    stopped: bool,
    reconnect_attempt: u32,
    reconnect_at: Option<Instant>,
    pending_outbound: Vec<DesktopToBackendMessage>,
}

impl BackendWsRunner {
    fn new(
        config: BackendWsConfig,
        cancellation: CancellationToken,
        poll_interval: Duration,
        commands: BusReceiver<ServiceCommand>,
        events: BusSender<ServiceEvent>,
    ) -> Self {
        Self {
            config,
            cancellation,
            poll_interval,
            commands,
            events,
            socket: None,
            stopped: true,
            reconnect_attempt: 0,
            reconnect_at: None,
            pending_outbound: Vec::new(),
        }
    }

    fn run(&mut self) -> ServiceStopReport {
        loop {
            if self.cancellation.is_cancelled() {
                self.close_socket(BackendWsDisconnectReason::Commanded);
                return stop_report(ServiceExitReason::Cancelled);
            }

            if self.reconnect_due() {
                self.connect();
            }

            if self.socket.is_some() {
                self.read_available();
            }

            match self.commands.recv_timeout(self.poll_interval) {
                Ok(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown)) => {
                    self.close_socket(BackendWsDisconnectReason::Commanded);
                    return stop_report(ServiceExitReason::ShutdownCommand);
                }
                Ok(ServiceCommand::BackendWs(command)) => self.handle_command(command),
                Ok(_) => {}
                Err(BusRecvError::Timeout) => {}
                Err(BusRecvError::Closed) => {
                    self.close_socket(BackendWsDisconnectReason::Commanded);
                    return stop_report(ServiceExitReason::CommandBusClosed);
                }
            }
        }
    }

    fn handle_command(&mut self, command: BackendWsCommand) {
        match command {
            BackendWsCommand::Connect => {
                self.publish(BackendWsEvent::ConnectionRequested);
                self.stopped = false;
                self.reconnect_at = None;
                self.connect();
            }
            BackendWsCommand::Disconnect => {
                self.publish(BackendWsEvent::DisconnectionRequested);
                self.stopped = true;
                self.reconnect_at = None;
                self.close_socket(BackendWsDisconnectReason::Commanded);
            }
            BackendWsCommand::SendPing => {
                self.publish(BackendWsEvent::PingQueued);
                self.send_message(DesktopToBackendMessage::Ping);
            }
            BackendWsCommand::SendMessage { message } => {
                self.publish(BackendWsEvent::MessageQueued {
                    kind: DesktopToBackendMessageKind::from(&message),
                });
                self.send_message(message);
            }
            BackendWsCommand::ScheduleReconnect { attempt } => {
                self.reconnect_attempt = attempt;
                self.schedule_reconnect();
            }
        }
    }

    fn connect(&mut self) {
        self.close_socket(BackendWsDisconnectReason::Commanded);
        eprintln!("[backend-ws] connecting to {}", self.config.url());
        self.publish(BackendWsEvent::Connecting {
            url: self.config.url.clone(),
        });

        match self.load_client_secret().and_then(|secret| {
            eprintln!(
                "[backend-ws] using client secret prefix={}…",
                secret.chars().take(8).collect::<String>()
            );
            WebSocketClient::connect(self.config.url(), &secret, self.poll_interval)
        }) {
            Ok(socket) => {
                eprintln!("[backend-ws] connected successfully");
                self.socket = Some(socket);
                self.reconnect_attempt = 0;
                self.reconnect_at = None;
                self.publish(BackendWsEvent::Connected);
                self.flush_pending_outbound();
            }
            Err(BackendWsError::Handshake { status, message })
                if status == 401 || status == 403 =>
            {
                eprintln!("[backend-ws] auth rejected: {status} {message}");
                self.stopped = true;
                self.publish(BackendWsEvent::AuthRejected { status, message });
                self.publish(BackendWsEvent::Disconnected {
                    reason: BackendWsDisconnectReason::AuthRejected,
                });
            }
            Err(error) => {
                eprintln!("[backend-ws] connection failed: {error}");
                self.publish(BackendWsEvent::Disconnected {
                    reason: disconnect_reason(&error),
                });
                if !self.stopped {
                    self.schedule_reconnect();
                }
            }
        }
    }

    fn load_client_secret(&self) -> Result<String, BackendWsError> {
        let storage = Storage::open_or_recover(self.config.storage_path())
            .map_err(|source| BackendWsError::Storage(source.to_string()))?;
        storage
            .client_identity()
            .get_client_secret()
            .map_err(|source| BackendWsError::Storage(source.to_string()))
    }

    fn send_message(&mut self, message: DesktopToBackendMessage) {
        let Some(socket) = self.socket.as_mut() else {
            eprintln!(
                "[backend-ws] not connected, buffering message: {:?}",
                DesktopToBackendMessageKind::from(&message)
            );
            self.pending_outbound.push(message);
            return;
        };

        let kind = DesktopToBackendMessageKind::from(&message);
        eprintln!("[backend-ws] sending message: {:?}", kind);
        let result = serde_json::to_string(&message)
            .map_err(BackendWsError::from)
            .and_then(|payload| socket.send_text(&payload));

        match result {
            Ok(()) => self.publish(BackendWsEvent::MessageSent { kind }),
            Err(error) => {
                self.publish(BackendWsEvent::SendFailed {
                    kind,
                    reason: error.to_string(),
                });
                self.handle_unexpected_disconnect(disconnect_reason(&error));
            }
        }
    }

    fn flush_pending_outbound(&mut self) {
        let messages = std::mem::take(&mut self.pending_outbound);
        if !messages.is_empty() {
            eprintln!(
                "[backend-ws] flushing {} buffered message(s)",
                messages.len()
            );
        }
        for message in messages {
            self.send_message(message);
        }
    }

    fn read_available(&mut self) {
        let result = match self.socket.as_mut() {
            Some(socket) => socket.read_text_frame(),
            None => return,
        };

        match result {
            Ok(Some(payload)) => match decode_backend_payload(&payload) {
                Ok(message) => {
                    match &message {
                        BackendToDesktopMessage::ChatMessage { data } => {
                            if let Ok(parsed) = serde_json::from_value::<
                                crate::protocol::types::NormalizedChatMessage,
                            >(data.clone())
                            {
                                eprintln!(
                                    "[backend/live] incoming {:?} chat message id={} channel={} text={}",
                                    parsed.platform, parsed.id, parsed.channel_id, parsed.text
                                );
                            } else {
                                eprintln!(
                                    "[backend/live] incoming chat message that failed local decode preview"
                                );
                            }
                        }
                        BackendToDesktopMessage::ChatEvent { .. } => {
                            eprintln!("[backend/live] incoming chat event");
                        }
                        BackendToDesktopMessage::PlatformStatus {
                            platform, status, ..
                        } => {
                            eprintln!(
                                "[backend/live] incoming platform status platform={:?} status={:?}",
                                platform, status
                            );
                        }
                        _ => {}
                    }
                    self.publish(BackendWsEvent::MessageReceived {
                        kind: BackendToDesktopMessageKind::from(&message),
                    });
                    self.publish(BackendWsEvent::MessageDecoded { message });
                }
                Err(error) => self.publish(BackendWsEvent::MalformedPayload {
                    error: error.to_string(),
                }),
            },
            Ok(None) => {}
            Err(error) => self.handle_unexpected_disconnect(disconnect_reason(&error)),
        }
    }

    fn handle_unexpected_disconnect(&mut self, reason: BackendWsDisconnectReason) {
        self.socket = None;
        self.publish(BackendWsEvent::Disconnected { reason });
        if !self.stopped {
            self.schedule_reconnect();
        }
    }

    fn close_socket(&mut self, reason: BackendWsDisconnectReason) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close();
            self.publish(BackendWsEvent::Disconnected { reason });
        }
    }

    fn schedule_reconnect(&mut self) {
        let delay = self
            .config
            .backoff()
            .delay_for_attempt(self.reconnect_attempt);
        self.publish(BackendWsEvent::ReconnectScheduled {
            attempt: self.reconnect_attempt,
            delay,
        });
        self.reconnect_attempt = self.reconnect_attempt.saturating_add(1);
        self.reconnect_at = Some(Instant::now() + delay);
    }

    fn reconnect_due(&self) -> bool {
        !self.stopped
            && self.socket.is_none()
            && self.reconnect_at.is_some_and(|at| at <= Instant::now())
    }

    fn publish(&self, event: BackendWsEvent) {
        if self
            .events
            .try_publish(ServiceEvent::BackendWs(event))
            .is_err()
        {}
    }
}

struct WebSocketClient {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
}

impl WebSocketClient {
    fn connect(
        url: &str,
        client_secret: &str,
        read_timeout: Duration,
    ) -> Result<Self, BackendWsError> {
        let parsed = Url::parse(url)?;
        if parsed.scheme() != "ws" && parsed.scheme() != "wss" {
            return Err(BackendWsError::UnsupportedScheme(parsed.scheme().into()));
        }
        let host = parsed.host_str().ok_or(BackendWsError::MissingHost)?;
        let port = parsed
            .port_or_known_default()
            .ok_or(BackendWsError::MissingHost)?;
        let path = request_path(&parsed);
        eprintln!(
            "[backend-ws] opening websocket handshake scheme={} host={host}:{port} path={path}",
            parsed.scheme()
        );
        let mut request = parsed.as_str().into_client_request()?;
        request.headers_mut().insert(
            "X-Client-Secret",
            client_secret.parse().map_err(|error| {
                BackendWsError::Protocol(format!("invalid client secret header: {error}"))
            })?,
        );
        let config = WebSocketConfig {
            max_message_size: Some(MAX_BACKEND_WS_FRAME_PAYLOAD_BYTES as usize),
            ..WebSocketConfig::default()
        };
        let (mut socket, _response) = connect_with_config(request, Some(config), 0)?;
        set_socket_timeouts(socket.get_mut(), read_timeout)?;

        Ok(Self { socket })
    }

    fn send_text(&mut self, payload: &str) -> Result<(), BackendWsError> {
        self.socket.send(Message::Text(payload.to_string()))?;
        Ok(())
    }

    fn close(&mut self) -> Result<(), BackendWsError> {
        self.socket.close(None)?;
        Ok(())
    }

    fn read_text_frame(&mut self) -> Result<Option<String>, BackendWsError> {
        match self.socket.read() {
            Ok(Message::Text(payload)) => Ok(Some(payload)),
            Ok(Message::Ping(payload)) => {
                self.socket.send(Message::Pong(payload))?;
                Ok(None)
            }
            Ok(Message::Close(_)) => Err(BackendWsError::Protocol("websocket closed".into())),
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(error))
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }
}

fn set_socket_timeouts(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Duration,
) -> Result<(), BackendWsError> {
    match stream {
        MaybeTlsStream::Plain(stream) => set_tcp_timeouts(stream, timeout),
        MaybeTlsStream::Rustls(stream) => set_tcp_timeouts(stream.get_mut(), timeout),
        _ => Ok(()),
    }
}

fn set_tcp_timeouts(stream: &mut TcpStream, timeout: Duration) -> Result<(), BackendWsError> {
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    Ok(())
}

fn request_path(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    }
}

fn disconnect_reason(error: &BackendWsError) -> BackendWsDisconnectReason {
    match error {
        BackendWsError::Handshake { status, .. } if *status == 401 || *status == 403 => {
            BackendWsDisconnectReason::AuthRejected
        }
        BackendWsError::Protocol(_) => BackendWsDisconnectReason::ProtocolError,
        BackendWsError::Io(_) => BackendWsDisconnectReason::IoError,
        BackendWsError::Storage(_)
        | BackendWsError::Url(_)
        | BackendWsError::UnsupportedScheme(_)
        | BackendWsError::MissingHost
        | BackendWsError::Handshake { .. }
        | BackendWsError::Json(_) => BackendWsDisconnectReason::IoError,
    }
}

fn stop_report(reason: ServiceExitReason) -> ServiceStopReport {
    ServiceStopReport::new(ServiceKind::BackendWs, reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_ws_accepts_ws_and_wss_schemes() -> Result<(), Box<dyn Error>> {
        assert!("ws://localhost:3000/ws".into_client_request().is_ok());
        assert!("wss://chat.twir.app/ws".into_client_request().is_ok());

        let parsed = Url::parse("wss://chat.twir.app/ws")?;
        assert!(parsed.scheme() == "ws" || parsed.scheme() == "wss");
        assert_eq!(parsed.port_or_known_default(), Some(443));
        Ok(())
    }
}
