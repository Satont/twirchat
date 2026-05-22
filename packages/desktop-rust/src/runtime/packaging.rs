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
    pub package_id: &'static str,
    pub description: &'static str,
    pub release_base_url: &'static str,
    pub bun_version_reference: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VelopackReleaseContract {
    pub package_id: &'static str,
    pub display_name: &'static str,
    pub stable_tag_pattern: &'static str,
    pub pack_version_rule: &'static str,
    pub channels: &'static [VelopackPlatformChannel],
    pub first_release_policy: &'static str,
    pub rerun_conflict_policy: &'static str,
    pub signing_policy: &'static str,
    pub prerelease_policy: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VelopackPlatformChannel {
    pub channel: &'static str,
    pub operating_system: &'static str,
    pub architectures: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VelopackValidatedRelease {
    pub contract: VelopackReleaseContract,
    pub tag: String,
    pub pack_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VelopackCommandPlan {
    pub release: VelopackValidatedRelease,
    pub repository_url: String,
    pub first_release: bool,
    pub targets: Vec<VelopackTargetCommandPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VelopackTargetCommandPlan {
    pub channel: &'static str,
    pub operating_system: &'static str,
    pub architecture: &'static str,
    pub artifact_directory: String,
    pub executable: &'static str,
    pub feed_asset: String,
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VelopackPlanInput<'a> {
    pub tag: &'a str,
    pub repository_url: &'a str,
    pub artifact_root: &'a Path,
    pub first_release: bool,
    pub existing_assets: &'a [&'a str],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VelopackCommandPlanError {
    ReleaseTag(ReleaseTagError),
    ExistingAssetConflict {
        tag: String,
        channel: &'static str,
        asset: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseTagError {
    UnstableTag { tag: String, expected: &'static str },
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

impl fmt::Display for ReleaseTagError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnstableTag { tag, expected } => {
                write!(
                    formatter,
                    "release tag '{tag}' is not a stable TwirChat release tag; expected {expected}"
                )
            }
        }
    }
}

impl std::error::Error for ReleaseTagError {}

impl fmt::Display for VelopackCommandPlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReleaseTag(error) => error.fmt(formatter),
            Self::ExistingAssetConflict {
                tag,
                channel,
                asset,
            } => {
                write!(
                    formatter,
                    "refusing to prepare Velopack upload for tag '{tag}' channel '{channel}': release asset '{asset}' already exists"
                )
            }
        }
    }
}

impl std::error::Error for VelopackCommandPlanError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ReleaseTag(error) => Some(error),
            Self::ExistingAssetConflict { .. } => None,
        }
    }
}

impl From<ReleaseTagError> for VelopackCommandPlanError {
    fn from(error: ReleaseTagError) -> Self {
        Self::ReleaseTag(error)
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
        package_id: "dev.twirchat.app",
        description: "Multi-platform chat manager for streamers",
        release_base_url: "https://github.com/Satont/twirchat/releases/latest/download/",
        bun_version_reference: "1.3.13",
    };

    pub const STABLE_TAG_PATTERN: &'static str = "^v[0-9]+\\.[0-9]+\\.[0-9]+$";

    pub const VELOPACK_CHANNELS: &'static [VelopackPlatformChannel] = &[
        VelopackPlatformChannel {
            channel: "linux",
            operating_system: "Linux",
            architectures: &["x64"],
        },
        VelopackPlatformChannel {
            channel: "win",
            operating_system: "Windows",
            architectures: &["x64"],
        },
        VelopackPlatformChannel {
            channel: "osx",
            operating_system: "macOS",
            architectures: &["universal"],
        },
    ];

    pub const VELOPACK_RELEASE: VelopackReleaseContract = VelopackReleaseContract {
        package_id: Self::APP.package_id,
        display_name: Self::APP.name,
        stable_tag_pattern: Self::STABLE_TAG_PATTERN,
        pack_version_rule: "strip the leading 'v' from a stable tag and pass the remaining version to Velopack packVersion",
        channels: Self::VELOPACK_CHANNELS,
        first_release_policy: "first stable tag creates the initial Velopack feed for each platform channel; there is no prerelease bootstrap channel",
        rerun_conflict_policy: "rerunning an existing stable tag must fail instead of overwriting published Velopack release assets or feeds",
        signing_policy: "no signing or notarization is part of the current native Rust Velopack contract",
        prerelease_policy: "prerelease, beta, nightly, and unprefixed semver tags are rejected",
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

    pub fn velopack_release_contract() -> VelopackReleaseContract {
        Self::VELOPACK_RELEASE
    }
}

pub fn validate_velopack_release_tag(
    tag: impl AsRef<str>,
) -> Result<VelopackValidatedRelease, ReleaseTagError> {
    let tag = tag.as_ref();
    if !is_stable_release_tag(tag) {
        return Err(ReleaseTagError::UnstableTag {
            tag: tag.to_string(),
            expected: TwirChatPackagingSpec::STABLE_TAG_PATTERN,
        });
    }

    Ok(VelopackValidatedRelease {
        contract: TwirChatPackagingSpec::velopack_release_contract(),
        tag: tag.to_string(),
        pack_version: tag.trim_start_matches('v').to_string(),
    })
}

fn is_stable_release_tag(tag: &str) -> bool {
    let Some(version) = tag.strip_prefix('v') else {
        return false;
    };
    let mut parts = version.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };

    parts.next().is_none()
        && is_ascii_number(major)
        && is_ascii_number(minor)
        && is_ascii_number(patch)
}

fn is_ascii_number(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

pub fn plan_velopack_commands(
    input: VelopackPlanInput<'_>,
) -> Result<VelopackCommandPlan, VelopackCommandPlanError> {
    let release = validate_velopack_release_tag(input.tag)?;
    let targets = TwirChatPackagingSpec::VELOPACK_CHANNELS
        .iter()
        .map(|channel| velopack_target_plan(channel, &release, &input))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(VelopackCommandPlan {
        release,
        repository_url: input.repository_url.to_string(),
        first_release: input.first_release,
        targets,
    })
}

pub fn render_velopack_simulation(plan: &VelopackCommandPlan) -> String {
    let mut output = vec![format!(
        "Velopack simulation for {} (packVersion {})",
        plan.release.tag, plan.release.pack_version
    )];

    if plan.first_release {
        output.push(
            "first-release mode: no previous feed is required before command preparation"
                .to_string(),
        );
    }

    for target in &plan.targets {
        output.push(format!(
            "[{} {} -> {}]",
            target.operating_system, target.architecture, target.channel
        ));
        output.extend(target.commands.iter().cloned());
    }

    output.join("\n")
}

fn velopack_target_plan(
    channel: &VelopackPlatformChannel,
    release: &VelopackValidatedRelease,
    input: &VelopackPlanInput<'_>,
) -> Result<VelopackTargetCommandPlan, VelopackCommandPlanError> {
    let architecture = channel.architectures[0];
    let feed_asset = format!("releases.{}.json", channel.channel);
    if input
        .existing_assets
        .iter()
        .any(|asset| asset.trim() == feed_asset)
    {
        return Err(VelopackCommandPlanError::ExistingAssetConflict {
            tag: release.tag.clone(),
            channel: channel.channel,
            asset: feed_asset,
        });
    }

    let artifact_directory = input
        .artifact_root
        .join(format!(
            "desktop-{}",
            velopack_artifact_target_name(channel.channel)
        ))
        .display()
        .to_string();
    let package_directory = input
        .artifact_root
        .join("velopack")
        .join(channel.channel)
        .display()
        .to_string();

    let commands = vec![
        format!(
            "vpk download github --repoUrl {} --channel {} --outputDir {}",
            input.repository_url, channel.channel, package_directory
        ),
        format!(
            "vpk pack -u {} -v {} --packDir {} --mainExe {} --channel {} --outputDir {}",
            release.contract.package_id,
            release.pack_version,
            artifact_directory,
            velopack_target_executable(channel.channel),
            channel.channel,
            package_directory
        ),
        format!(
            "vpk upload github --repoUrl {} --publish --merge --tag {} --channel {} --outputDir {}",
            input.repository_url, release.tag, channel.channel, package_directory
        ),
    ];

    Ok(VelopackTargetCommandPlan {
        channel: channel.channel,
        operating_system: channel.operating_system,
        architecture,
        artifact_directory,
        executable: velopack_target_executable(channel.channel),
        feed_asset,
        commands,
    })
}

fn velopack_artifact_target_name(channel: &str) -> &'static str {
    match channel {
        "linux" => "linux-x64",
        "win" => "win-x64",
        "osx" => "macos-universal",
        _ => "unknown",
    }
}

fn velopack_target_executable(channel: &str) -> &'static str {
    match channel {
        "linux" => "twirchat",
        "win" => "twirchat.exe",
        "osx" => "TwirChat.app",
        _ => "twirchat",
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
