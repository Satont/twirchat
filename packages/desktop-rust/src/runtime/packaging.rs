//! Packaging verification for the native Rust desktop artifact.

use serde::Serialize;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    File,
    Directory,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackagingTarget {
    LinuxX64,
    WinX64,
    MacosUniversal,
}

impl PackagingTarget {
    pub fn from_cli_value(value: &str) -> Option<Self> {
        match value {
            "linux-x64" => Some(Self::LinuxX64),
            "win-x64" => Some(Self::WinX64),
            "macos-universal" => Some(Self::MacosUniversal),
            _ => None,
        }
    }
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

    pub const REQUIRED_ASSETS_LINUX_X64: &'static [AssetRequirement] = &[AssetRequirement {
        id: "linux-executable",
        source_path: "packages/desktop-rust/target/release/twirchat",
        packaged_path: "twirchat",
        kind: AssetKind::File,
        reason: "native Linux executable staged for Velopack packDir",
    }];

    pub const REQUIRED_ASSETS_WIN_X64: &'static [AssetRequirement] = &[AssetRequirement {
        id: "windows-executable",
        source_path: "packages/desktop-rust/target/release/twirchat.exe",
        packaged_path: "twirchat.exe",
        kind: AssetKind::File,
        reason: "native Windows executable staged for Velopack packDir",
    }];

    pub const REQUIRED_ASSETS_MACOS_UNIVERSAL: &'static [AssetRequirement] = &[
        AssetRequirement {
            id: "macos-app-bundle",
            source_path: "packages/desktop-rust/target/universal-apple-darwin/release/TwirChat.app",
            packaged_path: "TwirChat.app",
            kind: AssetKind::NonEmptyDirectory,
            reason: "native macOS app bundle staged for Velopack packDir",
        },
        AssetRequirement {
            id: "macos-app-executable",
            source_path: "packages/desktop-rust/target/universal-apple-darwin/release/twirchat",
            packaged_path: "TwirChat.app/Contents/MacOS/TwirChat",
            kind: AssetKind::File,
            reason: "native macOS app binary inside TwirChat.app bundle",
        },
        AssetRequirement {
            id: "macos-info-plist",
            source_path: "packages/desktop-rust/release-assets/macos/Info.plist",
            packaged_path: "TwirChat.app/Contents/Info.plist",
            kind: AssetKind::File,
            reason: "macOS bundle metadata required by the prebuilt TwirChat.app",
        },
        AssetRequirement {
            id: "macos-resources-directory",
            source_path: "packages/desktop-rust/release-assets/macos/Resources",
            packaged_path: "TwirChat.app/Contents/Resources",
            kind: AssetKind::NonEmptyDirectory,
            reason: "Velopack writes sq.version into Contents/Resources during macOS preprocessing, and upload-artifact preserves non-empty directories",
        },
    ];

    pub fn requirements(target: PackagingTarget) -> &'static [AssetRequirement] {
        match target {
            PackagingTarget::LinuxX64 => Self::REQUIRED_ASSETS_LINUX_X64,
            PackagingTarget::WinX64 => Self::REQUIRED_ASSETS_WIN_X64,
            PackagingTarget::MacosUniversal => Self::REQUIRED_ASSETS_MACOS_UNIVERSAL,
        }
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

    let mut artifact_directory = input.artifact_root.join(format!(
        "desktop-{}",
        velopack_artifact_target_name(channel.channel)
    ));
    if let Some(pack_dir_suffix) = velopack_pack_dir_suffix(channel.channel) {
        artifact_directory = artifact_directory.join(pack_dir_suffix);
    }
    let artifact_directory = artifact_directory.display().to_string();
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
            "vpk [{}] pack -u {} -v {} --packDir {} --mainExe {} --channel {} --outputDir {}{}",
            velopack_target_directive(channel.channel),
            release.contract.package_id,
            release.pack_version,
            artifact_directory,
            velopack_target_executable(channel.channel),
            channel.channel,
            package_directory,
            velopack_target_runtime_arg(channel.channel)
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
        "osx" => "TwirChat",
        _ => "twirchat",
    }
}

fn velopack_pack_dir_suffix(channel: &str) -> Option<&'static str> {
    match channel {
        "osx" => Some("TwirChat.app"),
        _ => None,
    }
}

fn velopack_target_directive(channel: &str) -> &'static str {
    match channel {
        "linux" => "linux",
        "win" => "win",
        "osx" => "osx",
        _ => "linux",
    }
}

fn velopack_target_runtime_arg(channel: &str) -> &'static str {
    match channel {
        "linux" => " --runtime linux-x64",
        "win" => " --runtime win-x64",
        "osx" => "",
        _ => "",
    }
}

pub fn verify_packaging_artifact(
    artifact_root: impl AsRef<Path>,
    target: PackagingTarget,
) -> Result<PackagingVerificationReport, PackagingVerificationError> {
    let artifact_root = artifact_root.as_ref();
    let report = packaging_report(artifact_root, target)?;
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
    target: PackagingTarget,
) -> Result<PackagingVerificationReport, PackagingVerificationError> {
    let requirements = TwirChatPackagingSpec::requirements(target);
    let mut checks = Vec::with_capacity(requirements.len());
    for requirement in requirements {
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
        AssetKind::Directory if metadata.is_dir() => Ok(PackagingVerificationStatus::Present),
        AssetKind::Directory => Ok(PackagingVerificationStatus::WrongType),
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
