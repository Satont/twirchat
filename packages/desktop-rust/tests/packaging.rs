use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;
use twirchat::runtime::{
    AssetKind, PackagingTarget, PackagingVerificationError, PackagingVerificationStatus,
    TwirChatPackagingSpec, VelopackPlanInput, plan_velopack_commands, render_velopack_simulation,
    verify_packaging_artifact,
};

#[test]
fn packaging_artifact_contains_required_assets() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::LinuxX64)?;
    let report = verify_packaging_artifact(artifact.path(), PackagingTarget::LinuxX64)?;

    assert!(report.is_success());
    assert_eq!(report.app.name, "TwirChat");
    assert_eq!(report.app.identifier, "dev.twirchat.app");
    assert_eq!(
        report.checks.len(),
        TwirChatPackagingSpec::requirements(PackagingTarget::LinuxX64).len()
    );
    assert!(report.checks.iter().all(|check| {
        check.status == PackagingVerificationStatus::Present
            && artifact.path().join(check.packaged_path).exists()
    }));

    write_evidence(
        "task-25-packaging-assets.json",
        &json!({
            "status": "ok",
            "report": report,
            "isNativeOnlyContract": true,
        }),
    )?;

    println!(
        "verified {} required packaging assets in {}",
        TwirChatPackagingSpec::requirements(PackagingTarget::LinuxX64).len(),
        artifact.path().display()
    );
    Ok(())
}

#[test]
fn packaging_missing_native_executable_fails() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::MacosUniversal)?;
    fs::remove_file(artifact.path().join("TwirChat.app/Contents/MacOS/TwirChat"))?;

    let error = match verify_packaging_artifact(artifact.path(), PackagingTarget::MacosUniversal) {
        Ok(_) => {
            return Err("missing macOS app binary unexpectedly passed verification".into());
        }
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "macos-app-executable");
    assert_eq!(failed[0].status, PackagingVerificationStatus::Missing);

    write_evidence(
        "task-25-packaging-error.json",
        &json!({
            "status": "failed-as-expected",
            "missing": failed,
            "report": report,
        }),
    )?;

    println!("missing macOS app executable failed packaging verification as expected");
    Ok(())
}

#[test]
fn packaging_missing_macos_resources_directory_fails() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::MacosUniversal)?;
    fs::remove_dir_all(artifact.path().join("TwirChat.app/Contents/Resources"))?;

    let error = match verify_packaging_artifact(artifact.path(), PackagingTarget::MacosUniversal) {
        Ok(_) => {
            return Err(
                "missing macOS Resources directory unexpectedly passed verification".into(),
            );
        }
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "macos-resources-directory");
    assert_eq!(failed[0].status, PackagingVerificationStatus::Missing);

    Ok(())
}

#[test]
fn packaging_missing_macos_info_plist_fails() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::MacosUniversal)?;
    fs::remove_file(artifact.path().join("TwirChat.app/Contents/Info.plist"))?;

    let error = match verify_packaging_artifact(artifact.path(), PackagingTarget::MacosUniversal) {
        Ok(_) => {
            return Err("missing macOS Info.plist unexpectedly passed verification".into());
        }
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "macos-info-plist");
    assert_eq!(failed[0].status, PackagingVerificationStatus::Missing);

    Ok(())
}

#[test]
fn packaging_empty_macos_resources_directory_fails() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::MacosUniversal)?;
    fs::remove_file(
        artifact
            .path()
            .join("TwirChat.app/Contents/Resources/artifact-sentinel.txt"),
    )?;

    let error = match verify_packaging_artifact(artifact.path(), PackagingTarget::MacosUniversal) {
        Ok(_) => {
            return Err("empty macOS Resources directory unexpectedly passed verification".into());
        }
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "macos-resources-directory");
    assert_eq!(
        failed[0].status,
        PackagingVerificationStatus::EmptyDirectory
    );

    Ok(())
}

#[test]
fn packaging_hidden_macos_resources_marker_fails_after_artifact_filtering()
-> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::MacosUniversal)?;
    let resources_dir = artifact.path().join("TwirChat.app/Contents/Resources");
    fs::remove_file(resources_dir.join("artifact-sentinel.txt"))?;
    write_file(
        &resources_dir.join(".keep"),
        "hidden marker omitted by upload-artifact",
    )?;

    fs::remove_file(resources_dir.join(".keep"))?;

    let error = match verify_packaging_artifact(artifact.path(), PackagingTarget::MacosUniversal) {
        Ok(_) => {
            return Err(
                "hidden-only macOS Resources marker unexpectedly survived filtering".into(),
            );
        }
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "macos-resources-directory");
    assert_eq!(
        failed[0].status,
        PackagingVerificationStatus::EmptyDirectory
    );

    Ok(())
}

#[test]
fn release_contract_verify_artifact_cli_accepts_packaged_layout()
-> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::LinuxX64)?;
    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("verify-artifact")
        .arg(artifact.path())
        .arg("--target")
        .arg("linux-x64")
        .output()?;

    assert!(
        output.status.success(),
        "verify-artifact failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout)?;
    assert!(stdout.contains(r#""artifactRoot""#));
    assert!(stdout.contains(r#""packagedPath": "twirchat""#));
    assert!(!stdout.contains("views/"));
    assert!(!stdout.contains("assets/icon"));

    Ok(())
}

#[test]
fn release_contract_verify_artifact_cli_rejects_missing_assets()
-> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact(PackagingTarget::WinX64)?;
    fs::remove_file(artifact.path().join("twirchat.exe"))?;

    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("verify-artifact")
        .arg(artifact.path())
        .arg("--target")
        .arg("win-x64")
        .output()?;

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr)?;
    assert!(stderr.contains("packaging artifact is missing required assets"));
    assert!(stderr.contains("twirchat.exe"));

    Ok(())
}

#[test]
fn release_contract_verify_artifact_cli_requires_target() -> Result<(), Box<dyn std::error::Error>>
{
    let artifact = create_packaging_artifact(PackagingTarget::LinuxX64)?;
    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("verify-artifact")
        .arg(artifact.path())
        .output()?;

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr)?;
    assert!(stderr.contains("verify-artifact requires --target"));
    Ok(())
}

#[test]
fn release_contract_tag_mode_rejects_extra_args() -> Result<(), Box<dyn std::error::Error>> {
    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("v1.2.3")
        .arg("extra")
        .output()?;

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr)?;
    assert!(stderr.contains("accepts exactly one argument"));
    assert!(stderr.contains("extra"));

    Ok(())
}

#[test]
fn velopack_upload_plan_merges_into_existing_github_release()
-> Result<(), Box<dyn std::error::Error>> {
    let plan = plan_velopack_commands(VelopackPlanInput {
        tag: "v1.2.3",
        repository_url: "https://github.com/Satont/twirchat",
        artifact_root: Path::new("artifacts"),
        first_release: false,
        existing_assets: &[],
    })?;
    let simulation = render_velopack_simulation(&plan);

    assert!(simulation.contains("vpk upload github --repoUrl https://github.com/Satont/twirchat --publish --merge --tag v1.2.3 --channel linux --outputDir artifacts/velopack/linux"));
    assert!(simulation.contains("vpk upload github --repoUrl https://github.com/Satont/twirchat --publish --merge --tag v1.2.3 --channel win --outputDir artifacts/velopack/win"));
    assert!(simulation.contains("vpk upload github --repoUrl https://github.com/Satont/twirchat --publish --merge --tag v1.2.3 --channel osx --outputDir artifacts/velopack/osx"));

    Ok(())
}

#[test]
fn velopack_plan_uses_twirchat_app_binary_names() -> Result<(), Box<dyn std::error::Error>> {
    let plan = plan_velopack_commands(VelopackPlanInput {
        tag: "v1.2.3",
        repository_url: "https://github.com/Satont/twirchat",
        artifact_root: Path::new("artifacts"),
        first_release: true,
        existing_assets: &[],
    })?;
    let simulation = render_velopack_simulation(&plan);

    assert!(simulation.contains(
        "vpk [linux] pack -u dev.twirchat.app -v 1.2.3 --packDir artifacts/desktop-linux-x64 --mainExe twirchat --channel linux --outputDir artifacts/velopack/linux --runtime linux-x64"
    ));
    assert!(simulation.contains(
        "vpk [win] pack -u dev.twirchat.app -v 1.2.3 --packDir artifacts/desktop-win-x64 --mainExe twirchat.exe --channel win --outputDir artifacts/velopack/win --runtime win-x64"
    ));
    assert!(simulation.contains(
        "vpk [osx] pack -u dev.twirchat.app -v 1.2.3 --packDir artifacts/desktop-macos-universal/TwirChat.app --mainExe TwirChat --channel osx --outputDir artifacts/velopack/osx"
    ));

    Ok(())
}

fn create_packaging_artifact(
    target: PackagingTarget,
) -> Result<TempDir, Box<dyn std::error::Error>> {
    let artifact = tempfile::tempdir()?;
    for requirement in TwirChatPackagingSpec::requirements(target) {
        let path = artifact.path().join(requirement.packaged_path);
        match requirement.kind {
            AssetKind::File => write_file(&path, requirement.id)?,
            AssetKind::Directory => fs::create_dir_all(&path)?,
            AssetKind::NonEmptyDirectory => {
                fs::create_dir_all(&path)?;
                write_file(&path.join("artifact-sentinel.txt"), requirement.id)?;
            }
        }
    }
    Ok(artifact)
}

fn write_file(path: &Path, content: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

fn write_evidence(name: &str, value: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let path = workspace_root().join(".sisyphus").join("evidence");
    fs::create_dir_all(&path)?;
    fs::write(path.join(name), serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            Path::to_path_buf,
        )
}
