use crate::protocol::rpc::UpdateStatusPayload;
use crate::protocol::types::AppSettings;
use crate::runtime::packaging::TwirChatPackagingSpec;
use crate::services::commands::{UpdateCheckSource, UpdateStateCommand};
use crate::services::events::UpdateStateEvent;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use velopack::{UpdateCheck, UpdateManager, UpdateOptions, VelopackApp, sources::HttpSource};

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(60);
pub const STARTUP_UPDATE_NO_UPDATE_DISMISS_AFTER: Duration = Duration::from_secs(3);

pub fn run_velopack_startup() {
    VelopackApp::build().set_auto_apply_on_startup(true).run();
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCheckMode {
    Packaged,
    Unpackaged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateCheckRequest {
    pub mode: UpdateCheckMode,
    pub feed: Option<String>,
}

impl UpdateCheckRequest {
    pub fn packaged(feed: Option<String>) -> Self {
        Self {
            mode: UpdateCheckMode::Packaged,
            feed,
        }
    }

    pub fn unpackaged(feed: Option<String>) -> Self {
        Self {
            mode: UpdateCheckMode::Unpackaged,
            feed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VelopackRuntimeStatus {
    Packaged,
    Unpackaged,
    NoFeed,
    NoUpdate,
    UpdateAvailable,
    Offline,
    Error,
}

impl VelopackRuntimeStatus {
    pub fn is_recoverable(self) -> bool {
        matches!(
            self,
            Self::Unpackaged | Self::NoFeed | Self::NoUpdate | Self::Offline
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckReport {
    pub runtime_status: VelopackRuntimeStatus,
    pub update_status: String,
    pub message: String,
    pub feed: Option<String>,
    pub source_base: Option<String>,
    pub channel: Option<String>,
    pub current_version: Option<String>,
    pub available_version: Option<String>,
    pub package_id: Option<String>,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateStatus {
    Checking,
    UpdateAvailable,
    DownloadComplete,
    NoUpdate,
    Error,
    Applying,
    Extracting,
    ReplacingApp,
    LaunchingNewVersion,
    Complete,
    DownloadStarting,
    CheckingLocalTar,
    LocalTarFound,
    LocalTarMissing,
    FetchingPatch,
    PatchFound,
    PatchNotFound,
    DownloadingPatch,
    ApplyingPatch,
    PatchApplied,
    ExtractingVersion,
    PatchChainComplete,
    DownloadingFullBundle,
    DownloadProgress,
    Decompressing,
}

impl UpdateStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Checking => "checking",
            Self::UpdateAvailable => "update-available",
            Self::DownloadComplete => "download-complete",
            Self::NoUpdate => "no-update",
            Self::Error => "error",
            Self::Applying => "applying",
            Self::Extracting => "extracting",
            Self::ReplacingApp => "replacing-app",
            Self::LaunchingNewVersion => "launching-new-version",
            Self::Complete => "complete",
            Self::DownloadStarting => "download-starting",
            Self::CheckingLocalTar => "checking-local-tar",
            Self::LocalTarFound => "local-tar-found",
            Self::LocalTarMissing => "local-tar-missing",
            Self::FetchingPatch => "fetching-patch",
            Self::PatchFound => "patch-found",
            Self::PatchNotFound => "patch-not-found",
            Self::DownloadingPatch => "downloading-patch",
            Self::ApplyingPatch => "applying-patch",
            Self::PatchApplied => "patch-applied",
            Self::ExtractingVersion => "extracting-version",
            Self::PatchChainComplete => "patch-chain-complete",
            Self::DownloadingFullBundle => "downloading-full-bundle",
            Self::DownloadProgress => "download-progress",
            Self::Decompressing => "decompressing",
        }
    }

    pub fn is_download_progress_family(self) -> bool {
        matches!(
            self,
            Self::DownloadStarting
                | Self::CheckingLocalTar
                | Self::LocalTarFound
                | Self::LocalTarMissing
                | Self::FetchingPatch
                | Self::PatchFound
                | Self::PatchNotFound
                | Self::DownloadingPatch
                | Self::ApplyingPatch
                | Self::PatchApplied
                | Self::ExtractingVersion
                | Self::PatchChainComplete
                | Self::DownloadingFullBundle
                | Self::DownloadProgress
                | Self::Decompressing
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum UpdateEvent {
    Command(UpdateStateCommand),
    ServiceEvent(UpdateStateEvent),
    Status {
        status: UpdateStatus,
        message: String,
        progress: Option<f64>,
        hash: Option<String>,
    },
    UpdateAvailable {
        version: Option<String>,
        hash: Option<String>,
    },
    NoUpdate {
        source: UpdateCheckSource,
        message: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableUpdate {
    pub version: Option<String>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UpdateEngineError {
    Offline(String),
    Failed(String),
}

pub trait UpdateEngine: Send + Sync {
    fn check(
        &self,
        request: &UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError>;
    fn download(
        &self,
        request: &UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError>;
    fn apply(&self, request: &UpdateCheckRequest) -> Result<(), UpdateEngineError>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusSnapshot {
    pub show: bool,
    pub status: Option<String>,
    pub message: String,
    pub progress: Option<f64>,
    pub hash: Option<String>,
    pub skipped_hash: Option<String>,
    pub auto_check_updates: bool,
    pub auto_dismiss_after_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateState {
    show: bool,
    status: Option<UpdateStatus>,
    message: String,
    progress: Option<f64>,
    hash: Option<String>,
    skipped_hash: Option<String>,
    auto_check_updates: bool,
    auto_dismiss_after_ms: Option<u64>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            show: false,
            status: None,
            message: String::new(),
            progress: None,
            hash: None,
            skipped_hash: None,
            auto_check_updates: true,
            auto_dismiss_after_ms: None,
        }
    }
}

fn stable_skip_identifier(version: Option<&str>, hash: Option<String>) -> Option<String> {
    hash.filter(|hash| !hash.trim().is_empty()).or_else(|| {
        version
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .map(ToOwned::to_owned)
    })
}

impl UpdateState {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            auto_check_updates: settings.auto_check_updates.unwrap_or(true),
            ..Self::default()
        }
    }

    pub fn apply(&mut self, event: UpdateEvent) -> Option<UpdateStatusPayload> {
        match event {
            UpdateEvent::Command(command) => self.apply_command(command),
            UpdateEvent::ServiceEvent(event) => self.apply_service_event(event),
            UpdateEvent::Status {
                status,
                message,
                progress,
                hash,
            } => self.apply_status(status, message, progress, hash),
            UpdateEvent::UpdateAvailable { version, hash } => {
                let stable_hash = stable_skip_identifier(version.as_deref(), hash);
                if stable_hash
                    .as_ref()
                    .is_some_and(|hash| self.is_hash_skipped(hash))
                {
                    return None;
                }
                let message = version.as_deref().map_or_else(
                    || "Update available".to_string(),
                    |version| format!("Update available: {version}"),
                );
                self.apply_status(UpdateStatus::UpdateAvailable, message, None, stable_hash)
            }
            UpdateEvent::NoUpdate { source, message } => self.apply_no_update(source, message),
            UpdateEvent::Error { message } => {
                self.apply_status(UpdateStatus::Error, message, None, None)
            }
        }
    }

    pub fn payload(&self) -> Option<UpdateStatusPayload> {
        self.status.map(|status| UpdateStatusPayload {
            status: status.as_str().to_string(),
            message: self.message.clone(),
            progress: self.progress,
            hash: self.hash.clone(),
        })
    }

    pub fn snapshot(&self) -> UpdateStatusSnapshot {
        UpdateStatusSnapshot {
            show: self.show,
            status: self.status.map(|status| status.as_str().to_string()),
            message: self.message.clone(),
            progress: self.progress,
            hash: self.hash.clone(),
            skipped_hash: self.skipped_hash.clone(),
            auto_check_updates: self.auto_check_updates,
            auto_dismiss_after_ms: self.auto_dismiss_after_ms,
        }
    }

    pub fn is_hash_skipped(&self, hash: &str) -> bool {
        self.skipped_hash.as_deref() == Some(hash)
    }

    fn apply_command(&mut self, command: UpdateStateCommand) -> Option<UpdateStatusPayload> {
        match command {
            UpdateStateCommand::CheckForUpdates { source } => self.apply_check_requested(source),
            UpdateStateCommand::DownloadUpdate => self.apply_status(
                UpdateStatus::DownloadStarting,
                "Starting update download...".to_string(),
                None,
                None,
            ),
            UpdateStateCommand::ApplyUpdate => self.apply_status(
                UpdateStatus::Applying,
                "Applying update...".to_string(),
                None,
                self.hash.clone(),
            ),
            UpdateStateCommand::SkipUpdate { hash } => {
                self.skipped_hash = Some(hash.clone());
                self.hash = Some(hash);
                self.show = false;
                None
            }
        }
    }

    fn apply_service_event(&mut self, event: UpdateStateEvent) -> Option<UpdateStatusPayload> {
        match event {
            UpdateStateEvent::CheckRequested { source } => {
                self.apply_command(UpdateStateCommand::CheckForUpdates { source })
            }
            UpdateStateEvent::DownloadRequested => {
                self.apply_command(UpdateStateCommand::DownloadUpdate)
            }
            UpdateStateEvent::ApplyRequested => self.apply_command(UpdateStateCommand::ApplyUpdate),
            UpdateStateEvent::SkipRequested { hash } => {
                self.apply_command(UpdateStateCommand::SkipUpdate { hash })
            }
            UpdateStateEvent::StateChanged { .. } => None,
        }
    }

    fn apply_check_requested(&mut self, source: UpdateCheckSource) -> Option<UpdateStatusPayload> {
        match source {
            UpdateCheckSource::Startup => self.apply_status(
                UpdateStatus::Checking,
                "Checking for updates...".to_string(),
                None,
                None,
            ),
            UpdateCheckSource::Periodic => None,
        }
    }

    fn apply_no_update(
        &mut self,
        source: UpdateCheckSource,
        message: String,
    ) -> Option<UpdateStatusPayload> {
        match source {
            UpdateCheckSource::Startup => {
                let payload = self.apply_status(UpdateStatus::NoUpdate, message, None, None);
                self.auto_dismiss_after_ms =
                    Some(STARTUP_UPDATE_NO_UPDATE_DISMISS_AFTER.as_millis() as u64);
                payload
            }
            UpdateCheckSource::Periodic => None,
        }
    }

    fn apply_status(
        &mut self,
        status: UpdateStatus,
        message: String,
        progress: Option<f64>,
        hash: Option<String>,
    ) -> Option<UpdateStatusPayload> {
        self.auto_dismiss_after_ms = None;
        self.show = should_show_status(status);
        self.status = Some(status);
        self.message = message;
        self.progress = progress;
        if hash.is_some() {
            self.hash = hash;
        }
        self.payload()
    }
}

#[derive(Clone)]
pub struct UpdateRuntime {
    state: UpdateState,
    request: UpdateCheckRequest,
    engine: Arc<dyn UpdateEngine>,
    available_update: Option<AvailableUpdate>,
}

impl Default for UpdateRuntime {
    fn default() -> Self {
        Self::new(UpdateState::default())
    }
}

impl UpdateRuntime {
    pub fn new(state: UpdateState) -> Self {
        let request = UpdateCheckRequest::packaged(Some(default_update_feed_url()));
        Self::with_engine(state, request, Arc::new(VelopackUpdateEngine))
    }

    pub fn with_engine(
        state: UpdateState,
        request: UpdateCheckRequest,
        engine: Arc<dyn UpdateEngine>,
    ) -> Self {
        Self {
            state,
            request,
            engine,
            available_update: None,
        }
    }

    pub fn dispatch(&mut self, event: UpdateEvent) -> Option<UpdateStatusPayload> {
        self.state.apply(event)
    }

    pub fn state(&self) -> &UpdateState {
        &self.state
    }

    pub fn check_for_updates(&mut self, request: &UpdateCheckRequest) -> UpdateCheckReport {
        let report = check_velopack_updates(request);
        let event = report.to_event(UpdateCheckSource::Startup);
        let _ = self.dispatch(event);
        report
    }

    pub fn dispatch_command(&mut self, command: UpdateStateCommand) {
        let _ = self.dispatch(UpdateEvent::Command(command.clone()));
        match command {
            UpdateStateCommand::CheckForUpdates { source } => self.run_check(source),
            UpdateStateCommand::DownloadUpdate => self.run_download(),
            UpdateStateCommand::ApplyUpdate => self.run_apply(),
            UpdateStateCommand::SkipUpdate { .. } => {}
        }
    }

    pub fn snapshot(&self) -> UpdateStatusSnapshot {
        self.state.snapshot()
    }

    fn run_check(&mut self, source: UpdateCheckSource) {
        match self.engine.check(&self.request) {
            Ok(Some(update)) => {
                let stable_hash = stable_skip_identifier(update.version.as_deref(), update.hash);
                self.available_update = Some(AvailableUpdate {
                    version: update.version.clone(),
                    hash: stable_hash.clone(),
                });
                let _ = self.dispatch(UpdateEvent::UpdateAvailable {
                    version: update.version,
                    hash: stable_hash,
                });
            }
            Ok(None) => {
                self.available_update = None;
                let _ = self.dispatch(UpdateEvent::NoUpdate {
                    source,
                    message: "No updates available".to_string(),
                });
            }
            Err(UpdateEngineError::Offline(message)) | Err(UpdateEngineError::Failed(message)) => {
                let _ = self.dispatch(UpdateEvent::Error { message });
            }
        }
    }

    fn run_download(&mut self) {
        match self.engine.download(&self.request) {
            Ok(Some(update)) => {
                let stable_hash = stable_skip_identifier(update.version.as_deref(), update.hash);
                self.available_update = Some(AvailableUpdate {
                    version: update.version,
                    hash: stable_hash.clone(),
                });
                let _ = self.dispatch(UpdateEvent::Status {
                    status: UpdateStatus::DownloadComplete,
                    message: "Download complete".to_string(),
                    progress: Some(100.0),
                    hash: stable_hash,
                });
            }
            Ok(None) => {
                let _ = self.dispatch(UpdateEvent::NoUpdate {
                    source: UpdateCheckSource::Startup,
                    message: "No updates available".to_string(),
                });
            }
            Err(UpdateEngineError::Offline(message)) | Err(UpdateEngineError::Failed(message)) => {
                let _ = self.dispatch(UpdateEvent::Error { message });
            }
        }
    }

    fn run_apply(&mut self) {
        match self.engine.apply(&self.request) {
            Ok(()) => {
                let _ = self.dispatch(UpdateEvent::Status {
                    status: UpdateStatus::Complete,
                    message: "Update applied. Restarting...".to_string(),
                    progress: Some(100.0),
                    hash: self
                        .available_update
                        .as_ref()
                        .and_then(|update| update.hash.clone()),
                });
            }
            Err(UpdateEngineError::Offline(message)) | Err(UpdateEngineError::Failed(message)) => {
                let _ = self.dispatch(UpdateEvent::Error { message });
            }
        }
    }
}

pub fn default_update_feed_url() -> String {
    format!(
        "{}releases.{}.json",
        TwirChatPackagingSpec::APP.release_base_url,
        default_update_channel()
    )
}

#[derive(Debug, Clone, Copy, Default)]
pub struct VelopackUpdateEngine;

impl UpdateEngine for VelopackUpdateEngine {
    fn check(
        &self,
        request: &UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        let report = check_velopack_updates(request);
        match report.runtime_status {
            VelopackRuntimeStatus::UpdateAvailable => {
                let version = report.available_version;
                let hash = stable_skip_identifier(version.as_deref(), None);
                Ok(Some(AvailableUpdate { version, hash }))
            }
            VelopackRuntimeStatus::NoUpdate
            | VelopackRuntimeStatus::NoFeed
            | VelopackRuntimeStatus::Unpackaged => Ok(None),
            VelopackRuntimeStatus::Offline => Err(UpdateEngineError::Offline(report.message)),
            VelopackRuntimeStatus::Error | VelopackRuntimeStatus::Packaged => {
                Err(UpdateEngineError::Failed(report.message))
            }
        }
    }

    fn download(
        &self,
        request: &UpdateCheckRequest,
    ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
        let manager = create_manager(request)?;
        match manager.check_for_updates() {
            Ok(UpdateCheck::UpdateAvailable(update)) => {
                manager.download_updates(&update, None).map_err(|error| {
                    UpdateEngineError::Failed(format!("Update download failed: {error}"))
                })?;
                let version = Some(update.TargetFullRelease.Version);
                let hash = stable_skip_identifier(version.as_deref(), None);
                Ok(Some(AvailableUpdate { version, hash }))
            }
            Ok(UpdateCheck::NoUpdateAvailable | UpdateCheck::RemoteIsEmpty) => Ok(None),
            Err(error) if is_offline_error(&error) => Err(UpdateEngineError::Offline(format!(
                "Update download could not reach feed: {error}"
            ))),
            Err(error) => Err(UpdateEngineError::Failed(format!(
                "Update download failed: {error}"
            ))),
        }
    }

    fn apply(&self, request: &UpdateCheckRequest) -> Result<(), UpdateEngineError> {
        let manager = create_manager(request)?;
        match manager.check_for_updates() {
            Ok(UpdateCheck::UpdateAvailable(update)) => {
                manager.apply_updates_and_restart(&update).map_err(|error| {
                    UpdateEngineError::Failed(format!("Update apply failed: {error}"))
                })
            }
            Ok(UpdateCheck::NoUpdateAvailable | UpdateCheck::RemoteIsEmpty) => Ok(()),
            Err(error) if is_offline_error(&error) => Err(UpdateEngineError::Offline(format!(
                "Update apply could not reach feed: {error}"
            ))),
            Err(error) => Err(UpdateEngineError::Failed(format!(
                "Update apply failed: {error}"
            ))),
        }
    }
}

fn create_manager(request: &UpdateCheckRequest) -> Result<UpdateManager, UpdateEngineError> {
    if request.mode == UpdateCheckMode::Unpackaged {
        return Err(UpdateEngineError::Failed(
            "Update action skipped: application is not packaged by Velopack".to_string(),
        ));
    }
    let Some(feed) = request
        .feed
        .as_deref()
        .filter(|feed| !feed.trim().is_empty())
    else {
        return Err(UpdateEngineError::Failed(
            "Update action skipped: no Velopack feed configured".to_string(),
        ));
    };
    let source_base = update_source_base(feed);
    let channel = update_channel_from_feed(feed);
    eprintln!(
        "[update] preparing update action mode={:?} source_base={} channel={} feed={}",
        request.mode, source_base, channel, feed
    );
    let source = HttpSource::new(&source_base);
    let options = UpdateOptions {
        ExplicitChannel: Some(channel.clone()),
        ..UpdateOptions::default()
    };
    UpdateManager::new(source, Some(options), None).map_err(|error| {
        if is_not_installed_error(&error) {
            UpdateEngineError::Failed(update_error_message(
                "Update action skipped",
                &error,
                feed,
                &source_base,
                &channel,
            ))
        } else {
            UpdateEngineError::Failed(update_error_message(
                "Update action unavailable",
                &error,
                feed,
                &source_base,
                &channel,
            ))
        }
    })
}

impl UpdateCheckReport {
    fn new(
        runtime_status: VelopackRuntimeStatus,
        update_status: UpdateStatus,
        message: String,
        request: &UpdateCheckRequest,
    ) -> Self {
        Self {
            runtime_status,
            update_status: update_status.as_str().to_string(),
            message,
            feed: request.feed.clone(),
            source_base: request.feed.as_deref().map(update_source_base),
            channel: request.feed.as_deref().map(update_channel_from_feed),
            current_version: None,
            available_version: None,
            package_id: None,
            recoverable: runtime_status.is_recoverable(),
        }
    }

    fn with_manager(mut self, manager: &UpdateManager) -> Self {
        self.current_version = Some(manager.get_current_version_as_string());
        self.package_id = Some(manager.get_app_id());
        self
    }

    fn with_available_version(mut self, version: String) -> Self {
        self.available_version = Some(version);
        self
    }

    fn to_event(&self, source: UpdateCheckSource) -> UpdateEvent {
        match self.runtime_status {
            VelopackRuntimeStatus::UpdateAvailable => UpdateEvent::UpdateAvailable {
                version: self.available_version.clone(),
                hash: stable_skip_identifier(self.available_version.as_deref(), None),
            },
            VelopackRuntimeStatus::Error | VelopackRuntimeStatus::Offline => UpdateEvent::Error {
                message: self.message.clone(),
            },
            _ => UpdateEvent::NoUpdate {
                source,
                message: self.message.clone(),
            },
        }
    }
}

fn check_velopack_updates(request: &UpdateCheckRequest) -> UpdateCheckReport {
    if request.mode == UpdateCheckMode::Unpackaged {
        return UpdateCheckReport::new(
            VelopackRuntimeStatus::Unpackaged,
            UpdateStatus::NoUpdate,
            "Update check skipped: application is not packaged by Velopack".to_string(),
            request,
        );
    }

    let Some(feed) = request
        .feed
        .as_deref()
        .filter(|feed| !feed.trim().is_empty())
    else {
        return UpdateCheckReport::new(
            VelopackRuntimeStatus::NoFeed,
            UpdateStatus::NoUpdate,
            "Update check skipped: no Velopack feed configured".to_string(),
            request,
        );
    };

    let source_base = update_source_base(feed);
    let channel = update_channel_from_feed(feed);
    eprintln!(
        "[update] checking for updates mode={:?} source_base={} channel={} feed={}",
        request.mode, source_base, channel, feed
    );
    let source = HttpSource::new(&source_base);
    let options = UpdateOptions {
        ExplicitChannel: Some(channel.clone()),
        ..UpdateOptions::default()
    };

    let manager = match UpdateManager::new(source, Some(options), None) {
        Ok(manager) => manager,
        Err(error) if is_not_installed_error(&error) => {
            return UpdateCheckReport::new(
                VelopackRuntimeStatus::Unpackaged,
                UpdateStatus::NoUpdate,
                update_error_message("Update check skipped", &error, feed, &source_base, &channel),
                request,
            );
        }
        Err(error) => {
            return UpdateCheckReport::new(
                VelopackRuntimeStatus::Error,
                UpdateStatus::Error,
                update_error_message(
                    "Update check unavailable",
                    &error,
                    feed,
                    &source_base,
                    &channel,
                ),
                request,
            );
        }
    };

    match manager.check_for_updates() {
        Ok(UpdateCheck::UpdateAvailable(update)) => UpdateCheckReport::new(
            VelopackRuntimeStatus::UpdateAvailable,
            UpdateStatus::UpdateAvailable,
            format!("Update available: {}", update.TargetFullRelease.Version),
            request,
        )
        .with_manager(&manager)
        .with_available_version(update.TargetFullRelease.Version),
        Ok(UpdateCheck::NoUpdateAvailable) => UpdateCheckReport::new(
            VelopackRuntimeStatus::NoUpdate,
            UpdateStatus::NoUpdate,
            "No updates available".to_string(),
            request,
        )
        .with_manager(&manager),
        Ok(UpdateCheck::RemoteIsEmpty) => UpdateCheckReport::new(
            VelopackRuntimeStatus::NoFeed,
            UpdateStatus::NoUpdate,
            "Update feed has no releases".to_string(),
            request,
        )
        .with_manager(&manager),
        Err(error) if is_offline_error(&error) => UpdateCheckReport::new(
            VelopackRuntimeStatus::Offline,
            UpdateStatus::Error,
            update_error_message(
                "Update check could not reach feed",
                &error,
                feed,
                &source_base,
                &channel,
            ),
            request,
        )
        .with_manager(&manager),
        Err(error) => UpdateCheckReport::new(
            VelopackRuntimeStatus::Error,
            UpdateStatus::Error,
            update_error_message("Update check failed", &error, feed, &source_base, &channel),
            request,
        )
        .with_manager(&manager),
    }
}

fn update_source_base(feed: &str) -> String {
    let trimmed = feed.trim().trim_end_matches('/');
    if !trimmed.contains("/releases.") || !trimmed.ends_with(".json") {
        return trimmed.to_string();
    }

    trimmed
        .rsplit_once('/')
        .map_or_else(|| trimmed.to_string(), |(base, _)| base.to_string())
}

fn update_feed_url(source_base: &str, channel: &str) -> String {
    format!(
        "{}/releases.{}.json",
        source_base.trim_end_matches('/'),
        channel
    )
}

fn update_error_message(
    prefix: &str,
    error: &velopack::Error,
    feed: &str,
    source_base: &str,
    channel: &str,
) -> String {
    format!(
        "{prefix}: {error}; feed={feed}; source_base={source_base}; channel={channel}; expected_feed={}",
        update_feed_url(source_base, channel)
    )
}

fn update_channel_from_feed(feed: &str) -> String {
    let Some(file_name) = feed.trim().trim_end_matches('/').rsplit('/').next() else {
        return default_update_channel().to_string();
    };
    let Some(channel) = file_name
        .strip_prefix("releases.")
        .and_then(|name| name.strip_suffix(".json"))
        .filter(|channel| !channel.is_empty())
    else {
        return default_update_channel().to_string();
    };

    channel.to_string()
}

fn default_update_channel() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn is_not_installed_error(error: &velopack::Error) -> bool {
    matches!(error, velopack::Error::NotInstalled(_))
}

fn is_offline_error(error: &velopack::Error) -> bool {
    matches!(error, velopack::Error::Network(_) | velopack::Error::Io(_))
}

fn should_show_status(status: UpdateStatus) -> bool {
    matches!(
        status,
        UpdateStatus::Checking
            | UpdateStatus::UpdateAvailable
            | UpdateStatus::DownloadComplete
            | UpdateStatus::NoUpdate
            | UpdateStatus::Error
            | UpdateStatus::Applying
            | UpdateStatus::Extracting
            | UpdateStatus::ReplacingApp
            | UpdateStatus::LaunchingNewVersion
            | UpdateStatus::Complete
    ) || status.is_download_progress_family()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Debug)]
    struct VersionOnlyEngine;

    impl UpdateEngine for VersionOnlyEngine {
        fn check(
            &self,
            _request: &UpdateCheckRequest,
        ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
            Ok(Some(AvailableUpdate {
                version: Some("1.2.3".to_string()),
                hash: None,
            }))
        }

        fn download(
            &self,
            _request: &UpdateCheckRequest,
        ) -> Result<Option<AvailableUpdate>, UpdateEngineError> {
            Ok(Some(AvailableUpdate {
                version: Some("1.2.3".to_string()),
                hash: None,
            }))
        }

        fn apply(&self, _request: &UpdateCheckRequest) -> Result<(), UpdateEngineError> {
            Ok(())
        }
    }

    #[test]
    fn update_available_uses_version_as_stable_skip_identifier_when_hash_missing() {
        let mut state = UpdateState::default();

        let payload = state.apply(UpdateEvent::UpdateAvailable {
            version: Some("1.2.3".to_string()),
            hash: None,
        });

        assert!(payload.is_some());
        assert!(state.snapshot().show);
        assert_eq!(state.snapshot().hash.as_deref(), Some("1.2.3"));

        let skipped_payload = state.apply(UpdateEvent::Command(UpdateStateCommand::SkipUpdate {
            hash: "1.2.3".to_string(),
        }));

        assert!(skipped_payload.is_none());
        assert!(!state.snapshot().show);
        assert_eq!(state.snapshot().skipped_hash.as_deref(), Some("1.2.3"));

        let repeated_payload = state.apply(UpdateEvent::UpdateAvailable {
            version: Some("1.2.3".to_string()),
            hash: None,
        });

        assert!(repeated_payload.is_none());
        assert!(!state.snapshot().show);
    }

    #[test]
    fn runtime_check_preserves_version_identifier_for_skip_and_download_complete() {
        let mut runtime = UpdateRuntime::with_engine(
            UpdateState::default(),
            UpdateCheckRequest::packaged(Some(
                "https://example.test/releases.linux.json".to_string(),
            )),
            Arc::new(VersionOnlyEngine),
        );

        runtime.dispatch_command(UpdateStateCommand::CheckForUpdates {
            source: UpdateCheckSource::Startup,
        });

        let checked = runtime.snapshot();
        assert_eq!(checked.status.as_deref(), Some("update-available"));
        assert_eq!(checked.hash.as_deref(), Some("1.2.3"));

        runtime.dispatch_command(UpdateStateCommand::DownloadUpdate);

        let downloaded = runtime.snapshot();
        assert_eq!(downloaded.status.as_deref(), Some("download-complete"));
        assert_eq!(downloaded.hash.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn update_source_base_strips_static_feed_file_without_github_autosource() {
        let feed = "https://github.com/Satont/twirchat/releases/latest/download/releases.osx.json";

        assert_eq!(
            update_source_base(feed),
            "https://github.com/Satont/twirchat/releases/latest/download"
        );
        assert_eq!(update_channel_from_feed(feed), "osx");
        assert_eq!(
            update_feed_url(&update_source_base(feed), &update_channel_from_feed(feed)),
            feed
        );
    }

    #[test]
    fn update_check_report_includes_feed_source_and_channel_context() {
        let feed = "https://github.com/Satont/twirchat/releases/latest/download/releases.osx.json";
        let request = UpdateCheckRequest::packaged(Some(feed.to_string()));

        let report = UpdateCheckReport::new(
            VelopackRuntimeStatus::Error,
            UpdateStatus::Error,
            "failed".to_string(),
            &request,
        );

        assert_eq!(report.feed.as_deref(), Some(feed));
        assert_eq!(
            report.source_base.as_deref(),
            Some("https://github.com/Satont/twirchat/releases/latest/download")
        );
        assert_eq!(report.channel.as_deref(), Some("osx"));
    }
}
