# Wails Velopack Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the Wails/Go desktop through the existing Velopack feeds so installed Rust clients update in place.

**Architecture:** The Go executable owns the Velopack runtime lifecycle and exposes its operations through the existing Wails request gateway. GitHub Actions builds native Wails artifacts, injects a semantic version at link time, compresses Linux/Windows executables with UPX, and packages/uploads them with exactly the existing Velopack identity and channels.

**Tech Stack:** Go 1.26, Wails v3 alpha2.117, `github.com/quaadgras/velopack-go`, Velopack CLI, GitHub Actions, UPX, Bun/Vite.

## Global Constraints

- Package ID is `dev.twirchat.app`.
- Stable releases match `^v[0-9]+\.[0-9]+\.[0-9]+$`.
- Channels and feeds remain `linux`/`releases.linux.json`, `win`/`releases.win.json`, `osx`/`releases.osx.json`.
- Inject release version using `-ldflags="-s -w -X main.version=<tag-without-v>"`.
- UPX runs only for Linux and Windows before `vpk pack`; macOS is not compressed.
- The Rust desktop build jobs are removed; Rust source compatibility is out of scope.

---

### Task 1: Version and Velopack startup contract

**Files:**
- Modify: `packages/desktop/main.go`
- Create: `packages/desktop/internal/update/service.go`
- Create: `packages/desktop/internal/update/service_test.go`
- Modify: `packages/desktop/go.mod`, `packages/desktop/go.sum`

**Interfaces:**
- Produces `update.NewService(update.Config)`, implementing app `Start`/`Stop` and bridge updater operations.
- Produces `main.version`, defaulting to `dev`; release builds overwrite it with Go linker `-X`.

- [ ] Write tests proving `Version()` returns `dev` by default and an injected value, and that the Velopack startup adapter invokes auto-apply before Wails starts.
- [ ] Run `go test ./internal/update -run 'TestVersion|TestStartup' -count=1`; expect compile failure for the missing package.
- [ ] Add `github.com/quaadgras/velopack-go` and implement a thin manager interface around `Run`, `CheckForUpdates`, `DownloadUpdates`, and `ApplyUpdatesAndRestart`.
- [ ] In `main.go`, declare `var version = "dev"`, call `update.RunStartup()` before `app.New`, and pass version/feed configuration into the updater service.
- [ ] Re-run the focused tests and `go test ./...`; expect pass.

### Task 2: Restore real updater bridge and Vue capability

**Files:**
- Modify: `packages/desktop/internal/bridge/events.go`
- Create: `packages/desktop/internal/bridge/update_handlers.go`
- Create: `packages/desktop/internal/bridge/update_handlers_test.go`
- Modify: `packages/desktop/internal/bridge/desktop_service.go`
- Modify: `packages/desktop/main.go`
- Modify: `packages/desktop/src/views/main/services/update-capability.ts`
- Test: `packages/desktop/tests/update-capability.test.ts`

**Interfaces:**
- Consumes `update.Service.Check`, `Download`, `Apply`, `Skip`.
- Produces handlers for `checkForUpdate`, `downloadUpdate`, `applyUpdate`, `skipUpdate` and `update_status` Wails events.

- [ ] Write a bridge test with a fake updater that checks the four request names and asserts progress is emitted as `update_status`.
- [ ] Run `go test ./internal/bridge -run TestRegisterUpdateHandlers -count=1`; expect missing registration failure.
- [ ] Register updater handlers and change `DesktopService.Capabilities()` to return `Updates: true` only for packaged Velopack runtime.
- [ ] Change the Vue test to assert update polling is enabled only when the capability is true; do not alter App.vue update UX.
- [ ] Run focused Go/Bun tests, `go test ./...`, and `bun run --cwd packages/desktop typecheck`.

### Task 3: Deterministic Wails artifact contract

**Files:**
- Modify: `packages/desktop/Taskfile.yml`
- Modify: `packages/desktop/build/config.yml`
- Create: `packages/desktop/internal/release/contract.go`
- Create: `packages/desktop/internal/release/contract_test.go`
- Create: `packages/desktop/cmd/release-contract/main.go`

**Interfaces:**
- Produces `release-contract verify --target <linux-x64|win-x64|macos-universal> --version <semver> --artifact <path>`.
- Expects Wails assets, correct executable name and injected version.

- [ ] Write failing contract tests for accepted stable tags, rejected prerelease tags, per-platform executable layouts and incorrect embedded version.
- [ ] Implement stable tag parsing, artifact verification and a CLI that exits non-zero with an actionable report.
- [ ] Extend Taskfile build tasks to accept `VERSION`, pass linker flags, and expose production build outputs without developer-only Vite servers.
- [ ] Run `go test ./internal/release ./cmd/release-contract` and a local Linux build followed by `release-contract verify`.

### Task 4: Replace GitHub Actions desktop build and Velopack publish jobs

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `RELEASE.md`

**Interfaces:**
- Consumes target artifacts produced by Task 3.
- Produces release assets and feeds with same Velopack ID/channels as the Rust release.

- [ ] Replace Rust setup, Cargo cache, native Rust build and Rust artifact staging with native Go/Wails runner steps for Linux x64, Windows x64 and macOS universal.
- [ ] Install the pinned Wails CLI, Task, Bun, Go, .NET `vpk`, and required native WebView build dependencies on each platform.
- [ ] Build with `VERSION=${PACK_VERSION}` and linker flags, run the release contract before packaging, then run `upx --best --lzma` and `upx -t` for Linux/Windows only.
- [ ] Keep the existing `vpk download github`, `vpk pack`, and `vpk upload github --publish --merge` commands, preserving package ID, channel, feed and runtime arguments.
- [ ] Ensure the release job waits for all desktop publish jobs and includes desktop feeds/assets with backend assets.
- [ ] Update README and RELEASE.md to describe Wails/Go, migration compatibility, version injection, UPX policy, and no signing/notarization.
- [ ] Trigger a workflow-dispatch dry run and verify all three package jobs produce contract-valid artifacts without publishing.

### Task 5: Migration and release acceptance checks

**Files:**
- Create: `docs/release-checklist-wails-velopack.md`
- Modify: `.github/workflows/release.yml`

- [ ] Add a CI post-package assertion that each output directory contains exactly one matching `releases.<channel>.json` and a versioned package asset.
- [ ] Document the manual migration procedure: install latest Rust release, publish/install first Wails package on the same channel, check auto-apply and verify `main.version` in the launched Wails app.
- [ ] Run full Go tests, `bun run --cwd packages/desktop test`, root `bun run lint`, root `bun run typecheck`, and `git diff --check`.
