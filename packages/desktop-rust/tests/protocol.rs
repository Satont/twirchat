use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use twirchat::protocol::{
    Account, AppSettings, BackendToDesktopMessage, BunRequestPayload, DesktopToBackendMessage,
    GetUserChatHistoryParams, NormalizedChatMessage, NormalizedEvent, Platform, PlatformStatusInfo,
    ProtocolDecodeError, StreamStatus, TwitchBadgesResponse, UserCardAccountAgeField,
    UserCardFieldStatus, UserCardFollowAgeField, UserCardMetadataPlatform, UserCardMetadataRequest,
    UserCardMetadataResponse, UserCardSubAgeField, UserCardSubscriptionDurationField,
    UserChatHistoryCursor, UserChatHistoryPage, WatchedChannel, WatchedChannelsLayout,
    WebviewMessagePayload, parse_backend_to_desktop_message,
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
fn user_card_protocol_history_contract_uses_exact_camel_case_json()
-> Result<(), Box<dyn std::error::Error>> {
    let request_json = serde_json::json!({
        "platform": "twitch",
        "platformUserId": "twitch_user_123",
        "limit": 2,
        "cursor": {
            "createdAt": 1_700_000_004_000_u64,
            "id": "twitch-4"
        }
    });
    let request = GetUserChatHistoryParams {
        platform: Platform::Twitch,
        platform_user_id: "twitch_user_123".to_string(),
        limit: Some(2),
        cursor: Some(UserChatHistoryCursor {
            created_at: 1_700_000_004_000,
            id: "twitch-4".to_string(),
        }),
    };
    assert_eq!(serde_json::to_value(&request)?, request_json);
    assert_eq!(
        serde_json::from_value::<GetUserChatHistoryParams>(request_json)?,
        request
    );

    let page_json = serde_json::json!({
        "messages": [sample_user_card_message("twitch-4"), sample_user_card_message("twitch-5")],
        "nextCursor": {
            "createdAt": 1_700_000_004_000_u64,
            "id": "twitch-4"
        },
        "hasMore": true
    });
    let page = UserChatHistoryPage {
        messages: vec![
            sample_user_card_message_value("twitch-4")?,
            sample_user_card_message_value("twitch-5")?,
        ],
        next_cursor: Some(UserChatHistoryCursor {
            created_at: 1_700_000_004_000,
            id: "twitch-4".to_string(),
        }),
        has_more: true,
    };
    assert_eq!(serde_json::to_value(&page)?, page_json);
    assert_eq!(
        serde_json::from_value::<UserChatHistoryPage>(page_json)?,
        page
    );

    Ok(())
}

#[test]
fn user_card_protocol_metadata_contract_uses_exact_camel_case_json()
-> Result<(), Box<dyn std::error::Error>> {
    let request_json = serde_json::json!({
        "platform": "twitch",
        "platformUserId": "twitch_user_123",
        "username": "testviewer",
        "channelId": "twitch_channel_1",
        "channelSlug": "testchannel"
    });
    let request = UserCardMetadataRequest {
        platform: UserCardMetadataPlatform::Twitch,
        platform_user_id: "twitch_user_123".to_string(),
        username: Some("testviewer".to_string()),
        channel_id: Some("twitch_channel_1".to_string()),
        channel_slug: Some("testchannel".to_string()),
    };
    assert_eq!(serde_json::to_value(&request)?, request_json);
    assert_eq!(
        serde_json::from_value::<UserCardMetadataRequest>(request_json)?,
        request
    );

    let response_json = serde_json::json!({
        "platform": "kick",
        "platformUserId": "kick_user_456",
        "fetchedAt": 1_700_000_010_000_u64,
        "accountAge": {
            "status": "available",
            "createdAt": "2023-01-02T03:04:05Z",
            "message": "Account created 2023-01-02"
        },
        "followAge": {
            "status": "unsupported",
            "followedAt": null,
            "message": "Kick follow age is unavailable"
        },
        "subscriptionDuration": {
            "status": "missing_permission",
            "currentlySubscribed": null,
            "tier": "1000",
            "isGift": false,
            "gifterDisplayName": "GiftGiver",
            "message": "Missing subscription scope"
        },
        "subAge": {
            "status": "unavailable",
            "months": null,
            "message": "No subscription data"
        }
    });
    let response = UserCardMetadataResponse {
        platform: UserCardMetadataPlatform::Kick,
        platform_user_id: "kick_user_456".to_string(),
        fetched_at: 1_700_000_010_000,
        account_age: UserCardAccountAgeField {
            status: UserCardFieldStatus::Available,
            created_at: Some("2023-01-02T03:04:05Z".to_string()),
            message: Some("Account created 2023-01-02".to_string()),
        },
        follow_age: UserCardFollowAgeField {
            status: UserCardFieldStatus::Unsupported,
            followed_at: None,
            message: Some("Kick follow age is unavailable".to_string()),
        },
        subscription_duration: UserCardSubscriptionDurationField {
            status: UserCardFieldStatus::MissingPermission,
            currently_subscribed: None,
            tier: Some("1000".to_string()),
            is_gift: Some(false),
            gifter_display_name: Some("GiftGiver".to_string()),
            message: Some("Missing subscription scope".to_string()),
        },
        sub_age: UserCardSubAgeField {
            status: UserCardFieldStatus::Unavailable,
            months: None,
            message: Some("No subscription data".to_string()),
        },
    };
    assert_eq!(serde_json::to_value(&response)?, response_json);
    assert_eq!(
        serde_json::from_value::<UserCardMetadataResponse>(response_json)?,
        response
    );

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

fn sample_user_card_message(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "platform": "twitch",
        "channelId": "twitch_channel_1",
        "author": {
            "id": "twitch_user_123",
            "username": "testviewer",
            "displayName": "TestViewer",
            "badges": []
        },
        "text": format!("history message {id}"),
        "emotes": [],
        "timestamp": "1700000004",
        "type": "message"
    })
}

fn sample_user_card_message_value(
    id: &str,
) -> Result<NormalizedChatMessage, Box<dyn std::error::Error>> {
    Ok(serde_json::from_value(sample_user_card_message(id))?)
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
