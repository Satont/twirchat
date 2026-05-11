use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use twirchat_desktop_rust::runtime::{
    AssetKind, PackagingVerificationError, PackagingVerificationStatus, TwirChatPackagingSpec,
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
