use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

const EXISTING_EVIDENCE: &[EvidenceArtifact] = &[
    EvidenceArtifact::json(
        "task-2-parity-matrix.json",
        "parity matrix validator result and feature counts",
        "validated",
    ),
    EvidenceArtifact::text(
        "task-2-parity-matrix-error.txt",
        "negative parity matrix fixture error",
        "validated",
    ),
    EvidenceArtifact::text(
        "task-3-gpui-smoke.log",
        "first GPUI frame smoke evidence",
        "smoke",
    ),
    EvidenceArtifact::json(
        "task-4-protocol-fixtures.json",
        "protocol fixture round-trip coverage",
        "validated",
    ),
    EvidenceArtifact::text(
        "task-4-protocol-error.txt",
        "unknown protocol discriminant error path",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-5-storage-compat.json",
        "Vue SQLite fixture storage compatibility",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-5-token-error.json",
        "corrupt token reauth handling",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-10-fixture-replay.json",
        "chat replay fixture aggregation and aliasing",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-10-chat-burst.json",
        "chat burst ordering and dedupe fixture",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-11-twitch-capability-matrix.json",
        "Twitch adapter capability matrix",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-11-twitch-expired-token.json",
        "Twitch expired token reauth handling",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-13-kick-capability-matrix.json",
        "Kick adapter capability matrix",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-13-kick-missing-chatroom.json",
        "Kick missing chatroom error handling",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-15-open-external-error.json",
        "open external failure state",
        "validated",
    ),
    EvidenceArtifact::json(
        "task-15-update-state.json",
        "runtime update state transitions",
        "validated",
    ),
];

const TEST_SURFACES: &[TestSurface] = &[
    TestSurface::new(
        "protocol",
        "tests/protocol.rs",
        "executable fixture round-trip and error tests",
    ),
    TestSurface::new(
        "storage",
        "tests/storage.rs",
        "executable SQLite compatibility and recovery tests",
    ),
    TestSurface::new(
        "backend_ws",
        "tests/backend_ws.rs",
        "executable WebSocket protocol and reconnect tests",
    ),
    TestSurface::new(
        "overlay",
        "tests/overlay_server.rs",
        "executable overlay HTTP/WebSocket runtime tests; built Vue assets required for full asset coverage",
    ),
    TestSurface::new(
        "auth",
        "tests/auth.rs",
        "executable PKCE/state/callback tests",
    ),
    TestSurface::new(
        "platform_twitch",
        "tests/twitch_adapter.rs",
        "executable mock Twitch adapter capability tests",
    ),
    TestSurface::new(
        "platform_youtube",
        "tests/youtube_adapter.rs",
        "executable non-polling YouTube adapter tests",
    ),
    TestSurface::new(
        "platform_kick",
        "tests/kick_adapter.rs",
        "executable mock Kick adapter capability tests",
    ),
    TestSurface::new(
        "chat",
        "tests/chat_domain.rs",
        "executable replay, burst, dedupe, and performance tests",
    ),
    TestSurface::new(
        "runtime",
        "tests/runtime.rs",
        "executable runtime state and external-open failure tests",
    ),
    TestSurface::new(
        "services",
        "tests/services.rs",
        "executable service lifecycle and bus tests",
    ),
    TestSurface::new(
        "watched_runtime",
        "tests/watched_channels_runtime.rs",
        "executable watched channel persistence/reconnect tests",
    ),
    TestSurface::new(
        "watched_parity",
        "tests/watched_parity_tests.rs",
        "scaffold-level watched layout contract tests",
    ),
    TestSurface::new(
        "ui_visuals",
        "tests/ui_visuals.rs",
        "scaffold-level visual/user-card/modal tests; not pixel or interaction automation",
    ),
    TestSurface::new(
        "app_state",
        "tests/app_state.rs",
        "executable app section state tests",
    ),
];

#[test]
fn parity_full_suite() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = workspace_root(&manifest_dir)?;
    let evidence_dir = workspace.join(".sisyphus/evidence");

    let parity_matrix_path = manifest_dir.join("parity/desktop-parity-matrix.json");
    let parity_matrix: Value = read_json(&parity_matrix_path)?;
    let rows = parity_matrix["rows"]
        .as_array()
        .ok_or("parity matrix rows should be an array")?;
    assert!(
        rows.len() >= 100,
        "parity matrix should retain broad desktop coverage"
    );

    let mut in_scope = 0_usize;
    let mut scaffold_notes = 0_usize;
    for row in rows {
        if row["status"] == "in_scope" {
            in_scope += 1;
        }
        if row["kind"] == "component" || row["kind"] == "modal" || row["kind"] == "popover" {
            scaffold_notes += 1;
        }
    }
    assert!(
        in_scope >= 100,
        "parity matrix should keep in-scope rows visible"
    );

    let fixture_summary = validate_fixtures(&manifest_dir)?;
    let surface_entries = TEST_SURFACES
        .iter()
        .map(|surface| surface.index_entry(&manifest_dir))
        .collect::<Result<Vec<_>, _>>()?;
    let evidence_entries = EXISTING_EVIDENCE
        .iter()
        .map(|artifact| artifact.index_entry(&evidence_dir))
        .collect::<Result<Vec<_>, _>>()?;

    let task_24_outputs = vec![
        json!({
            "path": ".sisyphus/evidence/task-24-parity-index.json",
            "producer": "parity_full_suite",
            "status": "generated_by_this_test"
        }),
        json!({
            "path": ".sisyphus/evidence/task-24-chat-burst-performance.json",
            "producer": "chat_burst_performance",
            "status": if evidence_dir.join("task-24-chat-burst-performance.json").exists() {
                "present"
            } else {
                "generated_by_chat_burst_performance"
            }
        }),
    ];

    let index = json!({
        "task": 24,
        "scope": "verification/performance hardening only",
        "parityMatrix": {
            "path": "packages/desktop-rust/parity/desktop-parity-matrix.json",
            "rows": rows.len(),
            "inScopeRows": in_scope,
            "uiRowsRequiringHonestScaffoldTreatment": scaffold_notes
        },
        "testSurfaces": surface_entries,
        "fixtureSummary": fixture_summary,
        "evidenceArtifacts": evidence_entries,
        "task24Outputs": task_24_outputs,
        "honestyNotes": [
            "protocol/storage/backend_ws/auth/platform/chat/runtime/service surfaces are executable Rust tests",
            "overlay server asset coverage depends on existing built Vue overlay assets",
            "watched parity and ui_visuals are currently scaffold-level contract tests, not full visual or interaction automation",
            "this index aggregates current evidence and does not claim packaging or final-review coverage"
        ]
    });

    write_json(&evidence_dir.join("task-24-parity-index.json"), &index)?;
    println!(
        "parity_full_suite indexed {} parity rows, {} test surfaces, and {} evidence artifacts",
        rows.len(),
        TEST_SURFACES.len(),
        EXISTING_EVIDENCE.len()
    );

    Ok(())
}

#[derive(Clone, Copy)]
struct EvidenceArtifact {
    file: &'static str,
    description: &'static str,
    guarantee: &'static str,
    kind: EvidenceKind,
}

impl EvidenceArtifact {
    const fn json(file: &'static str, description: &'static str, guarantee: &'static str) -> Self {
        Self {
            file,
            description,
            guarantee,
            kind: EvidenceKind::Json,
        }
    }

    const fn text(file: &'static str, description: &'static str, guarantee: &'static str) -> Self {
        Self {
            file,
            description,
            guarantee,
            kind: EvidenceKind::Text,
        }
    }

    fn index_entry(&self, evidence_dir: &Path) -> Result<Value, Box<dyn std::error::Error>> {
        let path = evidence_dir.join(self.file);
        if !path.exists() {
            return Err(format!("missing evidence artifact: {}", path.display()).into());
        }
        let bytes = fs::read(&path)?;
        if matches!(self.kind, EvidenceKind::Json) {
            let _: Value = serde_json::from_slice(&bytes)?;
        }
        Ok(json!({
            "path": format!(".sisyphus/evidence/{}", self.file),
            "description": self.description,
            "guarantee": self.guarantee,
            "kind": self.kind.as_str(),
            "bytes": bytes.len()
        }))
    }
}

#[derive(Clone, Copy)]
enum EvidenceKind {
    Json,
    Text,
}

impl EvidenceKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Text => "text",
        }
    }
}

#[derive(Clone, Copy)]
struct TestSurface {
    id: &'static str,
    path: &'static str,
    guarantee: &'static str,
}

impl TestSurface {
    const fn new(id: &'static str, path: &'static str, guarantee: &'static str) -> Self {
        Self {
            id,
            path,
            guarantee,
        }
    }

    fn index_entry(&self, manifest_dir: &Path) -> Result<Value, Box<dyn std::error::Error>> {
        let path = manifest_dir.join(self.path);
        if !path.exists() {
            return Err(format!("missing test surface: {}", path.display()).into());
        }
        Ok(json!({
            "id": self.id,
            "path": format!("packages/desktop-rust/{}", self.path),
            "guarantee": self.guarantee
        }))
    }
}

fn validate_fixtures(manifest_dir: &Path) -> Result<Value, Box<dyn std::error::Error>> {
    let protocol_dir = manifest_dir.join("fixtures/protocol");
    let backend_messages = read_json_array_len(&protocol_dir.join("backend-to-desktop.json"))?;
    let desktop_messages = read_json_array_len(&protocol_dir.join("desktop-to-backend.json"))?;
    let rpc = read_json(&protocol_dir.join("rpc.json"))?;
    let chat_burst = read_json(&manifest_dir.join("fixtures/chat/burst.json"))?;
    let chat_replay = read_json(&manifest_dir.join("fixtures/chat/replay.json"))?;

    assert!(manifest_dir.join("fixtures/db/healthy.sql").exists());
    assert!(
        manifest_dir
            .join("fixtures/db/corrupt-not-sqlite.bin")
            .exists()
    );
    assert!(manifest_dir.join("fixtures/db/corrupt-token.sql").exists());
    assert_eq!(chat_burst["count"], 250);

    Ok(json!({
        "protocol": {
            "backendToDesktopMessages": backend_messages,
            "desktopToBackendMessages": desktop_messages,
            "rpcBunRequests": rpc["bunRequests"].as_array().map_or(0, Vec::len),
            "rpcWebviewMessages": rpc["webviewMessages"].as_array().map_or(0, Vec::len)
        },
        "chat": {
            "burstCount": chat_burst["count"],
            "burstDuplicateEvery": chat_burst["duplicateEvery"],
            "replayItems": chat_replay["items"].as_array().map_or(0, Vec::len)
        },
        "storage": {
            "healthySql": "fixtures/db/healthy.sql",
            "corruptBinary": "fixtures/db/corrupt-not-sqlite.bin",
            "corruptTokenSql": "fixtures/db/corrupt-token.sql"
        }
    }))
}

fn read_json_array_len(path: &Path) -> Result<usize, Box<dyn std::error::Error>> {
    let value = read_json(path)?;
    value
        .as_array()
        .map(Vec::len)
        .ok_or_else(|| format!("{} should contain a JSON array", path.display()).into())
}

fn read_json(path: &Path) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_json(path: &Path, value: &Value) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn workspace_root(manifest_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "desktop-rust manifest should be under packages/desktop-rust".into())
}
