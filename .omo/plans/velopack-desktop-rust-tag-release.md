# Velopack Desktop Rust Tag Release

## TL;DR

> **Summary**: Replace the old Electrobun desktop release artifacts with Velopack-powered `packages/desktop-rust` artifacts published automatically from stable `v*` tags. Keep backend and Docker release behavior intact while adding safe Rust updater startup, GitHub Releases publishing, first-release handling, and rerun preflight guards.
> **Deliverables**:
>
> - Velopack runtime startup/update integration for `packages/desktop-rust`.
> - Deterministic Velopack package identity, version, channel, and artifact policy.
> - Tag-triggered GitHub Actions path for Linux x64, Windows x64, and macOS universal.
> - Removal of old `packages/desktop` artifact publishing from release workflow.
> - Documentation/install path updates for the new desktop-rust release artifacts.
> - Agent-executed QA using existing checks plus workflow/static release simulations.
>   **Effort**: Large
>   **Parallel**: YES - 5 waves
>   **Critical Path**: Task 1 → Task 3 → Task 4 → Task 5/6 → Task 7 → Final Verification

## Context

### Original Request

Внедрить `https://github.com/velopack/velopack` для автоматической публикации `desktop-rust` на git tag для замены старого `desktop`.

### Interview Summary

- Trigger production releases only from stable tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$`.
- Velopack package version is the tag without leading `v`; e.g. `v1.2.3` → `1.2.3`.
- Replace old `packages/desktop` Electrobun desktop artifact publishing immediately.
- Preserve backend binary and Docker publishing from the existing release workflow.
- First release scope: Linux x64, Windows x64, macOS universal.
- Channels: stable-only Velopack platform channels `linux`, `win`, `osx`.
- Signing/notarization: explicitly out of scope; do not add tasks or blockers.
- Tests: do not add new test files; use existing Rust/package verification plus agent-executed QA.
- Publishing target: GitHub Releases for the existing tag.

### Metis Review (gaps addressed)

- Locked tag validation to stable `vX.Y.Z` only; prereleases/build metadata are rejected/skipped.
- Added deterministic Velopack package identity requirement: search named files for an existing canonical ID; if none is found, use `twirchat` and record evidence.
- Added first-release behavior: missing previous Velopack release/feed must not fail packaging.
- Added rerun/idempotency policy: preflight existing Velopack assets for same tag/channel/version and fail fast instead of overwriting.
- Added workflow concurrency and surgical-edit guardrails to avoid breaking backend/Docker release outputs.
- Added dev/unpackaged/offline/no-feed updater safety requirements.
- Added macOS universal verification via `lipo -info`.

## Work Objectives

### Core Objective

When a stable tag like `v1.2.3` is pushed, GitHub Actions must publish Velopack artifacts for `packages/desktop-rust` to the tag's GitHub Release, using channels `linux`, `win`, and `osx`, while no longer publishing old Electrobun desktop artifacts.

### Deliverables

- Rust Velopack startup hook and safe update flow in `packages/desktop-rust`.
- Release helper/script or workflow logic that derives and validates version/channel/artifact metadata.
- Updated `.github/workflows/release.yml` with desktop-rust Velopack packaging/upload jobs.
- Old desktop artifact upload/build steps removed from release publishing path.
- Linux install/readme guidance updated to new desktop-rust Velopack artifact shape.
- Existing verification commands remain green.

### Definition of Done (verifiable conditions with commands)

- `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits `0`.
- `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits `0`.
- `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits `0`.
- `cargo test --manifest-path packages/desktop-rust/Cargo.toml` exits `0`.
- `bun run package:desktop-rust:verify` exits `0`.
- `bunx actionlint .github/workflows/release.yml` exits `0`.
- Static QA confirms release workflow no longer uploads `packages/desktop` artifacts.
- Static/simulated QA confirms `v1.2.3` maps to `packVersion=1.2.3` and non-stable tags are rejected/skipped.
- Simulated QA confirms first Velopack release continues without previous release/feed.
- Simulated QA confirms existing `releases.{channel}.json` assets fail fast before upload.

### Must Have

- `VelopackApp::build().run()` or the Rust crate equivalent must run before normal app startup.
- Update logic must be safe in dev, unpackaged, offline, and no-feed states.
- Workflow must use stable platform channels only: `linux`, `win`, `osx`.
- Linux x64, Windows x64, and macOS universal must be represented explicitly.
- Old `packages/desktop` publishing must be removed from `.github/workflows/release.yml`.
- Backend and Docker release behavior must be preserved.
- GitHub Release reruns must not blindly overwrite Velopack assets/feed files.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- Do not add signing, notarization, certificate, Apple ID, or timestamp server tasks.
- Do not add beta/nightly/prerelease channels.
- Do not support `v1.2.3-beta.1`, `v1.2.3+build`, `1.2.3`, or `desktop-rust-v1.2.3` as production triggers.
- Do not delete/refactor `packages/desktop`; only remove its release artifact publishing path.
- Do not change backend API, Docker image semantics, chat/auth/platform adapters, or UI design unrelated to updates.
- Do not add new test files or new tests.
- Do not require human/manual release inspection for acceptance criteria.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: no new tests + existing Rust/package verification; agent QA scenarios cover release logic.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 `[deep]` release contract + Task 2 `[unspecified-high]` Rust runtime integration.

Wave 2: Task 3 `[unspecified-high]` packaging helper/build surfaces.

Wave 3: Task 4 `[unspecified-high]` GitHub Actions release workflow.

Wave 4: Task 5 `[quick]` docs/install migration + Task 6 `[unspecified-high]` release safety QA/static checks.

Wave 5: Task 7 `[unspecified-high]` full verification and cleanup.

### Dependency Matrix (full, all tasks)

- Task 1 blocks Tasks 3, 4, 5, 6, 7.
- Task 2 blocks Tasks 6, 7.
- Task 3 blocks Tasks 4, 6, 7.
- Task 4 blocks Tasks 5, 6, 7.
- Task 5 blocks Task 7.
- Task 6 blocks Task 7.
- Task 7 blocks final verification wave.

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 2 tasks → `deep`, `unspecified-high`.
- Wave 2 → 1 task → `unspecified-high`.
- Wave 3 → 1 task → `unspecified-high`.
- Wave 4 → 2 tasks → `quick`, `unspecified-high`.
- Wave 5 → 1 task → `unspecified-high`.

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Lock Velopack release contract and package identity

  **What to do**: Define the canonical release contract used by all subsequent work: package ID, version extraction from stable `vX.Y.Z` tags, channels `linux`/`win`/`osx`, artifact naming, first-release behavior, and rerun conflict policy. Determine package ID deterministically: inspect `packages/desktop-rust/Cargo.toml`, `packages/desktop-rust/src/runtime/packaging.rs`, `packages/desktop/electrobun.config.ts`, root `package.json`, and `README.md` for an existing canonical TwirChat app/package identifier; if none is found, use exactly `twirchat`. Record the search/result in `.omo/evidence/task-1-package-id.txt`. Put this contract in the smallest existing appropriate surface: prefer `packages/desktop-rust/src/runtime/packaging.rs` for typed/runtime packaging metadata and `packages/desktop-rust/README.md` or an existing package doc section for operator-facing release policy. If a helper script is needed later, expose this contract as data/functions reused by that script instead of duplicating constants.
  **Must NOT do**: Do not add prerelease channel support. Do not mention signing/notarization. Do not change old `packages/desktop` source code.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Release identity/version/channel decisions are update-chain critical and must be coherent across code, workflow, and docs.
  - Skills: [`rust-best-practices`] - Needed for typed Rust metadata/error handling without panics.
  - Omitted: [`vue3-best-practices`] - No Vue component work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Tasks 3, 4, 5, 6, 7 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/desktop-rust/src/runtime/packaging.rs:137` - Existing packaging contract/app metadata surface.
  - Pattern: `packages/desktop-rust/tests/packaging.rs:10` - Existing packaging verifier expectations; do not add new tests.
  - Pattern: `packages/desktop-rust/README.md:7` - Current note that full native release packaging/updater is not implemented yet.
  - Pattern: `packages/desktop/electrobun.config.ts:42` - Old desktop metadata to replace conceptually, not mechanically copy.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/packaging/overview.mdx#L15-L23` - SemVer2 packaging/version rule.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/packaging/channels.mdx#L3-L37` - Channel behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A single documented source of truth names the deterministic package ID, tag regex `^v[0-9]+\.[0-9]+\.[0-9]+$`, packVersion stripping, channels `linux`/`win`/`osx`, Linux x64, Windows x64, macOS universal.
  - [ ] `.omo/evidence/task-1-package-id.txt` records searched files and the final package ID; if no existing canonical ID is found, final value is exactly `twirchat`.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits `0`.
  - [ ] `cargo fmt --manifest-path packages/desktop-rust/Cargo.toml --check` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Stable tag maps to packVersion
    Tool: Bash
    Steps: Run the implemented release-contract parser/helper or a documented command with input v1.2.3; capture stdout to .omo/evidence/task-1-release-contract.txt
    Expected: Output contains the chosen package_id, pack_version=1.2.3, channels linux/win/osx; command exits 0.
    Evidence: .omo/evidence/task-1-release-contract.txt

  Scenario: Non-production tag rejected
    Tool: Bash
    Steps: Run the same parser/helper with v1.2.3-beta.1 and 1.2.3; capture stdout/stderr.
    Expected: Both inputs are rejected/skipped with a clear message; no pack/upload command is produced.
    Evidence: .omo/evidence/task-1-release-contract-error.txt
  ```

  **Commit**: YES | Message: `feat(desktop-rust): define velopack release contract` | Files: [`packages/desktop-rust/src/runtime/packaging.rs`, `packages/desktop-rust/README.md`, optional helper module/script if justified]

- [x] 2. Integrate Velopack startup and safe update runtime

  **What to do**: Add the Velopack Rust dependency if absent, call `VelopackApp::build().run()` or the current Rust crate equivalent at the very start of `packages/desktop-rust/src/main.rs`, then integrate update checks through `packages/desktop-rust/src/runtime/update.rs` so packaged builds can check/download/apply updates and dev/unpackaged/offline/no-feed states are graceful no-ops or typed errors. Add a non-GUI, non-upload diagnostic binary at `packages/desktop-rust/src/bin/update-check.rs` if no equivalent exists; it must call the same update runtime and support `--mode unpackaged` plus `--feed <url>` so agents can verify dev/offline behavior without adding tests. Keep UI changes limited to existing update toast surfaces; do not redesign update UI.
  **Must NOT do**: Do not panic/unwrap on update failures. Do not block app startup on network/update failure. Do not implement signing/notarization.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Rust runtime integration with external updater and error-handling guardrails.
  - Skills: [`rust-best-practices`] - Required for Result-based errors and avoiding unsafe unwraps.
  - Omitted: [`vue3-best-practices`] - No Vue work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Tasks 6, 7 | Blocked By: none

  **References**:
  - Pattern: `packages/desktop-rust/src/main.rs:12` - Native GPUI entrypoint; Velopack startup hook must be before normal app startup.
  - Pattern: `packages/desktop-rust/src/runtime/update.rs:8` - Existing update-state logic only; extend here.
  - Pattern: `packages/desktop-rust/src/ui/shell/update_toast.rs:16` - Existing update toast UI surface.
  - API/Type: `packages/desktop-rust/Cargo.toml:1` - Rust crate manifest for dependency changes.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/getting-started/rust.mdx#L15-L61` - Rust startup integration.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/integrating/overview.mdx#L86-L122` - Update manager behavior and mutable data warning.

  **Acceptance Criteria**:
  - [ ] Startup hook is first updater-related action in `src/main.rs` before GPUI/app initialization.
  - [ ] Dev/unpackaged/offline/no-feed paths return controlled status/errors and do not crash.
  - [ ] `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin update-check -- --mode unpackaged` exits `0` with a documented non-packaged/no-update status.
  - [ ] `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin update-check -- --feed http://127.0.0.1:9/releases.linux.json` exits `0` or a documented recoverable non-zero code without panic/unwrap; behavior is captured in evidence.
  - [ ] `cargo check --manifest-path packages/desktop-rust/Cargo.toml` exits `0`.
  - [ ] `cargo clippy --manifest-path packages/desktop-rust/Cargo.toml --all-targets --all-features -- -D warnings` exits `0`.

  **QA Scenarios**:

  ```
  Scenario: Dev startup does not crash without Velopack package context
    Tool: Bash
    Steps: Run cargo check, then run `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin update-check -- --mode unpackaged`; capture output.
    Expected: No panic/unwrap; command exits 0 or returns documented non-packaged status.
    Evidence: .omo/evidence/task-2-dev-update-safe.txt

  Scenario: Offline/no-feed update check is graceful
    Tool: Bash
    Steps: Run `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin update-check -- --feed http://127.0.0.1:9/releases.linux.json`; capture output.
    Expected: Clear recoverable error/status; app startup path remains non-fatal.
    Evidence: .omo/evidence/task-2-update-error.txt
  ```

  **Commit**: YES | Message: `feat(desktop-rust): initialize velopack updater` | Files: [`packages/desktop-rust/Cargo.toml`, `packages/desktop-rust/src/main.rs`, `packages/desktop-rust/src/runtime/update.rs`, `packages/desktop-rust/src/bin/update-check.rs`, optional `packages/desktop-rust/src/ui/shell/update_toast.rs`]

- [x] 3. Add Velopack packaging/upload helper surfaces

  **What to do**: Create or extend release helper logic that the workflow can call to validate tags, compute `--packVersion`, map platform/arch to Velopack channel, run/prepare `vpk download github`, `vpk pack`, and `vpk upload github --publish --tag`. The helper must support agent-executed non-upload simulation/print mode for QA without mutating GitHub Releases. First release must continue when `vpk download github` finds no previous packages/feed. Existing same-tag/channel/version Velopack assets must be detected before upload and fail fast.
  **Must NOT do**: Do not perform real GitHub uploads during local QA. Do not overwrite existing GitHub Release assets. Do not add test files.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-platform release command orchestration and safety logic.
  - Skills: [] - Shell/TypeScript/Rust scripting decision should follow repo patterns discovered during implementation.
  - Omitted: [`rust-best-practices`] - Only needed if helper is implemented in Rust; otherwise omit.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 4, 6, 7 | Blocked By: Task 1

  **References**:
  - Pattern: `package.json:14` - Monorepo scripts area; root already has desktop-rust verification script.
  - Pattern: `package.json:21` - Existing `package:desktop-rust:verify` reference from research.
  - Pattern: `.github/workflows/release.yml:1` - Existing release workflow entrypoint that will call the helper.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/distributing/deploy-cli.mdx#L3-L14` - Deploy CLI.
  - External: `https://github.com/velopack/velopack/blob/57e7c7c3c308b43348d30386933ec6affdcf6484/src/vpk/Velopack.Vpk/Commands/Deployment/GitHubUploadCommand.cs#L17-L43` - GitHub upload command options.
  - External: `https://github.com/velopack/velopack/blob/57e7c7c3c308b43348d30386933ec6affdcf6484/src/vpk/Velopack.Deployment/GitHubRepository.cs#L105-L110` - Existing feed asset conflict behavior.

  **Acceptance Criteria**:
  - [ ] Helper/surface validates `v1.2.3` and rejects `1.2.3`, `v1.2.3-beta.1`, and `v1.2.3+build`.
  - [ ] Helper/surface maps Linux x64→`linux`, Windows x64→`win`, macOS universal→`osx`.
  - [ ] Helper/surface has a no-upload simulation path usable in CI/agent QA.
  - [ ] Existing-asset preflight is documented and executable before upload.
  - [ ] Missing previous GitHub Velopack feed/packages is handled as first release and does not fail command preparation.
  - [ ] Existing same-tag/channel/version assets cause a fail-fast result before any upload command is executed.

  **QA Scenarios**:

  ```
  Scenario: Release commands are generated without upload
    Tool: Bash
    Steps: Run helper in simulation mode for v1.2.3 and all three platform targets; save generated commands.
    Expected: Output includes vpk download github, vpk pack, vpk upload github --publish --tag v1.2.3; no network upload occurs.
    Evidence: .omo/evidence/task-3-velopack-commands.txt

  Scenario: Existing feed asset blocks rerun
    Tool: Bash
    Steps: Run helper with mocked/predefined existing assets releases.linux.json, releases.win.json, releases.osx.json for v1.2.3.
    Expected: Helper fails fast before upload command execution and reports conflicting channel/version.
    Evidence: .omo/evidence/task-3-rerun-conflict.txt
  ```

  **Commit**: YES | Message: `feat(release): add velopack desktop-rust packaging helper` | Files: [root `package.json` if scripts are added, `packages/desktop-rust/**` helper files as chosen]

- [x] 4. Replace old desktop publishing in GitHub Actions

  **What to do**: Edit `.github/workflows/release.yml` surgically. Remove old `packages/desktop` Electrobun desktop artifact build/upload from the release path. Add Velopack desktop-rust jobs/steps for Linux x64, Windows x64, and macOS universal. Use workflow concurrency keyed by tag/ref. Preserve changelog, backend binary release assets, and Docker publishing behavior. Ensure the workflow only packages desktop-rust on stable `vX.Y.Z` tags; manual `workflow_dispatch` must not accidentally publish invalid/non-stable versions unless explicitly given a valid stable tag/ref.
  **Must NOT do**: Do not delete backend/Docker jobs. Do not keep both old and new desktop artifact upload paths. Do not add signing/notarization steps.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: CI/CD release workflow migration with high blast radius.
  - Skills: [] - GitHub Actions/YAML work; use actionlint.
  - Omitted: [`rust-best-practices`] - Rust logic should already be encapsulated by Tasks 1-3.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Tasks 5, 6, 7 | Blocked By: Tasks 1, 3

  **References**:
  - Pattern: `.github/workflows/release.yml:1` - Current release workflow.
  - Pattern: `.github/workflows/release.yml:56` - Existing release jobs area from research.
  - Pattern: `.github/workflows/release.yml:142` - Old `bunx electrobun build --env=stable` desktop build reference to remove from publishing path.
  - Pattern: `.github/workflows/release.yml:155` - Existing backend/Docker release outputs to preserve.
  - Pattern: `.github/workflows/release.yml:200` - Existing GitHub release creation/upload area; preserve backend assets and add Velopack assets safely.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/distributing/github-actions.mdx#L82-L114` - Velopack GitHub Actions upload shape.

  **Acceptance Criteria**:
  - [ ] `.github/workflows/release.yml` contains no release upload/package step targeting `packages/desktop`.
  - [ ] Workflow contains desktop-rust Velopack platform targets: Linux x64 channel `linux`, Windows x64 channel `win`, macOS universal channel `osx`.
  - [ ] Backend release asset generation/upload remains present.
  - [ ] Docker publishing remains present.
  - [ ] Stable tag gating is executable/provable: only `refs/tags/vX.Y.Z` can reach Velopack publish steps, and `workflow_dispatch` must provide or resolve to the same stable tag format before publishing.
  - [ ] `bunx actionlint .github/workflows/release.yml` exits `0`.

  **QA Scenarios**:

  ```
  Scenario: Old desktop publishing removed, backend/Docker preserved
    Tool: Bash
    Steps: Run static workflow inspection script/commands and actionlint; capture output.
    Expected: No publishing command targets packages/desktop; backend and Docker jobs/steps still present; actionlint passes.
    Evidence: .omo/evidence/task-4-workflow-static.txt

  Scenario: Invalid tag cannot publish desktop-rust
    Tool: Bash
    Steps: Run helper/workflow expression simulation for refs tags/v1.2.3-beta.1 and tags/desktop-rust-v1.2.3.
    Expected: Publish steps are skipped or fail before Velopack upload preparation.
    Evidence: .omo/evidence/task-4-invalid-tag.txt
  ```

  **Commit**: YES | Message: `ci(release): publish desktop-rust with velopack` | Files: [`.github/workflows/release.yml`]

- [x] 5. Update install and release documentation for desktop-rust artifacts

  **What to do**: Update user/operator-facing docs and installer references that currently describe old desktop artifacts. Prefer minimal edits to `README.md`, `RELEASE.md`, and `scripts/install-linux.sh` only if their current artifact assumptions no longer match Velopack AppImage/GitHub Release output. Linux install guidance must target the new Linux x64 Velopack artifact/feed shape. Document that signing/notarization is intentionally not part of this release plan.
  **Must NOT do**: Do not document beta/prerelease channels. Do not promise signed/notarized installers. Do not remove backend/Docker release docs.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused documentation/script alignment after workflow artifact names are known.
  - Skills: [] - Documentation/script update only.
  - Omitted: [`rust-best-practices`] - No Rust code expected.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Task 7 | Blocked By: Tasks 1, 4

  **References**:
  - Pattern: `README.md:8` - Current Linux installer URL.
  - Pattern: `scripts/install-linux.sh:1` - Current Linux installer script.
  - Pattern: `RELEASE.md:7` - Current tag-triggered release flow docs.
  - External: `https://github.com/velopack/velopack.docs/blob/23cc4503bc5b43dfb2c69349ffaa49544c35e15c/docs/packaging/operating-systems/linux.mdx#L5-L23` - Linux AppImage behavior.

  **Acceptance Criteria**:
  - [ ] README install instructions point to the current/new Linux desktop-rust artifact or installer path.
  - [ ] RELEASE docs describe `vX.Y.Z` tag trigger, stable channels, and desktop-rust Velopack output at a high level.
  - [ ] Any install script assumptions match artifact names produced by Task 4.
  - [ ] Docs do not claim signing/notarization support.

  **QA Scenarios**:

  ```
  Scenario: Linux install docs match release artifact names
    Tool: Bash
    Steps: Compare README/RELEASE/install script references against helper simulation output for Linux v1.2.3; capture matching lines.
    Expected: Referenced Linux artifact/install path exists in generated artifact naming policy.
    Evidence: .omo/evidence/task-5-linux-docs.txt

  Scenario: Docs do not mention unsupported signing/prerelease channels
    Tool: Bash
    Steps: Search changed docs for signing, notarization, beta, nightly, prerelease claims; capture output.
    Expected: No unsupported promise appears; if words appear, they explicitly say out of scope/not supported.
    Evidence: .omo/evidence/task-5-docs-guardrails.txt
  ```

  **Commit**: YES | Message: `docs(release): document velopack desktop-rust releases` | Files: [`README.md`, `RELEASE.md`, `scripts/install-linux.sh` if needed]

- [x] 6. Prove release safety with existing checks and executable QA

  **What to do**: Run all existing verification commands and agent QA scenarios for release safety. Do not create new test files. Use helper simulation/static inspection/mocks to prove tag parsing, channel mapping, first-release behavior, rerun conflict handling, old desktop publishing removal, and macOS universal verification command shape. Store evidence under `.omo/evidence/`.
  **Must NOT do**: Do not push tags. Do not upload to GitHub Releases. Do not require manual installer testing.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Hands-on QA across Rust, Bun, workflow, and release simulation.
  - Skills: [`rust-best-practices`] - Useful when interpreting cargo/clippy failures if they occur.
  - Omitted: [`vue3-best-practices`] - No Vue change expected.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Task 7 | Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - Test: `packages/desktop-rust/tests/packaging.rs:11` - Existing packaging tests.
  - Test: `packages/desktop-rust/tests/overlay_server.rs:19` - Existing overlay asset expectations.
  - Pattern: `packages/desktop-rust/AGENTS.md:65` - Rust command expectations from research.
  - Pattern: `package.json:21` - `bun run package:desktop-rust:verify`.
  - Pattern: `.github/workflows/release.yml:7` - Existing workflow dispatch/tag behavior area.

  **Acceptance Criteria**:
  - [ ] Cargo check/fmt/clippy/test commands all exit `0`.
  - [ ] `bun run package:desktop-rust:verify` exits `0`.
  - [ ] `bunx actionlint .github/workflows/release.yml` exits `0`.
  - [ ] Evidence files exist for tag parsing, invalid tag rejection, first-release no-feed continuation, rerun conflict fail-fast, old desktop publishing absence, and macOS `lipo -info` verification command/output if on macOS runner or documented workflow command if local OS is not macOS.

  **QA Scenarios**:

  ```
  Scenario: Full existing verification suite passes
    Tool: Bash
    Steps: Run cargo check, cargo fmt --check, cargo clippy, cargo test, bun run package:desktop-rust:verify, and bunx actionlint; tee combined output.
    Expected: Every command exits 0.
    Evidence: .omo/evidence/task-6-verification.txt

  Scenario: Release safety simulations pass without mutation
    Tool: Bash
    Steps: Run helper/workflow simulations for valid tag, invalid tags, missing previous feed, and existing feed conflict; tee output.
    Expected: Valid tag prepares commands, invalid tags skip/reject, missing feed continues, existing feed conflict fails before upload.
    Evidence: .omo/evidence/task-6-release-safety.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: [`.omo/evidence/**` only, if evidence is intentionally tracked by workflow; otherwise no commit]

- [x] 7. Final integration cleanup and release-readiness pass

  **What to do**: Review all changes as a single release path. Remove duplication, dead env vars, stale old-desktop upload references, and unsupported claims. Ensure package identity, artifact naming, channels, tag validation, workflow jobs, docs, and runtime update behavior agree. Run formatting/fix commands required by repo policy after file modifications, then rerun verification commands needed by changed file types.
  **Must NOT do**: Do not broaden scope to signing, prereleases, beta channels, or old desktop deletion. Do not mark final verification tasks complete before user approval in the final verification wave.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-cutting cleanup across Rust, CI, docs, and release scripts.
  - Skills: [`rust-best-practices`] - Rust cleanup and clippy interpretation.
  - Omitted: [`vue3-best-practices`] - No Vue component changes expected.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: Final Verification Wave | Blocked By: Tasks 1, 2, 3, 4, 5, 6

  **References**:
  - Pattern: `AGENTS.md` - Repo requires `bun run fix`, `bun run lint`, and `bun run typecheck` before completion when applicable.
  - Pattern: `.github/workflows/release.yml:1` - Final workflow state.
  - Pattern: `packages/desktop-rust/src/main.rs:12` - Final startup integration state.
  - Pattern: `packages/desktop-rust/src/runtime/packaging.rs:137` - Final release contract state.
  - Pattern: `README.md:8`, `RELEASE.md:7`, `scripts/install-linux.sh:1` - Final docs/install alignment.

  **Acceptance Criteria**:
  - [ ] No stale publishing path uploads old `packages/desktop` artifacts.
  - [ ] Release contract is consistent across Rust code/helper/workflow/docs.
  - [ ] Required format/lint/typecheck commands for changed file types have been run or explicitly reported impossible with reason.
  - [ ] No signing/notarization/prerelease/beta scope creep appears in changed files.

  **QA Scenarios**:

  ```
  Scenario: Cross-file consistency audit
    Tool: Bash
    Steps: Run static searches/check scripts for package_id, channels, tag regex, artifact names, packages/desktop publishing, signing/prerelease terms; capture output.
    Expected: Exactly one coherent release contract; no forbidden publishing/scope references.
    Evidence: .omo/evidence/task-7-consistency.txt

  Scenario: Final command pass
    Tool: Bash
    Steps: Run applicable bun fix/lint/typecheck plus cargo and workflow checks; capture output.
    Expected: Commands exit 0 or documented non-applicability is included for commands unrelated to changed file types.
    Evidence: .omo/evidence/task-7-final-checks.txt
  ```

  **Commit**: YES | Message: `chore(release): finalize desktop-rust velopack migration` | Files: [all changed release/Rust/docs files]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy

- Prefer task-level commits for Tasks 1-5 if the repository workflow expects atomic commits; Task 7 may squash/finalize only if explicitly instructed by the user.
- Never commit `.omo/evidence/**` unless this repository intentionally tracks evidence files; otherwise leave evidence uncommitted and report paths.
- Commit messages:
  - `feat(desktop-rust): define velopack release contract`
  - `feat(desktop-rust): initialize velopack updater`
  - `feat(release): add velopack desktop-rust packaging helper`
  - `ci(release): publish desktop-rust with velopack`
  - `docs(release): document velopack desktop-rust releases`
  - `chore(release): finalize desktop-rust velopack migration`

## Success Criteria

- Stable tag `v1.2.3` produces Velopack-ready release commands/artifacts for Linux x64, Windows x64, and macOS universal.
- Old Electrobun desktop artifact publishing is absent from the release path.
- Backend and Docker release outputs remain present.
- Existing Rust/package verification passes.
- Workflow validation passes.
- Rerun and first-release cases are handled without overwriting release assets or failing due to missing previous feed.
- Signing/notarization and prerelease channels remain out of scope.
