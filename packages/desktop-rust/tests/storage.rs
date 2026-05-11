use serde_json::json;
use std::fs;
use std::path::PathBuf;
use twirchat_desktop_rust::protocol::types::{LayoutNode, PanelContent, Platform};
use twirchat_desktop_rust::storage::crypto;
use twirchat_desktop_rust::storage::{Storage, TokenState};

#[test]
fn storage_reads_vue_fixture_db() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join("healthy.sqlite");
    let storage = Storage::open(&db_path)?;
    load_sql_fixture(
        storage.connection(),
        "healthy.sql",
        &[
            ("{{ACCESS_TOKEN}}", &crypto::encrypt("access-token")?),
            ("{{REFRESH_TOKEN}}", &crypto::encrypt("refresh-token")?),
        ],
    )?;

    let accounts = storage.accounts().find_all_with_token_state()?;
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].account.display_name, "Fixture Streamer");
    match &accounts[0].token_state {
        TokenState::Valid(tokens) => {
            assert_eq!(tokens.access_token, "access-token");
            assert_eq!(tokens.refresh_token.as_deref(), Some("refresh-token"));
        }
        TokenState::ReauthRequired { reason } => {
            return Err(format!("expected valid fixture token, got {reason}").into());
        }
    }

    let secret = storage.client_identity().get_client_secret()?;
    assert_eq!(secret, "fixture-client-secret");

    let settings = storage.settings().get_app_settings()?;
    assert_eq!(
        settings.theme,
        twirchat_desktop_rust::protocol::types::AppTheme::Light
    );
    assert_eq!(settings.overlay.max_messages, 5);
    assert_eq!(settings.overlay.port, 45823);
    assert_eq!(settings.hotkeys.new_tab, "ctrl+n");
    assert_eq!(settings.hotkeys.next_tab, "ctrl+tab");

    let layout = storage.settings().get_chat_layout()?;
    assert_eq!(
        layout.mode,
        twirchat_desktop_rust::protocol::types::ChatLayoutMode::Split
    );
    assert_eq!(layout.splits.len(), 1);

    assert_eq!(
        storage.settings().get_tab_channel_ids()?,
        Some(vec!["wc-twitch".into(), "wc-kick".into()])
    );

    let watched_layout = storage.watched_layout().get("wc-twitch")?;
    match watched_layout.root {
        LayoutNode::Panel { content, .. } => match content {
            PanelContent::Watched { channel_id } => assert_eq!(channel_id, "wc-twitch"),
            other => return Err(format!("expected sanitized watched panel, got {other:?}").into()),
        },
        other => return Err(format!("expected panel root, got {other:?}").into()),
    }

    assert_eq!(storage.watched_channels().find_all()?.len(), 2);
    assert_eq!(
        storage
            .channels()
            .find_all()?
            .get(&Platform::Twitch)
            .cloned(),
        Some(vec!["fixturestreamer".into()])
    );
    assert_eq!(
        storage.user_aliases().find_all()?[0].alias,
        "Friendly Alias"
    );

    let recent = storage.messages().get_recent(Some(10))?;
    assert_eq!(recent.len(), 2, "malformed message JSON should be skipped");
    assert_eq!(recent[0].id, "msg-old");
    assert_eq!(recent[1].id, "msg-new");

    let history = storage
        .messages()
        .get_by_user(Platform::Twitch, "user-1", Some(1), None)?;
    assert!(history.has_more);
    assert_eq!(history.messages.len(), 1);
    assert_eq!(history.messages[0].id, "msg-new");
    assert_eq!(
        history
            .next_cursor
            .as_ref()
            .map(|cursor| cursor.id.as_str()),
        Some("msg-new")
    );

    write_evidence(
        "task-5-storage-compat.json",
        &json!({
            "accounts": accounts.len(),
            "settingsOverlayMaxMessages": settings.overlay.max_messages,
            "watchedChannels": 2,
            "recentMessagesAfterSkippingMalformedJson": recent.len(),
            "historyHasCursor": history.next_cursor.is_some()
        }),
    )?;

    Ok(())
}

#[test]
fn storage_corrupt_db_recovers_safely() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join("corrupt.sqlite");
    fs::copy(fixture_path("corrupt-not-sqlite.bin"), &db_path)?;

    let storage = Storage::open_or_recover(&db_path)?;
    assert!(db_path.exists());
    assert!(db_path.with_extension("corrupt").exists());
    assert!(storage.accounts().find_all()?.is_empty());
    assert_eq!(storage.settings().get_app_settings()?.overlay.port, 45823);

    Ok(())
}

#[test]
fn storage_corrupt_token_requires_reauth() -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join("corrupt-token.sqlite");
    let storage = Storage::open(&db_path)?;
    load_sql_fixture(storage.connection(), "corrupt-token.sql", &[])?;

    let accounts = storage.accounts().find_all_with_token_state()?;
    assert_eq!(accounts.len(), 1, "account row must be preserved");
    let reason = match &accounts[0].token_state {
        TokenState::ReauthRequired { reason } => reason.clone(),
        TokenState::Valid(_) => return Err("corrupt token should require reauth".into()),
    };
    assert_eq!(accounts[0].account.platform, Platform::Youtube);

    write_evidence(
        "task-5-token-error.json",
        &json!({
            "accountPreserved": accounts[0].account.id,
            "tokenState": "reauth_required",
            "reason": reason
        }),
    )?;

    Ok(())
}

fn load_sql_fixture(
    conn: &twirchat_desktop_rust::storage::db::Connection,
    name: &str,
    replacements: &[(&str, &str)],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut sql = fs::read_to_string(fixture_path(name))?;
    for (from, to) in replacements {
        sql = sql.replace(from, to);
    }
    conn.execute_batch(&sql)?;
    Ok(())
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/db")
        .join(name)
}

fn write_evidence(name: &str, value: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.sisyphus/evidence")
        .join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}
