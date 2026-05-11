use crate::protocol::rpc::UpdateStatusPayload;
use crate::protocol::types::AppSettings;
use crate::services::commands::UpdateStateCommand;
use crate::services::events::UpdateStateEvent;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(60);

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
