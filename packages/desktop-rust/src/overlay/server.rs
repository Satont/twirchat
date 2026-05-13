use crate::overlay::protocol::OverlayMessage;
use crate::protocol::{NormalizedChatMessage, NormalizedEvent};
use crate::runtime::DEFAULT_OVERLAY_SERVER_PORT;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha1_smol::Sha1;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const DEFAULT_OVERLAY_PORT: u16 = DEFAULT_OVERLAY_SERVER_PORT;

const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlayRuntimePaths {
    pub fonts_dir: Option<PathBuf>,
    pub overlay_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct OverlayServerConfig {
    pub address: String,
    pub runtime_paths: OverlayRuntimePaths,
}

impl OverlayServerConfig {
    pub fn new(port: u16) -> Self {
        Self {
            address: format!("127.0.0.1:{port}"),
            runtime_paths: resolve_overlay_runtime_paths(default_runtime_base_dir()),
        }
    }

    pub fn with_runtime_paths(mut self, runtime_paths: OverlayRuntimePaths) -> Self {
        self.runtime_paths = runtime_paths;
        self
    }
}

#[derive(Debug)]
pub enum OverlayServerError {
    Io(io::Error),
    Serde(serde_json::Error),
    LockPoisoned(&'static str),
    ThreadPanicked,
}

impl std::fmt::Display for OverlayServerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "overlay server I/O error: {error}"),
            Self::Serde(error) => write!(formatter, "overlay payload serialization error: {error}"),
            Self::LockPoisoned(name) => write!(formatter, "overlay server lock poisoned: {name}"),
            Self::ThreadPanicked => formatter.write_str("overlay server thread panicked"),
        }
    }
}

impl std::error::Error for OverlayServerError {}

impl From<io::Error> for OverlayServerError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for OverlayServerError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serde(error)
    }
}

#[derive(Clone)]
pub struct OverlayBroadcast {
    clients: Arc<Mutex<Vec<OverlayClient>>>,
}

impl OverlayBroadcast {
    pub fn push_chat_message(
        &self,
        message: NormalizedChatMessage,
    ) -> Result<(), OverlayServerError> {
        self.broadcast(&OverlayMessage::from_chat_message(message))
    }

    pub fn push_chat_event(&self, event: NormalizedEvent) -> Result<(), OverlayServerError> {
        self.broadcast(&OverlayMessage::ChatEvent {
            data: Box::new(event),
        })
    }

    pub fn clear(&self) -> Result<(), OverlayServerError> {
        self.broadcast(&OverlayMessage::Clear)
    }

    pub fn broadcast(&self, message: &OverlayMessage) -> Result<(), OverlayServerError> {
        let payload = serde_json::to_string(message)?;
        self.broadcast_text(&payload)
    }

    pub fn client_count(&self) -> Result<usize, OverlayServerError> {
        Ok(self
            .clients
            .lock()
            .map_err(|_| OverlayServerError::LockPoisoned("clients"))?
            .len())
    }

    fn broadcast_text(&self, payload: &str) -> Result<(), OverlayServerError> {
        let mut clients = self
            .clients
            .lock()
            .map_err(|_| OverlayServerError::LockPoisoned("clients"))?;
        clients.retain_mut(|client| write_text_frame(&mut client.stream, payload).is_ok());
        Ok(())
    }

    fn add_client(&self, id: u64, stream: TcpStream) -> Result<(), OverlayServerError> {
        stream.set_nodelay(true)?;
        self.clients
            .lock()
            .map_err(|_| OverlayServerError::LockPoisoned("clients"))?
            .push(OverlayClient { id, stream });
        Ok(())
    }

    fn remove_client(&self, id: u64) -> Result<(), OverlayServerError> {
        self.clients
            .lock()
            .map_err(|_| OverlayServerError::LockPoisoned("clients"))?
            .retain(|client| client.id != id);
        Ok(())
    }
}

pub struct OverlayServer {
    address: SocketAddr,
    shutdown: Arc<AtomicBool>,
    join: Option<JoinHandle<Result<(), OverlayServerError>>>,
    broadcast: OverlayBroadcast,
}

impl OverlayServer {
    pub fn start(config: OverlayServerConfig) -> Result<Self, OverlayServerError> {
        let listener = TcpListener::bind(&config.address)?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let shutdown = Arc::new(AtomicBool::new(false));
        let clients = Arc::new(Mutex::new(Vec::new()));
        let broadcast = OverlayBroadcast { clients };
        let accept_shutdown = Arc::clone(&shutdown);
        let accept_broadcast = broadcast.clone();
        let paths = config.runtime_paths;

        let join = thread::spawn(move || {
            run_accept_loop(listener, paths, accept_broadcast, accept_shutdown)
        });

        Ok(Self {
            address,
            shutdown,
            join: Some(join),
            broadcast,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}", self.address)
    }

    pub fn broadcaster(&self) -> OverlayBroadcast {
        self.broadcast.clone()
    }

    pub fn shutdown(mut self) -> Result<(), OverlayServerError> {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
        if let Some(join) = self.join.take() {
            join.join()
                .map_err(|_| OverlayServerError::ThreadPanicked)??;
        }
        Ok(())
    }
}

impl Drop for OverlayServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

#[derive(Debug)]
struct OverlayClient {
    id: u64,
    stream: TcpStream,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

pub fn resolve_overlay_runtime_paths(base_dir: impl AsRef<Path>) -> OverlayRuntimePaths {
    resolve_overlay_runtime_paths_with(base_dir, Path::exists)
}

pub fn resolve_overlay_runtime_paths_with(
    base_dir: impl AsRef<Path>,
    path_exists: impl Fn(&Path) -> bool,
) -> OverlayRuntimePaths {
    let base_dir = base_dir.as_ref();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_dir = manifest_dir.parent().and_then(Path::parent);

    let mut overlay_candidates = vec![
        base_dir.join("..").join("views").join("overlay"),
        base_dir.join("..").join("dist").join("overlay"),
        manifest_dir
            .join("..")
            .join("desktop")
            .join("dist")
            .join("overlay"),
    ];
    if let Some(workspace_dir) = workspace_dir {
        overlay_candidates.push(
            workspace_dir
                .join("packages")
                .join("desktop")
                .join("dist")
                .join("overlay"),
        );
    }

    let mut font_candidates = vec![
        base_dir.join("..").join("views").join("fonts"),
        base_dir.join("..").join("public").join("fonts"),
        manifest_dir
            .join("..")
            .join("desktop")
            .join("public")
            .join("fonts"),
    ];
    if let Some(workspace_dir) = workspace_dir {
        font_candidates.push(
            workspace_dir
                .join("packages")
                .join("desktop")
                .join("public")
                .join("fonts"),
        );
    }

    OverlayRuntimePaths {
        overlay_dir: overlay_candidates
            .into_iter()
            .find(|path| path_exists(path)),
        fonts_dir: font_candidates.into_iter().find(|path| path_exists(path)),
    }
}

fn default_runtime_base_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn run_accept_loop(
    listener: TcpListener,
    runtime_paths: OverlayRuntimePaths,
    broadcast: OverlayBroadcast,
    shutdown: Arc<AtomicBool>,
) -> Result<(), OverlayServerError> {
    let next_client_id = Arc::new(AtomicU64::new(1));
    while !shutdown.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let paths = runtime_paths.clone();
                let client_broadcast = broadcast.clone();
                let client_shutdown = Arc::clone(&shutdown);
                let id_source = Arc::clone(&next_client_id);
                thread::spawn(move || {
                    let _ = handle_connection(
                        stream,
                        paths,
                        client_broadcast,
                        client_shutdown,
                        id_source,
                    );
                });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn handle_connection(
    stream: TcpStream,
    runtime_paths: OverlayRuntimePaths,
    broadcast: OverlayBroadcast,
    shutdown: Arc<AtomicBool>,
    next_client_id: Arc<AtomicU64>,
) -> Result<(), OverlayServerError> {
    stream.set_read_timeout(Some(Duration::from_millis(250)))?;
    let request = match read_http_request(&stream) {
        Ok(request) => request,
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if is_websocket_upgrade(&request) {
        accept_websocket(stream, &request, broadcast, shutdown, next_client_id)
    } else {
        serve_http(stream, &runtime_paths, &request)
    }
}

fn read_http_request(stream: &TcpStream) -> io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or("/");
    let path = target.split('?').next().unwrap_or("/").to_string();

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
    })
}

fn serve_http(
    mut stream: TcpStream,
    runtime_paths: &OverlayRuntimePaths,
    request: &HttpRequest,
) -> Result<(), OverlayServerError> {
    if request.method != "GET" && request.method != "HEAD" {
        return write_response(
            &mut stream,
            405,
            "Method Not Allowed",
            "text/plain; charset=utf-8",
            b"Method not allowed",
            request.method == "HEAD",
        );
    }

    if let Some(relative_path) = request.path.strip_prefix("/fonts/") {
        let Some(fonts_dir) = &runtime_paths.fonts_dir else {
            return write_missing_root(&mut stream, "fonts", request.method == "HEAD");
        };
        return serve_file(
            &mut stream,
            fonts_dir,
            relative_path,
            None,
            request.method == "HEAD",
        );
    }

    if request.path.starts_with("/assets/") {
        let Some(overlay_dir) = &runtime_paths.overlay_dir else {
            return write_missing_root(&mut stream, "overlay", request.method == "HEAD");
        };
        return serve_file(
            &mut stream,
            overlay_dir,
            request.path.trim_start_matches('/'),
            None,
            request.method == "HEAD",
        );
    }

    if request.path != "/"
        && request.path != "/index.html"
        && Path::new(&request.path).extension().is_some()
    {
        return write_response(
            &mut stream,
            404,
            "Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
            request.method == "HEAD",
        );
    }

    let Some(overlay_dir) = &runtime_paths.overlay_dir else {
        return write_missing_root(&mut stream, "overlay", request.method == "HEAD");
    };
    serve_file(
        &mut stream,
        overlay_dir,
        "index.html",
        Some("text/html; charset=utf-8"),
        request.method == "HEAD",
    )
}

fn serve_file(
    stream: &mut TcpStream,
    root: &Path,
    relative_path: &str,
    content_type: Option<&str>,
    headers_only: bool,
) -> Result<(), OverlayServerError> {
    let Some(path) = safe_join(root, relative_path) else {
        return write_response(
            stream,
            404,
            "Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
            headers_only,
        );
    };

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return write_response(
                stream,
                404,
                "Not Found",
                "text/plain; charset=utf-8",
                b"Not found",
                headers_only,
            );
        }
        Err(error) => return Err(error.into()),
    };
    let content_type = content_type.unwrap_or_else(|| content_type_for(&path));
    write_response(stream, 200, "OK", content_type, &bytes, headers_only)
}

fn write_missing_root(
    stream: &mut TcpStream,
    kind: &str,
    headers_only: bool,
) -> Result<(), OverlayServerError> {
    let message = format!("Missing {kind} asset root");
    write_response(
        stream,
        500,
        "Internal Server Error",
        "text/plain; charset=utf-8",
        message.as_bytes(),
        headers_only,
    )
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
    headers_only: bool,
) -> Result<(), OverlayServerError> {
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    if !headers_only {
        stream.write_all(body)?;
    }
    stream.flush()?;
    Ok(())
}

fn safe_join(root: &Path, relative_path: &str) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for component in Path::new(relative_path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(path)
}

fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn is_websocket_upgrade(request: &HttpRequest) -> bool {
    header_contains(request, "connection", "upgrade")
        && header_eq(request, "upgrade", "websocket")
        && header(request, "sec-websocket-key").is_some()
}

fn accept_websocket(
    mut stream: TcpStream,
    request: &HttpRequest,
    broadcast: OverlayBroadcast,
    shutdown: Arc<AtomicBool>,
    next_client_id: Arc<AtomicU64>,
) -> Result<(), OverlayServerError> {
    let Some(key) = header(request, "sec-websocket-key") else {
        return write_response(
            &mut stream,
            400,
            "Bad Request",
            "text/plain; charset=utf-8",
            b"Missing Sec-WebSocket-Key",
            false,
        );
    };
    let accept = websocket_accept(key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;

    let id = next_client_id.fetch_add(1, Ordering::Relaxed);
    broadcast.add_client(id, stream.try_clone()?)?;
    let result = read_websocket_until_close(&mut stream, &shutdown);
    let remove_result = broadcast.remove_client(id);
    result?;
    remove_result
}

fn read_websocket_until_close(
    stream: &mut TcpStream,
    shutdown: &AtomicBool,
) -> Result<(), OverlayServerError> {
    while !shutdown.load(Ordering::SeqCst) {
        match read_frame(stream) {
            Ok(FrameRead::Close) => return Ok(()),
            Ok(FrameRead::Data) => {}
            Err(error)
                if error.kind() == io::ErrorKind::TimedOut
                    || error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error)
                if error.kind() == io::ErrorKind::UnexpectedEof
                    || error.kind() == io::ErrorKind::ConnectionReset =>
            {
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

enum FrameRead {
    Data,
    Close,
}

fn read_frame(stream: &mut TcpStream) -> io::Result<FrameRead> {
    let mut header = [0_u8; 2];
    stream.read_exact(&mut header)?;
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
    let len = usize::try_from(len)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame too large"))?;
    let mut payload = vec![0_u8; len];
    stream.read_exact(&mut payload)?;
    if let Some(mask) = mask {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    if opcode == 0x8 {
        Ok(FrameRead::Close)
    } else {
        Ok(FrameRead::Data)
    }
}

fn write_text_frame(stream: &mut TcpStream, payload: &str) -> io::Result<()> {
    let bytes = payload.as_bytes();
    let mut frame = Vec::with_capacity(bytes.len().saturating_add(10));
    frame.push(0x81);
    if bytes.len() < 126 {
        frame.push(u8::try_from(bytes.len()).map_err(|_| payload_length_error())?);
    } else if u16::try_from(bytes.len()).is_ok() {
        frame.push(126);
        frame.extend_from_slice(
            &u16::try_from(bytes.len())
                .map_err(|_| payload_length_error())?
                .to_be_bytes(),
        );
    } else {
        frame.push(127);
        frame.extend_from_slice(
            &u64::try_from(bytes.len())
                .map_err(|_| payload_length_error())?
                .to_be_bytes(),
        );
    }
    frame.extend_from_slice(bytes);
    stream.write_all(&frame)?;
    stream.flush()
}

fn payload_length_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "payload length overflow")
}

fn websocket_accept(key: &str) -> String {
    let mut sha1 = Sha1::new();
    sha1.update(key.as_bytes());
    sha1.update(WS_GUID.as_bytes());
    STANDARD.encode(sha1.digest().bytes())
}

fn header<'a>(request: &'a HttpRequest, name: &str) -> Option<&'a str> {
    request
        .headers
        .iter()
        .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn header_eq(request: &HttpRequest, name: &str, expected: &str) -> bool {
    header(request, name).is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn header_contains(request: &HttpRequest, name: &str, expected: &str) -> bool {
    header(request, name).is_some_and(|value| {
        value
            .split(',')
            .any(|part| part.trim().eq_ignore_ascii_case(expected))
    })
}
