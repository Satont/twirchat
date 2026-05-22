## Task 1 - Velopack Release Contract

- Package identity search covered `packages/desktop-rust/Cargo.toml`, `packages/desktop-rust/src/runtime/packaging.rs`, `packages/desktop/electrobun.config.ts`, root `package.json`, and root `README.md`.
- The Rust crate name is `twirchat-desktop-rust`, but preserved desktop release identity appears as app identifier `dev.twirchat.app` with display name `TwirChat` in both Rust packaging metadata and Electrobun config.
- The release contract is now executable through `cargo run --manifest-path packages/desktop-rust/Cargo.toml --bin release-contract -- <tag>` and validates stable tags before deriving Velopack `packVersion`.

## Task 2 - Velopack Runtime Integration

- `velopack` crate version available on crates.io is `0.0.1589-ga2c5a97`; its Rust startup hook is `VelopackApp::build().run()` and `set_auto_apply_on_startup(true)` matches the documented default explicitly.
- `UpdateManager::new` fails with `NotInstalled` in dev/unpackaged runs before any network feed check; the diagnostic runtime maps that to a recoverable `unpackaged`/`no-update` report instead of blocking app startup.
- `HttpSource` treats its input as a feed base directory and appends `releases.<channel>.json`; the runtime normalizes a direct `.../releases.linux.json` diagnostic feed to its parent base and extracts channel `linux`.

## Task 3 - Velopack Command Planning

- `release-contract velopack-plan <tag>` now reuses the Task 1 stable tag contract, derives `packVersion` from the validated tag, and prints safe simulation-only `vpk download github`, `vpk pack`, and `vpk upload github --publish --tag` commands for Linux x64, Windows x64, and macOS universal.
- The command planner maps feed channels to Velopack release assets as `releases.linux.json`, `releases.win.json`, and `releases.osx.json`; mocked existing assets are enough to fail preflight before any upload command is printed.
- First-release mode is explicit via `--first-release` and continues command preparation without requiring a previous feed.

## Task 4 - GitHub Actions Velopack Release

- `.github/workflows/release.yml` now derives `is_stable_tag` and `pack_version` from the release tag with the stable regex before any desktop-rust Velopack build or publish job can run.
- Old Electrobun release publishing was removed: GitHub Release creation downloads only the backend binary artifact, while desktop-rust Velopack packaging/upload runs in a separate stable-tag-gated matrix for `linux`, `win`, and `osx`.
- Local `bunx actionlint` resolves the unrelated npm package named `actionlint` and has no binary; `bunx actionlint@npm:github-actionlint .github/workflows/release.yml` executes the upstream actionlint wrapper successfully.
- The desktop-rust publish job now queries the current GitHub Release for an existing `releases.<channel>.json` feed asset and passes that channel-specific asset list into `release-contract velopack-plan --existing-assets`, so reruns fail before `vpk upload` while unrelated backend assets do not block Velopack.
- `vpk download github` is allowed to fail only as the first-release/no-previous-feed case; the workflow continues to `vpk pack` and leaves `vpk pack`/`vpk upload` as hard-failing commands.

## Task 5 - Documentation and Install Update

- Updated root README.md with Windows (Setup.exe) and macOS (.zip) installation steps matching Velopack artifact names.
- Updated RELEASE.md to reflect the transition from Electrobun to Rust-native desktop with Velopack distribution.
- Rewrote scripts/install-linux.sh to handle Velopack AppImage distribution, including dynamic latest-version discovery via GitHub API and icon extraction.
- Verified that documentation explicitly notes the lack of signing/notarization and stable-only release policy, avoiding promises for beta/nightly channels.

## Task 6 - Release Safety Verification

- Captured release QA in `.omo/evidence/task-6-verification.txt` and `.omo/evidence/task-6-release-safety.txt` without modifying production code, workflow YAML, package manifests, or lock files.
- `cargo check`, `cargo fmt --check`, strict `cargo clippy`, `bun run package:desktop-rust:verify`, and `bunx actionlint@npm:github-actionlint .github/workflows/release.yml` passed; local `bunx actionlint .github/workflows/release.yml` still resolves the unrelated no-binary npm package and fails as expected.
- Release-contract simulations accepted `v1.2.3`, derived `packVersion` `1.2.3`, rejected `1.2.3`, `v1.2.3-beta.1`, `v1.2.3+build`, and `desktop-rust-v1.2.3`, mapped `linux`/`win`/`osx` to their feed assets, failed fast on existing `releases.<channel>.json`, and allowed unrelated backend assets.
- Static workflow evidence shows old Electrobun desktop publishing patterns absent, backend GitHub Release artifact and Docker publishing preserved, and macOS universal command shape using `lipo -create`; local Linux cannot execute macOS `lipo` and the workflow has no `lipo -info` command.

## Task 5 - Post-Verification Fixes

- GitHub Release 'download' URLs require explicit asset upload in the workflow; raw GitHub source is safer for installation scripts not intended as release binaries.
- AppImage detection must be flexible as Velopack output names can vary; matching the extension in the download URL is a more robust strategy.

## Task 5 - Final Quality Fix

- Always double-check final script output blocks for accidental line duplication during multi-file edits.

## Task 6 - Verification Retry

- Full `cargo test` must include integration tests after the lib tests; the first retry fixed the original lib failures but exposed `tests/app_state.rs` badge backfill coverage before the command could exit successfully.
- The UI contract tests are source-string guards, so harmless refactors need the assertion target moved to the file that now owns the behavior instead of reintroducing dead source text.
- Regenerated `.omo/evidence/task-6-verification.txt` and `.omo/evidence/task-6-release-safety.txt` after all fixes; all required verification commands now exit `0` except the documented local `bunx actionlint` package collision, while the aliased `github-actionlint` command passes.

## Task 7 - Final Integration Cleanup

- Removed stale desktop-rust docs that still described production packaging and native updater support as future-only; the docs now distinguish implemented Velopack startup/feed checks from out-of-scope in-app download/apply/relaunch behavior.
- Stable-tag gating now also protects GitHub Release creation and Docker publishing, preserving those outputs for stable `vX.Y.Z` tags while avoiding prerelease/beta/nightly publishing scope.
- The changelog action no longer points at the old desktop package metadata; it uses the backend package version file while release versioning still comes from the validated tag.

## Deep Review - Velopack Upload Merge

- Velopack GitHub uploads target a GitHub Release that the workflow creates before desktop-rust assets are uploaded, so both the workflow and `release-contract velopack-plan` now include `vpk upload github --publish --merge --tag ...` while preserving the existing `releases.<channel>.json` preflight conflict guard.
