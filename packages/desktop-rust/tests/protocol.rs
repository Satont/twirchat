use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use twirchat_desktop_rust::protocol::{
    Account, AppSettings, BackendToDesktopMessage, BunRequestPayload, DesktopToBackendMessage,
    NormalizedChatMessage, NormalizedEvent, PlatformStatusInfo, ProtocolDecodeError, StreamStatus,
    TwitchBadgesResponse, WatchedChannel, WatchedChannelsLayout, WebviewMessagePayload,
    parse_backend_to_desktop_message,
};

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedTypesFixture {
    account: Account,
    settings: AppSettings,
    chat_message: NormalizedChatMessage,
    event: NormalizedEvent,
    stream_status: StreamStatus,
    platform_status: PlatformStatusInfo,
    watched_channel: WatchedChannel,
    layout: WatchedChannelsLayout,
    twitch_badges: TwitchBadgesResponse,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcFixture {
    bun_requests: Vec<BunRequestPayload>,
    webview_messages: Vec<WebviewMessagePayload>,
}

#[test]
fn protocol_fixtures_round_trip() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_dir = manifest_dir.join("fixtures/protocol");

    let shared = round_trip_fixture::<SharedTypesFixture>(&fixture_dir.join("shared-types.json"))?;
    let backend_messages = round_trip_fixture::<Vec<BackendToDesktopMessage>>(
        &fixture_dir.join("backend-to-desktop.json"),
    )?;
    let desktop_messages = round_trip_fixture::<Vec<DesktopToBackendMessage>>(
        &fixture_dir.join("desktop-to-backend.json"),
    )?;
    let rpc = round_trip_fixture::<RpcFixture>(&fixture_dir.join("rpc.json"))?;

    let evidence = serde_json::json!({
        "fixtures": {
            "sharedTypes": "fixtures/protocol/shared-types.json",
            "backendToDesktop": backend_messages,
            "desktopToBackend": desktop_messages,
            "rpc": {
                "bunRequests": rpc.bun_requests.len(),
                "webviewMessages": rpc.webview_messages.len()
            }
        },
        "sampleAccountPlatform": shared.account.platform,
        "sampleLayoutVersion": shared.layout.version
    });

    let evidence_path = manifest_dir.join("../../.sisyphus/evidence/task-4-protocol-fixtures.json");
    write_evidence(&evidence_path, &serde_json::to_string_pretty(&evidence)?)?;

    Ok(())
}

#[test]
fn protocol_unknown_variant_reports_error() -> Result<(), Box<dyn std::error::Error>> {
    let error = parse_backend_to_desktop_message(r#"{"type":"mystery_packet","message":"nope"}"#)
        .err()
        .ok_or("unknown backend message should fail")?;

    match &error {
        ProtocolDecodeError::UnknownDiscriminant { value, .. } => {
            assert_eq!(value, "mystery_packet");
        }
        other => return Err(format!("expected unknown discriminant, got {other}").into()),
    }

    let evidence_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.sisyphus/evidence/task-4-protocol-error.txt");
    write_evidence(&evidence_path, &error.to_string())?;

    Ok(())
}

fn round_trip_fixture<T>(path: &Path) -> Result<T, Box<dyn std::error::Error>>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let text = fs::read_to_string(path)?;
    let decoded: T = serde_json::from_str(&text)?;
    let original: Value = serde_json::from_str(&text)?;
    let encoded = serde_json::to_value(&decoded)?;
    assert_eq!(encoded, original, "fixture round-trip changed structure");
    Ok(decoded)
}

fn write_evidence(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}
