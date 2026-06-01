use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;
use twirchat::protocol::messages::{
    UserCardFieldStatus, UserCardMetadataPlatform, UserCardMetadataRequest,
};
use twirchat::protocol::rpc::OpenExternalUrlParams;
use twirchat::runtime::browser::{ExternalOpenError, open_external_url};
use twirchat::runtime::{
    AppRuntime, AvailableUpdate, ExternalOpenResult, ExternalOpener, RuntimeConfig,
    RuntimeConfigInput, STARTUP_UPDATE_NO_UPDATE_DISMISS_AFTER, UpdateCheckMode,
    UpdateCheckRequest, UpdateCheckSource, UpdateEngine, UpdateEngineError, UpdateEvent,
    UpdateRuntime, UpdateState, UpdateStatus, default_update_feed_url,
};
use twirchat::services::commands::UpdateStateCommand;

#[test]
fn runtime_update_state_transitions() -> Result<(), Box<dyn std::error::Error>> {
    let mut runtime = UpdateRuntime::new(UpdateState::default());
    let checking = runtime
        .dispatch(UpdateEvent::Command(UpdateStateCommand::CheckForUpdates {
            source: UpdateCheckSource::Startup,
        }))
        .ok_or("checking payload missing")?;
    assert_eq!(checking.status, "checking");

    let available = runtime
        .dispatch(UpdateEvent::UpdateAvailable {
            version: Some("1.2.3".to_string()),
            hash: Some("hash-123".to_string()),
        })
        .ok_or("available payload missing")?;
    assert_eq!(available.status, "update-available");
    assert_eq!(available.hash.as_deref(), Some("hash-123"));

    let progress = runtime
        .dispatch(UpdateEvent::Status {
            status: UpdateStatus::DownloadProgress,
            message: "Downloading update".to_string(),
            progress: Some(42.0),
            hash: None,
        })
        .ok_or("progress payload missing")?;
    assert_eq!(progress.status, "download-progress");
    assert_eq!(progress.progress, Some(42.0));

    let complete = runtime
        .dispatch(UpdateEvent::Status {
            status: UpdateStatus::DownloadComplete,
            message: "Download complete".to_string(),
            progress: Some(100.0),
            hash: Some("hash-123".to_string()),
        })
        .ok_or("download complete payload missing")?;
    assert_eq!(complete.status, "download-complete");

    assert!(
        runtime
            .dispatch(UpdateEvent::Command(UpdateStateCommand::SkipUpdate {
                hash: "hash-123".to_string(),
            }))
            .is_none()
    );
    assert!(
        runtime
            .dispatch(UpdateEvent::UpdateAvailable {
                version: Some("1.2.3".to_string()),
                hash: Some("hash-123".to_string()),
            })
            .is_none()
    );

    let explicit = PathBuf::from("/tmp/explicit-twirchat.sqlite");
    let config = RuntimeConfig::new_with_env(
        RuntimeConfigInput {
            backend_url: Some("http://backend.local".to_string()),
            backend_ws_url: Some("ws://backend.local/ws".to_string()),
            node_env: Some("development".to_string()),
            db_path: Some(explicit.clone()),
            client_secret: Some("secret".to_string()),
        },
        Some(PathBuf::from("/tmp/env.sqlite")),
    );
    assert_eq!(config.backend_url(), "http://backend.local");
    assert_eq!(config.backend_ws_url(), "ws://backend.local/ws");
    assert_eq!(config.db_path(), &explicit);
    assert_eq!(
        config
            .backend_request("/api/user-card-metadata")
            .headers
            .get("X-Client-Secret")
            .map(String::as_str),
        Some("secret")
    );

    write_evidence(
        "task-15-update-state.json",
        &json!({
            "checking": checking,
            "available": available,
            "progress": progress,
            "complete": complete,
            "snapshot": runtime.state().snapshot(),
            "config": {
                "backendUrl": config.backend_url(),
                "backendWsUrl": config.backend_ws_url(),
                "nodeEnv": config.node_env(),
                "dbPath": config.db_path(),
                "clientSecretHeader": config.backend_request("/health").headers.get("X-Client-Secret"),
            }
        }),
    )?;

    Ok(())
}

#[test]
fn runtime_update_service_commands_use_engine() -> Result<(), Box<dyn std::error::Error>> {
    let mut runtime = UpdateRuntime::with_engine(
        UpdateState::default(),
        twirchat::runtime::UpdateCheckRequest::packaged(Some(
            "https://updates.example/releases.linux.json".to_string(),
        )),
        Arc::new(MockUpdateEngine),
    );

    runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
        source: UpdateCheckSource::Startup,
    });
    assert_eq!(
        runtime.snapshot().status.as_deref(),
        Some("update-available")
    );
    assert_eq!(runtime.snapshot().hash.as_deref(), Some("hash-abc"));

    runtime.dispatch_command(UpdateStateCommand::DownloadUpdate);
    assert_eq!(
        runtime.snapshot().status.as_deref(),
        Some("download-complete")
    );

    runtime.dispatch_command(UpdateStateCommand::SkipUpdate {
        hash: "hash-abc".to_string(),
    });
    runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
        source: UpdateCheckSource::Periodic,
    });
    assert_eq!(
        runtime.snapshot().status.as_deref(),
        Some("download-complete")
    );

    runtime.dispatch_command(UpdateStateCommand::ApplyUpdate);
    assert_eq!(runtime.snapshot().status.as_deref(), Some("complete"));

    Ok(())
}

#[test]
fn startup_no_update_is_visible_and_auto_dismissable() {
    let mut runtime = UpdateRuntime::with_engine(
        UpdateState::default(),
        UpdateCheckRequest::packaged(Some(
            "https://updates.example/releases.linux.json".to_string(),
        )),
        Arc::new(NoUpdateEngine),
    );

    runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
        source: UpdateCheckSource::Startup,
    });

    let snapshot = runtime.snapshot();
    assert!(snapshot.show);
    assert_eq!(snapshot.status.as_deref(), Some("no-update"));
    assert_eq!(
        snapshot.auto_dismiss_after_ms,
        Some(STARTUP_UPDATE_NO_UPDATE_DISMISS_AFTER.as_millis() as u64)
    );
}

#[test]
fn periodic_no_update_stays_hidden_without_replacing_actionable_toast() {
    let mut runtime = UpdateRuntime::with_engine(
        UpdateState::default(),
        UpdateCheckRequest::packaged(Some(
            "https://updates.example/releases.linux.json".to_string(),
        )),
        Arc::new(NoUpdateEngine),
    );

    runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
        source: UpdateCheckSource::Periodic,
    });
    assert!(!runtime.snapshot().show);
    assert!(runtime.snapshot().status.is_none());

    let _ = runtime.dispatch(UpdateEvent::UpdateAvailable {
        version: Some("1.2.3".to_string()),
        hash: Some("hash-abc".to_string()),
    });
    runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
        source: UpdateCheckSource::Periodic,
    });

    let snapshot = runtime.snapshot();
    assert!(snapshot.show);
    assert_eq!(snapshot.status.as_deref(), Some("update-available"));
    assert_eq!(snapshot.auto_dismiss_after_ms, None);
}

#[test]
fn update_available_and_download_states_do_not_auto_dismiss() {
    let mut runtime = UpdateRuntime::new(UpdateState::default());

    let _ = runtime.dispatch(UpdateEvent::UpdateAvailable {
        version: Some("1.2.3".to_string()),
        hash: Some("hash-abc".to_string()),
    });
    assert_eq!(runtime.snapshot().auto_dismiss_after_ms, None);

    let _ = runtime.dispatch(UpdateEvent::Status {
        status: UpdateStatus::DownloadComplete,
        message: "Download complete".to_string(),
        progress: Some(100.0),
        hash: Some("hash-abc".to_string()),
    });
    assert_eq!(runtime.snapshot().auto_dismiss_after_ms, None);
}

#[test]
fn runtime_default_feed_points_to_platform_stable_velopack_feed() {
    let feed = default_update_feed_url();
    let expected_channel = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };

    assert_eq!(
        feed,
        format!(
            "https://github.com/Satont/twirchat/releases/latest/download/releases.{expected_channel}.json"
        )
    );
}

#[test]
fn runtime_default_feed_channel_parsing_stays_compatible() {
    let feed = default_update_feed_url();
    let request = UpdateCheckRequest {
        mode: UpdateCheckMode::Unpackaged,
        feed: Some(feed),
    };

    let mut runtime = UpdateRuntime::new(UpdateState::default());
    let report = runtime.check_for_updates(&request);
    let expected_channel = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };

    assert_eq!(report.channel.as_deref(), Some(expected_channel));
}

#[test]
fn runtime_open_external_failure_reports_error() -> Result<(), Box<dyn std::error::Error>> {
    let invalid_url = OpenExternalUrlParams {
        url: "not a url".to_string(),
    };
    let invalid_error = open_external_url(&FailingOpener, &invalid_url)
        .err()
        .ok_or("invalid URL unexpectedly opened")?;
    assert!(matches!(
        invalid_error,
        ExternalOpenError::InvalidUrl { .. }
    ));

    let valid_url = OpenExternalUrlParams {
        url: "https://twir.app/docs".to_string(),
    };
    let open_error = open_external_url(&FailingOpener, &valid_url)
        .err()
        .ok_or("failing opener unexpectedly succeeded")?;
    assert_eq!(
        open_error,
        ExternalOpenError::OpenFailed {
            url: valid_url.url.clone(),
            message: "fake opener failure".to_string(),
        }
    );

    write_evidence(
        "task-15-open-external-error.json",
        &json!({
            "invalid": invalid_error.to_string(),
            "openFailure": open_error.to_string(),
            "url": valid_url.url,
        }),
    )?;

    Ok(())
}

#[test]
fn app_runtime_user_card_loader_sends_persisted_client_secret()
-> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join("runtime-user-card-secret.sqlite");
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let backend_url = format!("http://{}", listener.local_addr()?);
    let (secret_tx, secret_rx) = mpsc::channel();

    let server = std::thread::spawn(move || -> std::io::Result<()> {
        let (mut stream, _) = listener.accept()?;
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut client_secret = None;
        let mut content_length = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line)?;
            let header = line.trim_end_matches(['\r', '\n']);
            if header.is_empty() {
                break;
            }
            if let Some((name, value)) = header.split_once(':') {
                if name.eq_ignore_ascii_case("x-client-secret") {
                    client_secret = Some(value.trim().to_string());
                } else if name.eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse().unwrap_or_default();
                }
            }
        }
        if content_length > 0 {
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body)?;
        }
        secret_tx
            .send(client_secret)
            .map_err(std::io::Error::other)?;

        let response_body = json!({
            "platform": "kick",
            "platformUserId": "viewer-1",
            "fetchedAt": 1,
            "accountAge": { "status": "unsupported", "createdAt": null },
            "followAge": { "status": "unsupported", "followedAt": null },
            "subscriptionDuration": {
                "status": "unsupported",
                "currentlySubscribed": null
            },
            "subAge": { "status": "unsupported", "months": null }
        })
        .to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        )?;
        Ok(())
    });

    let runtime = AppRuntime::start(RuntimeConfigInput {
        backend_url: Some(backend_url),
        backend_ws_url: Some("ws://127.0.0.1:9/ws".to_string()),
        db_path: Some(db_path),
        ..Default::default()
    })?;
    let persisted_secret = runtime.storage().client_identity().get_client_secret()?;
    assert_eq!(runtime.config().client_secret(), persisted_secret);

    let response =
        runtime
            .user_card_loader()
            .fetch_user_card_metadata(UserCardMetadataRequest {
                platform: UserCardMetadataPlatform::Kick,
                platform_user_id: "viewer-1".to_string(),
                username: Some("viewer".to_string()),
                channel_id: Some("channel-1".to_string()),
                channel_slug: Some("channel".to_string()),
            })?;

    assert_eq!(response.platform, UserCardMetadataPlatform::Kick);
    assert_eq!(
        response.account_age.status,
        UserCardFieldStatus::Unsupported
    );
    assert_eq!(
        secret_rx.recv_timeout(Duration::from_secs(5))?,
        Some(persisted_secret)
    );
    server
        .join()
        .map_err(|_| "metadata test server panicked")??;

    Ok(())
}

struct FailingOpener;

struct MockUpdateEngine;

struct NoUpdateEngine;

impl UpdateEngine for NoUpdateEngine {
    fn check(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        Ok(None)
    }

    fn download(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        Ok(None)
    }

    fn apply(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<(), UpdateEngineError> {
        Ok(())
    }
}

impl UpdateEngine for MockUpdateEngine {
    fn check(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        Ok(Some(AvailableUpdate {
            version: Some("1.2.3".to_string()),
            hash: Some("hash-abc".to_string()),
        }))
    }

    fn download(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        Ok(Some(AvailableUpdate {
            version: Some("1.2.3".to_string()),
            hash: Some("hash-abc".to_string()),
        }))
    }

    fn apply(
        &self,
        _request: &twirchat::runtime::UpdateCheckRequest,
    ) -> Result<(), UpdateEngineError> {
        Ok(())
    }
}

impl ExternalOpener for FailingOpener {
    fn open_external(&self, params: &OpenExternalUrlParams) -> ExternalOpenResult<()> {
        Err(ExternalOpenError::OpenFailed {
            url: params.url.clone(),
            message: "fake opener failure".to_string(),
        })
    }
}

fn write_evidence(name: &str, value: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let path = workspace_root().join(".sisyphus").join("evidence");
    fs::create_dir_all(&path)?;
    fs::write(path.join(name), serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
}
