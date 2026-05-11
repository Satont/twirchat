//! Packaging verification for the native Rust desktop artifact.
//!
//! The native package is not yet a full release pipeline. This module captures
//! the asset contract that must stay aligned with the current Electrobun build:
//! built main/overlay views, overlay fonts, platform icons, and desktop metadata.

use serde::Serialize;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    File,
    NonEmptyDirectory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRequirement {
    pub id: &'static str,
    pub source_path: &'static str,
    pub packaged_path: &'static str,
    pub kind: AssetKind,
    pub reason: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagingAppMetadata {
    pub name: &'static str,
    pub identifier: &'static str,
    pub description: &'static str,
    pub release_base_url: &'static str,
    pub bun_version_reference: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackagingVerificationStatus {
    Present,
    Missing,
    EmptyDirectory,
    WrongType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetVerification {
    pub id: &'static str,
    pub source_path: &'static str,
    pub packaged_path: &'static str,
    pub kind: AssetKind,
    pub reason: &'static str,
    pub status: PackagingVerificationStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagingVerificationReport {
    pub app: PackagingAppMetadata,
    pub artifact_root: String,
    pub checks: Vec<AssetVerification>,
}

impl PackagingVerificationReport {
    pub fn failed_checks(&self) -> impl Iterator<Item = &AssetVerification> {
        self.checks
            .iter()
            .filter(|check| check.status != PackagingVerificationStatus::Present)
    }

    pub fn is_success(&self) -> bool {
        self.failed_checks().next().is_none()
    }
}

#[derive(Debug)]
pub enum PackagingVerificationError {
    Io {
        path: PathBuf,
        source: io::Error,
    },
    MissingAssets {
        report: Box<PackagingVerificationReport>,
    },
}

impl PackagingVerificationError {
    pub fn report(&self) -> Option<&PackagingVerificationReport> {
        match self {
            Self::Io { .. } => None,
            Self::MissingAssets { report } => Some(report.as_ref()),
        }
    }
}

impl fmt::Display for PackagingVerificationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => {
                write!(
                    formatter,
                    "failed to inspect packaging asset {}: {source}",
                    path.display()
                )
            }
            Self::MissingAssets { report } => {
                let missing = report
                    .failed_checks()
                    .map(|check| format!("{} ({:?})", check.packaged_path, check.status))
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    formatter,
                    "packaging artifact is missing required assets: {missing}"
                )
            }
        }
    }
}

impl std::error::Error for PackagingVerificationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::MissingAssets { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TwirChatPackagingSpec;

impl TwirChatPackagingSpec {
    pub const APP: PackagingAppMetadata = PackagingAppMetadata {
        name: "TwirChat",
        identifier: "dev.twirchat.app",
        description: "Multi-platform chat manager for streamers",
        release_base_url: "https://github.com/Satont/twirchat/releases/latest/download/",
        bun_version_reference: "1.3.13",
    };

    pub const REQUIRED_ASSETS: &'static [AssetRequirement] = &[
        AssetRequirement {
            id: "overlay-index",
            source_path: "packages/desktop/dist/overlay/index.html",
            packaged_path: "views/overlay/index.html",
            kind: AssetKind::File,
            reason: "OBS overlay entry copied by Electrobun build.copy",
        },
        AssetRequirement {
            id: "overlay-assets",
            source_path: "packages/desktop/dist/overlay/assets",
            packaged_path: "views/overlay/assets",
            kind: AssetKind::NonEmptyDirectory,
            reason: "OBS overlay bundled JS/CSS assets copied by Electrobun build.copy",
        },
        AssetRequirement {
            id: "main-index",
            source_path: "packages/desktop/dist/main/index.html",
            packaged_path: "views/main/index.html",
            kind: AssetKind::File,
            reason: "main window entry copied by Electrobun build.copy",
        },
        AssetRequirement {
            id: "main-assets",
            source_path: "packages/desktop/dist/main/assets",
            packaged_path: "views/main/assets",
            kind: AssetKind::NonEmptyDirectory,
            reason: "main window bundled JS/CSS assets copied by Electrobun build.copy",
        },
        AssetRequirement {
            id: "fonts",
            source_path: "packages/desktop/public/fonts",
            packaged_path: "views/fonts",
            kind: AssetKind::NonEmptyDirectory,
            reason: "shared Inter/Manrope font assets copied by Electrobun build.copy",
        },
        AssetRequirement {
            id: "linux-icon",
            source_path: "packages/desktop/assets/icon.png",
            packaged_path: "assets/icon.png",
            kind: AssetKind::File,
            reason: "Linux package icon from Electrobun build.linux.icon",
        },
        AssetRequirement {
            id: "windows-icon",
            source_path: "packages/desktop/assets/icon.ico",
            packaged_path: "assets/icon.ico",
            kind: AssetKind::File,
            reason: "Windows package icon from Electrobun build.win.icon",
        },
        AssetRequirement {
            id: "mac-icons",
            source_path: "packages/desktop/assets/icon.iconset",
            packaged_path: "assets/icon.iconset",
            kind: AssetKind::NonEmptyDirectory,
            reason: "macOS iconset from Electrobun build.mac.icons",
        },
    ];

    pub fn requirements() -> &'static [AssetRequirement] {
        Self::REQUIRED_ASSETS
    }
}

pub fn verify_packaging_artifact(
    artifact_root: impl AsRef<Path>,
) -> Result<PackagingVerificationReport, PackagingVerificationError> {
    let artifact_root = artifact_root.as_ref();
    let report = packaging_report(artifact_root)?;
    if report.is_success() {
        Ok(report)
    } else {
        Err(PackagingVerificationError::MissingAssets {
            report: Box::new(report),
        })
    }
}

fn packaging_report(
    artifact_root: &Path,
) -> Result<PackagingVerificationReport, PackagingVerificationError> {
    let mut checks = Vec::with_capacity(TwirChatPackagingSpec::requirements().len());
    for requirement in TwirChatPackagingSpec::requirements() {
        let path = artifact_root.join(requirement.packaged_path);
        checks.push(AssetVerification {
            id: requirement.id,
            source_path: requirement.source_path,
            packaged_path: requirement.packaged_path,
            kind: requirement.kind,
            reason: requirement.reason,
            status: verify_asset(&path, requirement.kind)?,
        });
    }

    Ok(PackagingVerificationReport {
        app: TwirChatPackagingSpec::APP,
        artifact_root: artifact_root.display().to_string(),
        checks,
    })
}

fn verify_asset(
    path: &Path,
    kind: AssetKind,
) -> Result<PackagingVerificationStatus, PackagingVerificationError> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(PackagingVerificationStatus::Missing);
        }
        Err(source) => {
            return Err(PackagingVerificationError::Io {
                path: path.to_path_buf(),
                source,
            });
        }
    };

    match kind {
        AssetKind::File if metadata.is_file() => Ok(PackagingVerificationStatus::Present),
        AssetKind::File => Ok(PackagingVerificationStatus::WrongType),
        AssetKind::NonEmptyDirectory if metadata.is_dir() => {
            if directory_has_entries(path)? {
                Ok(PackagingVerificationStatus::Present)
            } else {
                Ok(PackagingVerificationStatus::EmptyDirectory)
            }
        }
        AssetKind::NonEmptyDirectory => Ok(PackagingVerificationStatus::WrongType),
    }
}

fn directory_has_entries(path: &Path) -> Result<bool, PackagingVerificationError> {
    let mut entries = fs::read_dir(path).map_err(|source| PackagingVerificationError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    match entries.next() {
        Some(Ok(_)) => Ok(true),
        Some(Err(source)) => Err(PackagingVerificationError::Io {
            path: path.to_path_buf(),
            source,
        }),
        None => Ok(false),
    }
}
