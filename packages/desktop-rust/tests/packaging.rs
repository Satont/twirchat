use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;
use twirchat_desktop_rust::runtime::{
    AssetKind, PackagingVerificationError, PackagingVerificationStatus, TwirChatPackagingSpec,
    VelopackPlanInput, plan_velopack_commands, render_velopack_simulation,
    verify_packaging_artifact,
};

#[test]
fn packaging_artifact_contains_required_assets() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact()?;
    let report = verify_packaging_artifact(artifact.path())?;

    assert!(report.is_success());
    assert_eq!(report.app.name, "TwirChat");
    assert_eq!(report.app.identifier, "dev.twirchat.app");
    assert_eq!(
        report.checks.len(),
        TwirChatPackagingSpec::requirements().len()
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
            "mirrorsElectrobunCopyMap": true,
        }),
    )?;

    println!(
        "verified {} required packaging assets in {}",
        TwirChatPackagingSpec::requirements().len(),
        artifact.path().display()
    );
    Ok(())
}

#[test]
fn packaging_missing_overlay_asset_fails() -> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact()?;
    fs::remove_file(artifact.path().join("views/overlay/index.html"))?;

    let error = match verify_packaging_artifact(artifact.path()) {
        Ok(_) => return Err("missing overlay index unexpectedly passed verification".into()),
        Err(error) => error,
    };
    let PackagingVerificationError::MissingAssets { report } = error else {
        return Err(format!("unexpected packaging verification error: {error}").into());
    };

    let failed = report.failed_checks().collect::<Vec<_>>();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].id, "overlay-index");
    assert_eq!(failed[0].status, PackagingVerificationStatus::Missing);

    write_evidence(
        "task-25-packaging-error.json",
        &json!({
            "status": "failed-as-expected",
            "missing": failed,
            "report": report,
        }),
    )?;

    println!("missing overlay index failed packaging verification as expected");
    Ok(())
}

#[test]
fn release_contract_verify_artifact_cli_accepts_packaged_layout()
-> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact()?;
    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("verify-artifact")
        .arg(artifact.path())
        .output()?;

    assert!(
        output.status.success(),
        "verify-artifact failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout)?;
    assert!(stdout.contains(r#""artifactRoot""#));
    assert!(stdout.contains(r#""packagedPath": "views/main/index.html""#));
    assert!(stdout.contains(r#""packagedPath": "assets/icon.png""#));

    Ok(())
}

#[test]
fn release_contract_verify_artifact_cli_rejects_missing_assets()
-> Result<(), Box<dyn std::error::Error>> {
    let artifact = create_packaging_artifact()?;
    fs::remove_dir_all(artifact.path().join("assets/icon.iconset"))?;

    let output = Command::new(env!("CARGO_BIN_EXE_release-contract"))
        .arg("verify-artifact")
        .arg(artifact.path())
        .output()?;

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr)?;
    assert!(stderr.contains("packaging artifact is missing required assets"));
    assert!(stderr.contains("assets/icon.iconset"));

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

fn create_packaging_artifact() -> Result<TempDir, Box<dyn std::error::Error>> {
    let artifact = tempfile::tempdir()?;
    for requirement in TwirChatPackagingSpec::requirements() {
        let path = artifact.path().join(requirement.packaged_path);
        match requirement.kind {
            AssetKind::File => write_file(&path, requirement.id)?,
            AssetKind::NonEmptyDirectory => {
                fs::create_dir_all(&path)?;
                write_file(&path.join(".asset-sentinel"), requirement.id)?;
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
