## Task 1 - Velopack Release Contract

- Use `dev.twirchat.app` as the Velopack package ID because it is the only canonical desktop app identifier found in the required identity search files; the Cargo package name remains a crate/build identity, not the release package identity.
- Accept only stable tags matching `^v[0-9]+\.[0-9]+\.[0-9]+$` and derive `packVersion` by removing the leading `v`.
- Lock platform channels to `linux`, `win`, and `osx` with Linux x64, Windows x64, and macOS universal; no signing, notarization, beta, nightly, prerelease, or prerelease channel support in this task.

## Task 2 - Velopack Runtime Integration

- Kept `packages/desktop-rust/src/main.rs` thin by adding only `run_velopack_startup()` as the first statement in `main`; all product-specific update checks stay in `runtime/update.rs`.
- The non-GUI `update-check` binary prints a structured JSON report and exits successfully for recoverable `unpackaged`, `no-feed`, `no-update`, and `offline` states; only unrecoverable runtime errors map to exit code 2.

## Task 3 - Velopack Command Planning

- Kept Velopack packaging/upload planning in `packages/desktop-rust/src/runtime/packaging.rs` plus the existing `release-contract` helper so the release contract, target mapping, simulation commands, and conflict preflight stay in one typed Rust surface.
- Added only simulation output and mocked asset conflict inputs; real GitHub uploads remain out of scope until the workflow integration task wires these commands safely.

## Task 4 - GitHub Actions Velopack Release

- Kept the Vite views build because desktop-rust packaging still consumes the existing Vue view artifacts, but removed the old Electrobun build and old desktop artifact upload from the release path.
- Created the GitHub Release from the backend artifact before running Velopack uploads, so backend release assets remain attached by `softprops/action-gh-release` and Velopack owns only the desktop-rust channel assets.
- Used the Task 3 command shape directly in the workflow (`vpk download github`, `vpk pack`, `vpk upload github`) after printing the helper plan for the same tag/repo/artifact root.

## Task 7 - Release Scope Cleanup

- Treat non-stable `v*` tags as outside the release contract for all publish jobs in `release.yml`; stable tags still publish the backend release asset, Docker image, and desktop-rust Velopack feeds.
