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
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha1_smol::Sha1;
use std::error::Error;
use std::fmt;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use url::Url;

const DEFAULT_BACKEND_WS_URL: &str = "ws://localhost:3000/ws";
const DEFAULT_STORAGE_FILE: &str = "twirchat-desktop-rust.sqlite";
const CLIENT_WEBSOCKET_VERSION: &str = "13";
const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLOSE_NORMAL: u16 = 1000;
const OPCODE_CLOSE: u8 = 0x8;
const OPCODE_TEXT: u8 = 0x1;

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
    stream: TcpStream,
}

impl WebSocketClient {
    fn connect(
        url: &str,
        client_secret: &str,
        read_timeout: Duration,
    ) -> Result<Self, BackendWsError> {
        let parsed = Url::parse(url)?;
        if parsed.scheme() != "ws" {
            return Err(BackendWsError::UnsupportedScheme(parsed.scheme().into()));
        }
        let host = parsed.host_str().ok_or(BackendWsError::MissingHost)?;
        let port = parsed
            .port_or_known_default()
            .ok_or(BackendWsError::MissingHost)?;
        let mut stream = TcpStream::connect((host, port))?;
        stream.set_read_timeout(Some(read_timeout))?;
        stream.set_write_timeout(Some(read_timeout))?;

        let key = websocket_key();
        let path = request_path(&parsed);
        eprintln!(
            "[backend-ws] opening websocket handshake host={host}:{port} path={path} key_bytes=16"
        );
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: {CLIENT_WEBSOCKET_VERSION}\r\nX-Client-Secret: {client_secret}\r\n\r\n"
        );
        stream.write_all(request.as_bytes())?;
        stream.flush()?;

        let mut reader = BufReader::new(stream.try_clone()?);
        let mut status_line = String::new();
        reader.read_line(&mut status_line)?;
        let (status, message) = parse_status_line(&status_line)?;
        let mut accept = None;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line)?;
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                break;
            }
            if let Some((name, value)) = trimmed.split_once(':')
                && name.eq_ignore_ascii_case("sec-websocket-accept")
            {
                accept = Some(value.trim().to_string());
            }
        }

        if status != 101 {
            eprintln!("[backend-ws] handshake rejected status={status} message={message}");
            return Err(BackendWsError::Handshake { status, message });
        }
        let expected_accept = websocket_accept(&key);
        if accept.as_deref() != Some(expected_accept.as_str()) {
            return Err(BackendWsError::Protocol(
                "handshake returned invalid Sec-WebSocket-Accept".into(),
            ));
        }

        Ok(Self { stream })
    }

    fn send_text(&mut self, payload: &str) -> Result<(), BackendWsError> {
        write_frame(&mut self.stream, OPCODE_TEXT, payload.as_bytes(), true)
    }

    fn close(&mut self) -> Result<(), BackendWsError> {
        write_frame(
            &mut self.stream,
            OPCODE_CLOSE,
            &CLOSE_NORMAL.to_be_bytes(),
            true,
        )?;
        self.stream.shutdown(Shutdown::Both)?;
        Ok(())
    }

    fn read_text_frame(&mut self) -> Result<Option<String>, BackendWsError> {
        match read_frame(&mut self.stream) {
            Ok(Some(Frame::Text(payload))) => {
                Ok(Some(String::from_utf8(payload).map_err(|_| {
                    BackendWsError::Protocol("text frame is not valid UTF-8".into())
                })?))
            }
            Ok(Some(Frame::Close)) => Err(BackendWsError::Protocol("websocket closed".into())),
            Ok(None) => Ok(None),
            Err(BackendWsError::Io(error))
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }
}

enum Frame {
    Text(Vec<u8>),
    Close,
}

fn read_frame(stream: &mut TcpStream) -> Result<Option<Frame>, BackendWsError> {
    let mut header = [0_u8; 2];
    match stream.read_exact(&mut header) {
        Ok(()) => {}
        Err(error)
            if error.kind() == io::ErrorKind::WouldBlock
                || error.kind() == io::ErrorKind::TimedOut =>
        {
            return Ok(None);
        }
        Err(error) => return Err(BackendWsError::Io(error)),
    }

    let opcode = header[0] & 0x0f;
    let masked = header[1] & 0x80 != 0;
    let mut len = u64::from(header[1] & 0x7f);
    if len == 126 {
        let mut bytes = [0_u8; 2];
        stream.read_exact(&mut bytes)?;
        len = u64::from(u16::from_be_bytes(bytes));
    } else if len == 127 {
        let mut bytes = [0_u8; 8];
        stream.read_exact(&mut bytes)?;
        len = u64::from_be_bytes(bytes);
    }
    let mask = if masked {
        let mut bytes = [0_u8; 4];
        stream.read_exact(&mut bytes)?;
        Some(bytes)
    } else {
        None
    };
    let payload_len = usize::try_from(len)
        .map_err(|_| BackendWsError::Protocol("websocket frame is too large".into()))?;
    let mut payload = vec![0_u8; payload_len];
    stream.read_exact(&mut payload)?;
    if let Some(mask) = mask {
        apply_mask(&mut payload, mask);
    }

    match opcode {
        OPCODE_TEXT => Ok(Some(Frame::Text(payload))),
        OPCODE_CLOSE => Ok(Some(Frame::Close)),
        _ => Ok(None),
    }
}

fn write_frame(
    stream: &mut TcpStream,
    opcode: u8,
    payload: &[u8],
    mask_payload: bool,
) -> Result<(), BackendWsError> {
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | opcode);
    let mask_bit = if mask_payload { 0x80 } else { 0 };
    if payload.len() < 126 {
        let len = u8::try_from(payload.len())
            .map_err(|_| BackendWsError::Protocol("payload length overflow".into()))?;
        frame.push(mask_bit | len);
    } else if u16::try_from(payload.len()).is_ok() {
        let len = u16::try_from(payload.len())
            .map_err(|_| BackendWsError::Protocol("payload length overflow".into()))?;
        frame.push(mask_bit | 126);
        frame.extend_from_slice(&len.to_be_bytes());
    } else {
        let len = u64::try_from(payload.len())
            .map_err(|_| BackendWsError::Protocol("payload length overflow".into()))?;
        frame.push(mask_bit | 127);
        frame.extend_from_slice(&len.to_be_bytes());
    }

    if mask_payload {
        let mask = mask_key();
        frame.extend_from_slice(&mask);
        let mut masked = payload.to_vec();
        apply_mask(&mut masked, mask);
        frame.extend_from_slice(&masked);
    } else {
        frame.extend_from_slice(payload);
    }
    stream.write_all(&frame)?;
    stream.flush()?;
    Ok(())
}

fn apply_mask(payload: &mut [u8], mask: [u8; 4]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index % mask.len()];
    }
}

fn request_path(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    }
}

fn parse_status_line(line: &str) -> Result<(u16, String), BackendWsError> {
    let mut parts = line.trim_end().splitn(3, ' ');
    let _version = parts
        .next()
        .ok_or_else(|| BackendWsError::Protocol("missing HTTP version in handshake".into()))?;
    let status = parts
        .next()
        .ok_or_else(|| BackendWsError::Protocol("missing HTTP status in handshake".into()))?
        .parse::<u16>()
        .map_err(|_| BackendWsError::Protocol("invalid HTTP status in handshake".into()))?;
    let message = parts.next().map_or(String::new(), str::to_string);
    Ok((status, message))
}

fn websocket_key() -> String {
    STANDARD.encode(uuid::Uuid::new_v4().as_bytes())
}

fn websocket_accept(key: &str) -> String {
    let mut sha1 = Sha1::new();
    sha1.update(key.as_bytes());
    sha1.update(WEBSOCKET_GUID.as_bytes());
    STANDARD.encode(sha1.digest().bytes())
}

fn mask_key() -> [u8; 4] {
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    [bytes[0], bytes[1], bytes[2], bytes[3]]
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
