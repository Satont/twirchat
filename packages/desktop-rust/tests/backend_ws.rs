use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;
use sha1_smol::Sha1;
use std::collections::HashSet;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use twirchat::protocol::{DesktopToBackendMessage, Platform};
use twirchat::services::{
    BackendToDesktopMessageKind, BackendWsCommand, BackendWsConfig, BackendWsEvent, BusConfig,
    BusReceiver, BusSender, LifecycleCommand, ReconnectBackoff, ServiceCommand, ServiceEvent,
    ServiceExitReason, bounded, run_backend_ws_service,
};
use twirchat::storage::Storage;

const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

#[test]
fn backend_ws_handles_all_protocol_variants() -> Result<(), Box<dyn std::error::Error>> {
    let fixture_text = fs::read_to_string(fixture_path("backend-to-desktop.json"))?;
    let fixture_values: Vec<Value> = serde_json::from_str(&fixture_text)?;
    let fixture_payloads = fixture_values
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()?;
    let expected_kinds = fixture_values
        .iter()
        .map(expected_kind)
        .collect::<Result<HashSet<_>, _>>()?;
    let expected_count = fixture_payloads.len();

    let storage = TestStorage::new()?;
    let server = MockBackend::start(BackendScript::ProtocolVariants {
        expected_secret: storage.client_secret.clone(),
        payloads: fixture_payloads,
    })?;
    let service = TestService::start(server.url(), storage.path.clone(), Duration::from_millis(5))?;

    service.send(ServiceCommand::BackendWs(BackendWsCommand::Connect))?;
    let mut early_events = Vec::new();
    wait_for_event(
        &service.events,
        Duration::from_secs(2),
        &mut early_events,
        |event| matches!(event, ServiceEvent::BackendWs(BackendWsEvent::Connected)),
    )?;

    service.send(ServiceCommand::BackendWs(BackendWsCommand::SendPing))?;
    service.send(ServiceCommand::BackendWs(BackendWsCommand::SendMessage {
        message: DesktopToBackendMessage::SendMessage {
            platform: Platform::Twitch,
            channel: "streamer".into(),
            message: "hello from rust".into(),
        },
    }))?;

    let mut decoded_kinds = HashSet::new();
    let mut decoded_count = 0_usize;
    let mut malformed_count = 0_usize;
    let deadline = Instant::now() + Duration::from_secs(3);
    for event in early_events {
        collect_decode_evidence(
            event,
            &mut decoded_kinds,
            &mut decoded_count,
            &mut malformed_count,
        );
    }
    while Instant::now() < deadline && (decoded_count < expected_count || malformed_count < 2) {
        if let Ok(event) = service.events.recv_timeout(Duration::from_millis(50)) {
            collect_decode_evidence(
                event,
                &mut decoded_kinds,
                &mut decoded_count,
                &mut malformed_count,
            );
        }
    }

    assert_eq!(decoded_count, expected_count);
    assert_eq!(decoded_kinds, expected_kinds);
    assert!(malformed_count >= 2);

    let outgoing = server.join()?;
    assert!(outgoing.iter().any(|message| message["type"] == "ping"));
    assert!(outgoing.iter().any(|message| {
        message["type"] == "send_message" && message["message"] == "hello from rust"
    }));
    println!(
        "backend_ws handled {decoded_count} fixture payloads across {} variants and {malformed_count} malformed payloads safely",
        decoded_kinds.len()
    );

    service.shutdown()?;
    Ok(())
}

#[test]
fn backend_ws_reconnects_after_disconnect() -> Result<(), Box<dyn std::error::Error>> {
    let storage = TestStorage::new()?;
    let server = MockBackend::start(BackendScript::Reconnect {
        expected_secret: storage.client_secret.clone(),
    })?;
    let service = TestService::start(server.url(), storage.path.clone(), Duration::from_millis(5))?;

    service.send(ServiceCommand::BackendWs(BackendWsCommand::Connect))?;

    let mut saw_first_connected = false;
    let mut saw_disconnect = false;
    let mut saw_reconnect_scheduled = false;
    let mut saw_second_connected = false;
    let deadline = Instant::now() + Duration::from_secs(3);

    while Instant::now() < deadline && !saw_second_connected {
        if let Ok(event) = service.events.recv_timeout(Duration::from_millis(50)) {
            match event {
                ServiceEvent::BackendWs(BackendWsEvent::Connected) if !saw_first_connected => {
                    saw_first_connected = true;
                }
                ServiceEvent::BackendWs(BackendWsEvent::Disconnected { .. })
                    if saw_first_connected =>
                {
                    saw_disconnect = true;
                }
                ServiceEvent::BackendWs(BackendWsEvent::ReconnectScheduled { delay, .. })
                    if saw_disconnect =>
                {
                    assert_eq!(delay, Duration::from_millis(10));
                    saw_reconnect_scheduled = true;
                }
                ServiceEvent::BackendWs(BackendWsEvent::Connected) if saw_reconnect_scheduled => {
                    saw_second_connected = true;
                }
                _ => {}
            }
        }
    }

    assert!(saw_first_connected);
    assert!(saw_disconnect);
    assert!(saw_reconnect_scheduled);
    assert!(saw_second_connected);
    println!("backend_ws observed connected -> disconnected -> backoff -> reconnected ordering");

    server.join()?;
    service.shutdown()?;
    Ok(())
}

struct TestStorage {
    _dir: TempDir,
    path: PathBuf,
    client_secret: String,
}

impl TestStorage {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("twirchat.sqlite");
        let storage = Storage::open(&path)?;
        let client_secret = storage.client_identity().get_client_secret()?;
        drop(storage);
        Ok(Self {
            _dir: dir,
            path,
            client_secret,
        })
    }
}

struct TestService {
    commands: BusSender<ServiceCommand>,
    events: BusReceiver<ServiceEvent>,
    join: thread::JoinHandle<twirchat::services::ServiceStopReport>,
}

impl TestService {
    fn start(
        url: String,
        storage_path: PathBuf,
        poll_interval: Duration,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let (event_sender, events) = bounded(BusConfig::new(512)?);
        let (commands, command_receiver) = bounded(BusConfig::new(64)?);
        let backoff = ReconnectBackoff::new(Duration::from_millis(10), Duration::from_millis(10));
        let config = BackendWsConfig::new(url, storage_path).with_backoff(backoff);
        let cancellation = twirchat::services::CancellationToken::new();
        let join = thread::spawn(move || {
            run_backend_ws_service(
                config,
                cancellation,
                poll_interval,
                command_receiver,
                event_sender,
            )
        });
        Ok(Self {
            commands,
            events,
            join,
        })
    }

    fn send(&self, command: ServiceCommand) -> Result<(), Box<dyn std::error::Error>> {
        self.commands.try_publish(command)?;
        Ok(())
    }

    fn shutdown(self) -> Result<(), Box<dyn std::error::Error>> {
        self.commands
            .try_publish(ServiceCommand::Lifecycle(LifecycleCommand::Shutdown))?;
        let report = self
            .join
            .join()
            .map_err(|_| "backend_ws service thread panicked")?;
        assert_eq!(report.reason(), ServiceExitReason::ShutdownCommand);
        Ok(())
    }
}

enum BackendScript {
    ProtocolVariants {
        expected_secret: String,
        payloads: Vec<String>,
    },
    Reconnect {
        expected_secret: String,
    },
}

struct MockBackend {
    address: String,
    join: thread::JoinHandle<Result<Vec<Value>, String>>,
}

impl MockBackend {
    fn start(script: BackendScript) -> Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let address = listener.local_addr()?.to_string();
        let join = thread::spawn(move || run_mock_backend(listener, script));
        Ok(Self { address, join })
    }

    fn url(&self) -> String {
        format!("ws://{}/ws", self.address)
    }

    fn join(self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        self.join
            .join()
            .map_err(|_| "mock backend thread panicked")?
            .map_err(Into::into)
    }
}

fn run_mock_backend(listener: TcpListener, script: BackendScript) -> Result<Vec<Value>, String> {
    match script {
        BackendScript::ProtocolVariants {
            expected_secret,
            payloads,
        } => {
            let (mut stream, _) = listener.accept().map_err(|error| error.to_string())?;
            accept_ws(&mut stream, &expected_secret).map_err(|error| error.to_string())?;
            for payload in payloads {
                write_text_frame(&mut stream, &payload).map_err(|error| error.to_string())?;
            }
            write_text_frame(&mut stream, "not json").map_err(|error| error.to_string())?;
            write_text_frame(&mut stream, r#"{"type":"unknown_backend_packet"}"#)
                .map_err(|error| error.to_string())?;

            let mut outgoing = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(2);
            stream
                .set_read_timeout(Some(Duration::from_millis(50)))
                .map_err(|error| error.to_string())?;
            while Instant::now() < deadline && outgoing.len() < 2 {
                match read_text_frame(&mut stream) {
                    Ok(Some(payload)) => {
                        let value = serde_json::from_str::<Value>(&payload)
                            .map_err(|error| error.to_string())?;
                        outgoing.push(value);
                    }
                    Ok(None) => {}
                    Err(error)
                        if error.kind() == io::ErrorKind::TimedOut
                            || error.kind() == io::ErrorKind::WouldBlock => {}
                    Err(error) => return Err(error.to_string()),
                }
            }
            Ok(outgoing)
        }
        BackendScript::Reconnect { expected_secret } => {
            let (mut first, _) = listener.accept().map_err(|error| error.to_string())?;
            accept_ws(&mut first, &expected_secret).map_err(|error| error.to_string())?;
            first
                .shutdown(Shutdown::Both)
                .map_err(|error| error.to_string())?;

            let (mut second, _) = listener.accept().map_err(|error| error.to_string())?;
            accept_ws(&mut second, &expected_secret).map_err(|error| error.to_string())?;
            write_text_frame(&mut second, r#"{"type":"pong"}"#)
                .map_err(|error| error.to_string())?;
            Ok(Vec::new())
        }
    }
}

fn accept_ws(stream: &mut TcpStream, expected_secret: &str) -> io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut key = String::new();
    let mut secret = String::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("sec-websocket-key") {
                key = value.trim().to_string();
            } else if name.eq_ignore_ascii_case("x-client-secret") {
                secret = value.trim().to_string();
            }
        }
    }
    if secret != expected_secret {
        stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")?;
        return Ok(());
    }
    let accept = websocket_accept(&key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

fn write_text_frame(stream: &mut TcpStream, payload: &str) -> io::Result<()> {
    let bytes = payload.as_bytes();
    let mut frame = Vec::with_capacity(bytes.len() + 10);
    frame.push(0x81);
    if bytes.len() < 126 {
        frame.push(u8::try_from(bytes.len()).map_err(|_| invalid_data())?);
    } else {
        frame.push(126);
        frame.extend_from_slice(
            &u16::try_from(bytes.len())
                .map_err(|_| invalid_data())?
                .to_be_bytes(),
        );
    }
    frame.extend_from_slice(bytes);
    stream.write_all(&frame)?;
    stream.flush()
}

fn read_text_frame(stream: &mut TcpStream) -> io::Result<Option<String>> {
    let mut header = [0_u8; 2];
    match stream.read_exact(&mut header) {
        Ok(()) => {}
        Err(error)
            if error.kind() == io::ErrorKind::TimedOut
                || error.kind() == io::ErrorKind::WouldBlock =>
        {
            return Ok(None);
        }
        Err(error) => return Err(error),
    }
    let masked = header[1] & 0x80 != 0;
    let mut len = usize::from(header[1] & 0x7f);
    if len == 126 {
        let mut bytes = [0_u8; 2];
        stream.read_exact(&mut bytes)?;
        len = usize::from(u16::from_be_bytes(bytes));
    }
    let mask = if masked {
        let mut bytes = [0_u8; 4];
        stream.read_exact(&mut bytes)?;
        Some(bytes)
    } else {
        None
    };
    let mut payload = vec![0_u8; len];
    stream.read_exact(&mut payload)?;
    if let Some(mask) = mask {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    String::from_utf8(payload)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn websocket_accept(key: &str) -> String {
    let mut sha1 = Sha1::new();
    sha1.update(key.as_bytes());
    sha1.update(WS_GUID.as_bytes());
    STANDARD.encode(sha1.digest().bytes())
}

fn wait_for_event(
    events: &BusReceiver<ServiceEvent>,
    timeout: Duration,
    observed: &mut Vec<ServiceEvent>,
    predicate: impl Fn(&ServiceEvent) -> bool,
) -> Result<ServiceEvent, Box<dyn std::error::Error>> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(50)) {
            if predicate(&event) {
                return Ok(event);
            }
            observed.push(event);
        }
    }
    Err("timed out waiting for backend_ws event".into())
}

fn collect_decode_evidence(
    event: ServiceEvent,
    decoded_kinds: &mut HashSet<BackendToDesktopMessageKind>,
    decoded_count: &mut usize,
    malformed_count: &mut usize,
) {
    match event {
        ServiceEvent::BackendWs(BackendWsEvent::MessageReceived { kind }) => {
            decoded_kinds.insert(kind);
            *decoded_count += 1;
        }
        ServiceEvent::BackendWs(BackendWsEvent::MalformedPayload { .. }) => {
            *malformed_count += 1;
        }
        _ => {}
    }
}

fn fixture_path(file: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("protocol")
        .join(file)
}

fn expected_kind(value: &Value) -> Result<BackendToDesktopMessageKind, Box<dyn std::error::Error>> {
    let tag = value["type"]
        .as_str()
        .ok_or("fixture backend message type should be a string")?;
    match tag {
        "auth_url" => Ok(BackendToDesktopMessageKind::AuthUrl),
        "auth_success" => Ok(BackendToDesktopMessageKind::AuthSuccess),
        "auth_error" => Ok(BackendToDesktopMessageKind::AuthError),
        "error" => Ok(BackendToDesktopMessageKind::Error),
        "pong" => Ok(BackendToDesktopMessageKind::Pong),
        "chat_message" => Ok(BackendToDesktopMessageKind::ChatMessage),
        "chat_event" => Ok(BackendToDesktopMessageKind::ChatEvent),
        "platform_status" => Ok(BackendToDesktopMessageKind::PlatformStatus),
        "seventv_emote_set" => Ok(BackendToDesktopMessageKind::SeventvEmoteSet),
        "seventv_emote_added" => Ok(BackendToDesktopMessageKind::SeventvEmoteAdded),
        "seventv_emote_removed" => Ok(BackendToDesktopMessageKind::SeventvEmoteRemoved),
        "seventv_emote_updated" => Ok(BackendToDesktopMessageKind::SeventvEmoteUpdated),
        "seventv_system_message" => Ok(BackendToDesktopMessageKind::SeventvSystemMessage),
        other => Err(format!("unexpected fixture backend message type: {other}").into()),
    }
}

fn invalid_data() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "payload length overflow")
}
