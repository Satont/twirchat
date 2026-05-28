# Updater stabilization status

## Current Rust parity

The Rust desktop runtime mirrors and implements the user-visible updater state machine used by the
desktop UI:

- update toast visibility and payload snapshots
- startup and periodic update checks
- check/download/apply/skip commands
- download progress family statuses
- skipped-hash suppression for already skipped updates
- serialized update status payloads for UI/service boundaries

Packaged builds initialize Velopack during startup, check the stable platform feed on startup and at
the configured interval while automatic checks are enabled, show an in-app update toast, download the
selected update, and restart to apply it through Velopack. Dev, unpackaged, offline, and missing-feed
states remain safe no-ops or surfaced errors.

## Packaging stabilization added in Task 25

`src/runtime/packaging.rs` records the package asset contract that the native Velopack release path
must preserve. It keeps the existing Vite-built desktop assets as package inputs:

- overlay HTML and bundled assets are required at `views/overlay/`
- main-window HTML and bundled assets are required at `views/main/`
- font assets are required at `views/fonts/`
- Linux, Windows, and macOS icon assets remain required under `assets/`
- app identity stays aligned with `TwirChat` / `dev.twirchat.app`
- Velopack release identity stays `dev.twirchat.app`

CI prepares those `views/...` and `assets/...` paths before uploading the desktop-rust app artifact
and before `vpk pack`. The `release-contract verify-artifact <path>` command runs the same Rust
verifier against the prepared app directory.

Velopack release output remains stable-only:

- Linux channel `linux` publishes AppImage assets and `releases.linux.json`.
- Windows channel `win` publishes Setup `.exe` assets and `releases.win.json`.
- macOS channel `osx` publishes `.pkg` assets containing `TwirChat.app` and `releases.osx.json`.
- Current releases are unsigned and macOS builds are not notarized.
- Prerelease, beta, nightly, and unprefixed semver tags are rejected.

The packaging tests produce evidence files for both the passing artifact contract and the expected
failure mode when a required overlay asset is absent.

## Remaining updater stabilization checklist

- Add end-to-end updater tests against fixture release manifests/artifacts.
- Keep the packaging verifier in CI so missing overlay, font, or icon assets fail before release.
- Revisit signing and notarization when release credentials and platform requirements are ready.
