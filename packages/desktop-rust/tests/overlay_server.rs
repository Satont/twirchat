use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;
use sha1_smol::Sha1;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use twirchat_desktop_rust::overlay::{
    OverlayRuntimePaths, OverlayServer, OverlayServerConfig, resolve_overlay_runtime_paths,
};
use twirchat_desktop_rust::protocol::{
    ChatAuthor, ChatMessageType, NormalizedChatMessage, Platform,
};

const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

#[test]
fn overlay_server_serves_vue_assets() -> Result<(), Box<dyn std::error::Error>> {
    let runtime_paths = built_overlay_runtime_paths()?;
    let overlay_dir = runtime_paths.overlay_dir.as_ref().ok_or(
        "overlay dist directory was not resolved; run bun run --cwd packages/desktop build:views",
    )?;
    let asset_path = first_built_asset(overlay_dir)?;
    let asset_name = asset_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("built asset should have a UTF-8 file name")?;

    let server = OverlayServer::start(
        OverlayServerConfig {
            address: "127.0.0.1:0".into(),
            runtime_paths,
        }
        .with_runtime_paths(built_overlay_runtime_paths()?),
    )?;
    let address = server.local_addr();

    let index = http_get(address, "/?bg=transparent&fontSize=14&maxMessages=20")?;
    assert_eq!(index.status, 200);
    assert!(index.content_type.starts_with("text/html"));
    assert!(String::from_utf8(index.body)?.contains("id=\"app\""));

    let asset = http_get(address, &format!("/assets/{asset_name}"))?;
    assert_eq!(asset.status, 200);
    assert_eq!(asset.body, fs::read(&asset_path)?);
    assert_content_type_matches_asset(asset_name, &asset.content_type)?;

    server.shutdown()?;
    println!(
        "overlay server served Vue index and /assets/{asset_name} with {}",
        asset.content_type
    );
    Ok(())
}

#[test]
fn overlay_ws_reconnect_contract() -> Result<(), Box<dyn std::error::Error>> {
    let runtime_paths = built_overlay_runtime_paths()?;
    let first_server = OverlayServer::start(OverlayServerConfig {
        address: "127.0.0.1:0".into(),
        runtime_paths: runtime_paths.clone(),
    })?;
    let address = first_server.local_addr();
    let first_broadcast = first_server.broadcaster();
    let mut first_client = connect_ws(address)?;

    wait_for_client_count(&first_broadcast, 1)?;
    first_broadcast.push_chat_message(sample_message("first"))?;
    let first_payload = read_ws_text(&mut first_client)?;
    let first_value: Value = serde_json::from_str(&first_payload)?;
    assert_eq!(first_value["type"], "chat_message");
    assert_eq!(first_value["data"]["message"]["id"], "first");
    drop(first_client);
    first_server.shutdown()?;

    let second_server = OverlayServer::start(OverlayServerConfig {
        address: address.to_string(),
        runtime_paths,
    })?;
    let second_broadcast = second_server.broadcaster();
    let mut second_client = connect_ws(address)?;

    wait_for_client_count(&second_broadcast, 1)?;
    second_broadcast.push_chat_message(sample_message("second"))?;
    let second_payload = read_ws_text(&mut second_client)?;
    let second_value: Value = serde_json::from_str(&second_payload)?;
    assert_eq!(second_value["type"], "chat_message");
    assert_eq!(second_value["data"]["message"]["id"], "second");

    second_client.shutdown(Shutdown::Both)?;
    second_server.shutdown()?;
    println!(
        "overlay websocket accepted a reconnect after server restart and delivered later chat"
    );
    Ok(())
}

struct HttpResponse {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}

fn built_overlay_runtime_paths() -> Result<OverlayRuntimePaths, Box<dyn std::error::Error>> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let paths = resolve_overlay_runtime_paths(&base);
    if paths.overlay_dir.is_none() {
        return Err(
            "missing built Vue overlay assets; run bun run --cwd packages/desktop build:views"
                .into(),
        );
    }
    Ok(paths)
}

fn first_built_asset(overlay_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let assets_dir = overlay_dir.join("assets");
    let mut assets = fs::read_dir(&assets_dir)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    assets.sort();
    assets
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("no built assets found in {}", assets_dir.display()).into())
}

fn http_get(address: SocketAddr, path: &str) -> Result<HttpResponse, Box<dyn std::error::Error>> {
    let mut stream = TcpStream::connect(address)?;
    stream.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n").as_bytes(),
    )?;
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line)?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("HTTP response should include a status code")?
        .parse::<u16>()?;
    let mut content_type = String::new();
    let mut content_length = None;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-type") {
                content_type = value.trim().to_string();
            } else if name.eq_ignore_ascii_case("content-length") {
                content_length = Some(value.trim().parse::<usize>()?);
            }
        }
    }
    let mut body = Vec::new();
    reader.read_to_end(&mut body)?;
    if let Some(content_length) = content_length {
        assert_eq!(body.len(), content_length);
    }
    Ok(HttpResponse {
        status,
        content_type,
        body,
    })
}

fn assert_content_type_matches_asset(
    asset_name: &str,
    content_type: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let extension = Path::new(asset_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .ok_or("asset should have an extension")?;
    match extension {
        "css" => assert!(content_type.starts_with("text/css")),
        "js" | "mjs" => assert!(content_type.starts_with("text/javascript")),
        "png" => assert_eq!(content_type, "image/png"),
        "svg" => assert_eq!(content_type, "image/svg+xml"),
        "webp" => assert_eq!(content_type, "image/webp"),
        _ => assert_eq!(content_type, "application/octet-stream"),
    }
    Ok(())
}

fn connect_ws(address: SocketAddr) -> Result<TcpStream, Box<dyn std::error::Error>> {
    let mut stream = TcpStream::connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let key = "dGhlIHNhbXBsZSBub25jZQ==";
    stream.write_all(
        format!(
            "GET / HTTP/1.1\r\nHost: {address}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        .as_bytes(),
    )?;
    stream.flush()?;

    let mut reader = BufReader::new(stream.try_clone()?);
    let mut status_line = String::new();
    reader.read_line(&mut status_line)?;
    assert!(status_line.contains("101 Switching Protocols"));
    let mut accept = String::new();
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
            accept = value.trim().to_string();
        }
    }
    assert_eq!(accept, websocket_accept(key));
    Ok(stream)
}

fn read_ws_text(stream: &mut TcpStream) -> Result<String, Box<dyn std::error::Error>> {
    let mut header = [0_u8; 2];
    stream.read_exact(&mut header)?;
    assert_eq!(header[0] & 0x0f, 0x1);
    let masked = header[1] & 0x80 != 0;
    let mut len = usize::from(header[1] & 0x7f);
    if len == 126 {
        let mut bytes = [0_u8; 2];
        stream.read_exact(&mut bytes)?;
        len = usize::from(u16::from_be_bytes(bytes));
    } else if len == 127 {
        let mut bytes = [0_u8; 8];
        stream.read_exact(&mut bytes)?;
        len = usize::try_from(u64::from_be_bytes(bytes))?;
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
    String::from_utf8(payload).map_err(Into::into)
}

fn wait_for_client_count(
    broadcast: &twirchat_desktop_rust::overlay::OverlayBroadcast,
    expected: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if broadcast.client_count()? == expected {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err(format!("timed out waiting for {expected} overlay websocket clients").into())
}

fn sample_message(id: &str) -> NormalizedChatMessage {
    NormalizedChatMessage {
        id: id.into(),
        platform: Platform::Twitch,
        channel_id: "channel-1".into(),
        author: ChatAuthor {
            id: "author-1".into(),
            username: Some("tester".into()),
            display_name: "Tester".into(),
            color: Some("#9146ff".into()),
            avatar_url: None,
            badges: Vec::new(),
        },
        text: format!("hello {id}"),
        emotes: Vec::new(),
        timestamp: "2026-05-11T00:00:00.000Z".into(),
        message_type: ChatMessageType::Message,
        reply: None,
    }
}

fn websocket_accept(key: &str) -> String {
    let mut sha1 = Sha1::new();
    sha1.update(key.as_bytes());
    sha1.update(WS_GUID.as_bytes());
    STANDARD.encode(sha1.digest().bytes())
}

fn _assert_io_error_is_send_sync(error: io::Error) -> io::Error {
    error
}
