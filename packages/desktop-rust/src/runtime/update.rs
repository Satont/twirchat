use crate::protocol::rpc::UpdateStatusPayload;
use crate::protocol::types::AppSettings;
use crate::services::commands::UpdateStateCommand;
use crate::services::events::UpdateStateEvent;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use velopack::{UpdateCheck, UpdateManager, UpdateOptions, VelopackApp, sources::AutoSource};

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(60);

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
    NoUpdate,
    Error {
        message: String,
    },
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
        }
    }
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
                if hash.as_ref().is_some_and(|hash| self.is_hash_skipped(hash)) {
                    return None;
                }
                let message = version.map_or_else(
                    || "Update available".to_string(),
                    |version| format!("Update available: {version}"),
                );
                self.apply_status(UpdateStatus::UpdateAvailable, message, None, hash)
            }
            UpdateEvent::NoUpdate => self.apply_status(
                UpdateStatus::NoUpdate,
                "No updates available".to_string(),
                None,
                None,
            ),
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
        }
    }

    pub fn is_hash_skipped(&self, hash: &str) -> bool {
        self.skipped_hash.as_deref() == Some(hash)
    }

    fn apply_command(&mut self, command: UpdateStateCommand) -> Option<UpdateStatusPayload> {
        match command {
            UpdateStateCommand::CheckForUpdates => self.apply_status(
                UpdateStatus::Checking,
                "Checking for updates...".to_string(),
                None,
                None,
            ),
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
                None
            }
        }
    }

    fn apply_service_event(&mut self, event: UpdateStateEvent) -> Option<UpdateStatusPayload> {
        match event {
            UpdateStateEvent::CheckRequested => {
                self.apply_command(UpdateStateCommand::CheckForUpdates)
            }
            UpdateStateEvent::DownloadRequested => {
                self.apply_command(UpdateStateCommand::DownloadUpdate)
            }
            UpdateStateEvent::ApplyRequested => self.apply_command(UpdateStateCommand::ApplyUpdate),
            UpdateStateEvent::SkipRequested { hash } => {
                self.apply_command(UpdateStateCommand::SkipUpdate { hash })
            }
        }
    }

    fn apply_status(
        &mut self,
        status: UpdateStatus,
        message: String,
        progress: Option<f64>,
        hash: Option<String>,
    ) -> Option<UpdateStatusPayload> {
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

#[derive(Debug, Clone, PartialEq, Default)]
pub struct UpdateRuntime {
    state: UpdateState,
}

impl UpdateRuntime {
    pub fn new(state: UpdateState) -> Self {
        Self { state }
    }

    pub fn dispatch(&mut self, event: UpdateEvent) -> Option<UpdateStatusPayload> {
        self.state.apply(event)
    }

    pub fn state(&self) -> &UpdateState {
        &self.state
    }

    pub fn check_for_updates(&mut self, request: &UpdateCheckRequest) -> UpdateCheckReport {
        let report = check_velopack_updates(request);
        let event = report.to_event();
        let _ = self.dispatch(event);
        report
    }
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

    fn to_event(&self) -> UpdateEvent {
        match self.runtime_status {
            VelopackRuntimeStatus::UpdateAvailable => UpdateEvent::UpdateAvailable {
                version: self.available_version.clone(),
                hash: None,
            },
            VelopackRuntimeStatus::Error | VelopackRuntimeStatus::Offline => UpdateEvent::Error {
                message: self.message.clone(),
            },
            _ => UpdateEvent::Status {
                status: UpdateStatus::NoUpdate,
                message: self.message.clone(),
                progress: None,
                hash: None,
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

    let source = AutoSource::new(&update_source_base(feed));
    let options = UpdateOptions {
        ExplicitChannel: Some(update_channel_from_feed(feed)),
        ..UpdateOptions::default()
    };

    let manager = match UpdateManager::new(source, Some(options), None) {
        Ok(manager) => manager,
        Err(error) if is_not_installed_error(&error) => {
            return UpdateCheckReport::new(
                VelopackRuntimeStatus::Unpackaged,
                UpdateStatus::NoUpdate,
                format!("Update check skipped: {error}"),
                request,
            );
        }
        Err(error) => {
            return UpdateCheckReport::new(
                VelopackRuntimeStatus::Error,
                UpdateStatus::Error,
                format!("Update check unavailable: {error}"),
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
            format!("Update check could not reach feed: {error}"),
            request,
        )
        .with_manager(&manager),
        Err(error) => UpdateCheckReport::new(
            VelopackRuntimeStatus::Error,
            UpdateStatus::Error,
            format!("Update check failed: {error}"),
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
